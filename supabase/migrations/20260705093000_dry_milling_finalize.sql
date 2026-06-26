-- ════════════════════════════════════════════════════════════════════════════
-- P3-S9 · Finalize milling + green grade + COGS flow — the green→bag keystone.
-- ════════════════════════════════════════════════════════════════════════════
-- Spec: docs/design/PHASE3-DESIGN.md lines 287-294 (+ §1 cross-slice rails + the
--       P3-SPIKE-MILL closed-mass-balance note from S8).
-- Deps: P3-S8 (mill_passes / mill_byproducts / mill_run_balance, 20260705092000),
--       P3-S7 (milling_runs / mill_readiness / v_mill_readiness, 20260705091000),
--       Phase-1 materialize_green_lot (the ONLY GreenLot writer — CALLED here; the
--       mill is its canonical caller) + cost_entry / refresh_lot_cost / cogs_per_lot
--       (the costing spine; HARD dep) + lot_edges_conserve_mass + lot_code_seq +
--       record_lot_event + green_lots (composite (tenant_id, lot_code) PK).
-- Live max at authoring: 20260705092000_dry_milling_passes.sql — this timestamp
--       (20260705093000) is strictly greater; single schema author for the serial lane.
--
-- WHAT THIS SLICE OWNS:
--   * mill_grade — the SCA Arabica green grade. `sca_prep` is a GENERATED column
--     folding the category-1 (primary) + category-2 (secondary) defect counts into
--     the SCA prep band (EP-Specialty / Premium / Exchange / Below Standard) — the
--     SHB/EP-Specialty prep that commands Janson's premium and the Best-of-Panama
--     entry right. GENERATED means the grade can NEVER drift from its defect counts
--     (the same single-source-of-truth posture as green_lots.sca_grade off cupping
--     score). Append-only: a re-grade is a NEW row; the latest wins (v_green_grade).
--   * finalize_milling_run — THE keystone RPC. It (1) sets the run's green_kg_out and
--     validates the CLOSED OUTTURN MASS BALANCE via mill_run_balance.balance_ok (the
--     spike's "weight-loss mystery" guard — an 18%-vanished run is physically
--     rejected, the whole txn rolls back), (2) CALLS the existing materialize_green_lot
--     to mint the green node via the existing conserved 'process' lot_edge (the
--     Phase-1 conservation trigger guards it for free), (3) posts a processing-batch
--     cost_entry to the minted green lot so milling cost flows
--     cost_alloc_by_rule→mv_lot_cost→cogs_per_lot, (4) calls refresh_lot_cost(), (5)
--     auto-grades the green lot (mill_grade), (6) appends 'mill_run_finalized'.
--     Idempotent on the green code (a replayed finalize returns the same code and
--     posts NO second cost row).
--   * record_green_grade — a standalone grade-append RPC (re-grade / late grade).
--   * v_green_grade — the latest grade per green lot.
--
-- Rails honored:
--   * One write door — finalize_milling_run / record_green_grade are SECURITY DEFINER
--     (set search_path = public, extensions), tenant-clamped (v_tenant :=
--     current_tenant_id(), fail-closed on null), idempotent on a tenant-qualified key,
--     appending a lot_event in the SAME txn via record_lot_event.
--   * AD-8/AD-9 grants — per-object `grant select … to authenticated`; on every RPC
--     `revoke execute … from public` THEN `grant execute … to authenticated`. anon
--     gets NOTHING. The immutability trigger fn is revoked-from-public with no grant.
--   * Money/mass guarantee REUSED — finalize commits NO green inventory itself; it
--     routes mass ONLY through materialize_green_lot's conserved 'process' edge (the
--     Phase-1 lot_edges_conserve_mass trigger rejects minting more green than the
--     parchment holds). No lot_reservations/lot_shipments, no parallel counter.
--   * Cost truth — milling cost enters COGS through the SHIPPED cost_entry ledger +
--     refresh_lot_cost + cogs_per_lot; nothing re-implemented.
--   * Tenant seam — mill_grade carries tenant_id + current_tenant_id() default + RLS
--     `using (tenant_id = current_tenant_id())`; it composite-FKs to
--     green_lots(tenant_id, lot_code). Registered in src/test/db/tenantTables.ts.
--   * convert_qty — no cross-unit math here (every quantity is kg).

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. mill_grade — the SCA Arabica green-grade ledger. RPC-only write door (no client
--    insert/update/delete grant). Append-only (immutability trigger below). sca_prep
--    is GENERATED from the defect counts so it can never disagree with them.
--    SCA full-defect bands (350 g sample): Specialty = 0 category-1 (primary) defects
--    AND ≤ 5 full defects total; Premium ≤ 3 primary AND ≤ 8 total; Exchange ≤ 23;
--    else below standard. The Specialty band is labelled 'EP-Specialty' (European
--    Preparation), Janson's premium grade.
-- ════════════════════════════════════════════════════════════════════════════
create table mill_grade (
  id              bigint generated always as identity primary key,
  tenant_id       uuid    not null references tenants(id) default current_tenant_id(),
  green_lot_code  text    not null,
  cat1_defects    integer not null default 0 check (cat1_defects >= 0),  -- primary (full-defect equiv)
  cat2_defects    integer not null default 0 check (cat2_defects >= 0),  -- secondary (full-defect equiv)
  screen_size     integer check (screen_size >= 0),                      -- e.g. 15 / 16 / 18
  sca_prep        text generated always as (
    case
      when cat1_defects = 0 and (cat1_defects + cat2_defects) <= 5 then 'EP-Specialty'
      when cat1_defects <= 3 and (cat1_defects + cat2_defects) <= 8 then 'Premium'
      when (cat1_defects + cat2_defects) <= 23                      then 'Exchange'
      else 'Below Standard'
    end
  ) stored,
  graded_at       timestamptz not null default now(),
  idempotency_key text,
  created_at      timestamptz not null default now(),
  constraint mill_grade_tenant_idem_ux unique (tenant_id, idempotency_key),
  constraint mill_grade_green_lot_tfk
    foreign key (tenant_id, green_lot_code) references green_lots(tenant_id, lot_code)
);
create index mill_grade_tenant_idx on mill_grade (tenant_id);
create index mill_grade_lot_idx    on mill_grade (green_lot_code, graded_at desc);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Append-only immutability — a recorded grade is a physical-sample fact; a
--    re-grade is a NEW row, never an edit. Trigger fn, revoked from public, never
--    granted (no caller surface).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function _mill_grade_immutable() returns trigger
  language plpgsql set search_path = public
as $$
begin
  raise exception
    'mill_grade is append-only: % is not permitted — record a new grade row instead', tg_op
    using errcode = 'restrict_violation';
end $$;
create trigger mill_grade_no_update before update on mill_grade
  for each row execute function _mill_grade_immutable();
create trigger mill_grade_no_delete before delete on mill_grade
  for each row execute function _mill_grade_immutable();
revoke execute on function _mill_grade_immutable() from public;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. v_green_grade — the latest grade per green lot (the /mill finalize panel reads
--    this). security_invoker so it inherits the caller's RLS on mill_grade.
-- ════════════════════════════════════════════════════════════════════════════
create view v_green_grade with (security_invoker = on) as
  select distinct on (g.tenant_id, g.green_lot_code)
         g.tenant_id,
         g.green_lot_code,
         g.cat1_defects,
         g.cat2_defects,
         g.screen_size,
         g.sca_prep,
         g.graded_at
    from mill_grade g
   order by g.tenant_id, g.green_lot_code, g.graded_at desc, g.id desc;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Command RPCs — the ONLY write doors. SECURITY DEFINER, tenant-clamped,
--    idempotent on a tenant-qualified key, lot_event appended in the same txn.
-- ════════════════════════════════════════════════════════════════════════════

-- 4a. record_green_grade — append one SCA green-grade row for a green lot. Standalone
--     re-grade / late-grade path (finalize_milling_run also auto-grades inline).
create or replace function record_green_grade(
  p_green_lot_code  text,
  p_cat1_defects    integer,
  p_cat2_defects    integer,
  p_screen_size     integer,
  p_idempotency_key text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_key    text;
  v_id     bigint;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  -- idempotency early-return (exactly-once replay).
  select id into v_id from mill_grade
   where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then
    return v_id;
  end if;

  -- the green lot must exist, be ours, and actually be green.
  if not exists (
    select 1 from lots
     where tenant_id = v_tenant and code = p_green_lot_code and stage = 'green'
  ) then
    raise exception 'unknown green lot %', p_green_lot_code using errcode = 'foreign_key_violation';
  end if;

  insert into mill_grade
    (tenant_id, green_lot_code, cat1_defects, cat2_defects, screen_size, idempotency_key)
  values
    (v_tenant, p_green_lot_code, p_cat1_defects, p_cat2_defects, p_screen_size, v_key)
  returning id into v_id;

  perform record_lot_event(
    p_green_lot_code, 'green_graded',
    jsonb_build_object('grade_id', v_id, 'cat1_defects', p_cat1_defects,
                       'cat2_defects', p_cat2_defects, 'screen_size', p_screen_size),
    now(), 'server', nextval('lot_code_seq'), v_key || ':grade');

  return v_id;
end $$;
revoke execute on function record_green_grade(text, integer, integer, integer, text) from public;
grant   execute on function record_green_grade(text, integer, integer, integer, text) to authenticated;

-- 4b. finalize_milling_run — THE keystone. Validates the closed outturn mass balance,
--     mints the green lot (via the canonical materialize_green_lot), posts the milling
--     cost into COGS, auto-grades the green, and appends 'mill_run_finalized'.
--     Idempotent on the green code: a replayed finalize returns the same minted code.
create or replace function finalize_milling_run(
  p_run_id              bigint,
  p_green_kg_out        numeric,
  p_cupping_score       numeric,
  p_location            text,
  p_cat1_defects        integer,
  p_cat2_defects        integer,
  p_screen_size         integer,
  p_processing_cost_usd numeric,
  p_idempotency_key     text
) returns text
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_key    text;
  v_lot    text;     -- the parchment lot code
  v_status text;
  v_green  text;     -- the minted green lot code
  v_ok     boolean;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  -- the run must exist and be ours.
  select parchment_lot_code, status into v_lot, v_status
    from milling_runs where id = p_run_id and tenant_id = v_tenant;
  if v_lot is null then
    raise exception 'unknown milling run %', p_run_id using errcode = 'foreign_key_violation';
  end if;

  -- IDEMPOTENT on the green code: a run already finalized returns its minted code
  -- (recovered from the 'mill_run_finalized' event) — never a second mint / cost row.
  if v_status = 'finalized' then
    select payload->>'green_lot_code' into v_green
      from lot_event
     where tenant_id = v_tenant and stream_key = v_lot and kind = 'mill_run_finalized'
       and payload->>'run_id' = p_run_id::text
     limit 1;
    return v_green;
  end if;
  if v_status <> 'open' then
    raise exception 'milling run % is % — only an open run can be finalized', p_run_id, v_status
      using errcode = 'check_violation';
  end if;

  -- (1) record the authoritative green outturn, THEN validate the CLOSED MASS BALANCE
  --     (mill_run_balance reads green_kg_out via coalesce). balance_ok is FALSE when
  --     the unaccounted residual escapes [−1e-9, lot_yield_curve-derived ceiling] —
  --     the spike's "weight-loss mystery". RAISING here rolls back this update too.
  update milling_runs set green_kg_out = p_green_kg_out
   where id = p_run_id and tenant_id = v_tenant;

  select balance_ok into v_ok from mill_run_balance
   where run_id = p_run_id and tenant_id = v_tenant;
  if not coalesce(v_ok, false) then
    raise exception
      'mill mass-balance unbalanced: run % outturn %.3f kg leaves unaccounted loss beyond the per-variety ceiling — cannot finalize (record byproducts/rejects or re-weigh)',
      p_run_id, p_green_kg_out
      using errcode = 'check_violation';
  end if;

  -- (2) mint the green node via the CANONICAL writer (a fresh JC-NNN code). The
  --     Phase-1 lot_edges_conserve_mass trigger fires on the 'process' edge and
  --     rejects routing more green than the parchment lot's remaining mass.
  v_green := materialize_green_lot(v_lot, null, p_green_kg_out, p_cupping_score, p_location, now());

  -- (3) post the milling cost to the green lot so it flows into cogs_per_lot. The
  --     processing→lot allocation lands the whole amount on this green lot.
  if coalesce(p_processing_cost_usd, 0) > 0 then
    insert into cost_entry (tenant_id, driver, allocation_rule, target_kind, target_code, amount_usd, occurred_at)
    values (v_tenant, 'processing-batch', 'processing', 'lot', v_green, p_processing_cost_usd, now());
    -- (4) bust + rebuild the COGS matview so cogs_per_lot(green) reads it immediately.
    perform refresh_lot_cost();
  end if;

  -- (5) auto-grade the green lot (SCA prep GENERATED from the defect counts).
  insert into mill_grade
    (tenant_id, green_lot_code, cat1_defects, cat2_defects, screen_size, idempotency_key)
  values
    (v_tenant, v_green, p_cat1_defects, p_cat2_defects, p_screen_size, v_key || ':grade');

  -- (6) finalize the run + append the hash-chained 'mill_run_finalized' event.
  update milling_runs set status = 'finalized'
   where id = p_run_id and tenant_id = v_tenant;

  perform record_lot_event(
    v_lot, 'mill_run_finalized',
    jsonb_build_object('run_id', p_run_id, 'green_lot_code', v_green,
                       'green_kg_out', p_green_kg_out,
                       'processing_cost_usd', coalesce(p_processing_cost_usd, 0)),
    now(), 'server', nextval('lot_code_seq'), v_key || ':finalized');

  return v_green;
end $$;
revoke execute on function finalize_milling_run(bigint, numeric, numeric, text, integer, integer, integer, numeric, text) from public;
grant   execute on function finalize_milling_run(bigint, numeric, numeric, text, integer, integer, integer, numeric, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. RLS — tenant-scoped read on the new table (mirrors the P3-S7/S8 idiom). All
--    writes flow through the SECDEF RPCs (which self-clamp the tenant), so NO
--    insert/update/delete policy exists — read-only at the policy layer.
-- ════════════════════════════════════════════════════════════════════════════
alter table mill_grade enable row level security;
create policy "tenant read" on public.mill_grade for select to authenticated
  using (tenant_id = current_tenant_id());

-- ════════════════════════════════════════════════════════════════════════════
-- 6. GRANTS (AD-8) — per-object SELECT to authenticated (one statement each so the
--    name-anchored static guard matches). NO write grants; anon gets NOTHING.
-- ════════════════════════════════════════════════════════════════════════════
grant select on mill_grade    to authenticated;
grant select on v_green_grade to authenticated;

commit;
