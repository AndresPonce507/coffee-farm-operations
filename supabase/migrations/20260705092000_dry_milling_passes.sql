-- ════════════════════════════════════════════════════════════════════════════
-- P3-S8 · Machine-pass chain + byproducts + THE CLOSED MASS BALANCE.
-- ════════════════════════════════════════════════════════════════════════════
-- Spec: docs/design/PHASE3-DESIGN.md lines 279-286 (+ §1 cross-slice rails + the
--       P3-SPIKE-MILL note — the "weight-loss mystery" the mass balance must kill).
-- Deps: P3-S7 (milling_runs / mill_readiness / v_mill_readiness, 20260705091000),
--       P3-S6 (lot_edges 'byproduct' kind + pass_type/byproduct_kind enums,
--       20260705090000), Phase-1 (lots/lot_edges + lot_edges_conserve_mass() +
--       lot_code_seq + record_lot_event + lot_yield_curve).
-- Live max at authoring: 20260705091000_dry_milling_readiness.sql — this timestamp
--       (20260705092000) is strictly greater; single schema author for the serial lane.
--
-- WHAT THIS SLICE OWNS:
--   * mill_passes — the ordered machine chain (huller→polisher→…). A per-pass CHECK
--     `output_kg + reject_kg <= input_kg + 1e-9` makes a single machine physically
--     unable to emit more than it took; cross-pass continuity (pass N in == pass N-1
--     out) is enforced IN the record_mill_pass RPC.
--   * mill_byproducts — cascara/husk/pasilla/screen-rejects. EACH byproduct is minted
--     as ITS OWN `lots` node + a conserved `kind='byproduct'` lot_edge from the
--     parchment lot, so the SHIPPED lot_edges_conserve_mass() trigger guards it FOR
--     FREE — the mass guarantee is REUSED, never re-implemented (§0.2 / §1.4). A
--     byproduct is a real, sellable, traceable node (it can be priced/shipped later).
--   * mill_run_balance — the closed-outturn readout: parchment_in, Σpass outputs,
--     Σreject, Σbyproduct, green_out, accounted moisture-delta loss, unaccounted loss,
--     and `balance_ok` — TRUE only when the unaccounted residual sits under a ceiling
--     DERIVED from lot_yield_curve(parchment→green) (never a hardcoded magic number).
--   * mill_outturn_by_variety — Σ outturn rolled up per variety.
--
-- THE SPIKE (P3-SPIKE-MILL) — the closed mass balance is a footgun: a naive equality
--   raises on every honest run (real milling loses mass to moisture + unweighed dust +
--   scale rounding), while a too-loose tolerance lets mass silently vanish. We model:
--       parchment_in = green_out + Σbyproduct + Σreject
--                      + accounted_moisture_loss + unaccounted_loss
--   where accounted_moisture_loss is derived from the mill_readiness moisture delta
--   (parchment % → the 10.5% green floor) and unaccounted_loss is capped under a
--   ceiling derived from lot_yield_curve (the expected processing loss). A realistic
--   82% run balances; an 18%-vanished run trips the ceiling.
--
-- Rails honored:
--   * One write door — record_mill_pass / record_mill_byproduct are SECURITY DEFINER
--     (set search_path = public, extensions), tenant-clamped, idempotent on a
--     tenant-qualified key, appending a lot_event in the SAME txn.
--   * AD-8/AD-9 grants — per-object `grant select … to authenticated`; on every RPC
--     `revoke execute … from public` THEN `grant execute … to authenticated`. anon
--     gets NOTHING. Trigger fns are revoked-from-public with no grant.
--   * Tenant seam — every new table carries tenant_id + current_tenant_id() default +
--     RLS `using (tenant_id = current_tenant_id())`; the byproduct node composite-FKs
--     to lots(tenant_id, code). New RLS tables registered in src/test/db/tenantTables.ts.
--   * Money guarantee UNTOUCHED + REUSED — milling CONSUMES parchment; it commits NO
--     green inventory, so it inserts NO lot_reservations/lot_shipments and adds NO
--     parallel counter. The byproduct mass is conserved by the EXISTING lot_edges
--     conservation trigger (the S6 edge-kind widening made that automatic).
--   * convert_qty — no cross-unit math here (every quantity is kg).

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. mill_passes — the ordered machine-chain ledger. RPC-only write door (no client
--    insert/update/delete grant). Append-only (immutability trigger below). The
--    per-pass mass CHECK is the in-table half of invariant 1.
-- ════════════════════════════════════════════════════════════════════════════
create table mill_passes (
  id              bigint generated always as identity primary key,
  tenant_id       uuid    not null references tenants(id) default current_tenant_id(),
  run_id          bigint  not null references milling_runs(id),
  pass_no         integer not null check (pass_no >= 1),
  machine_kind    pass_type not null,                       -- P3-S6 enum
  input_kg        numeric not null check (input_kg > 0),
  output_kg       numeric not null check (output_kg >= 0),
  reject_kg       numeric not null default 0 check (reject_kg >= 0),
  recorded_at     timestamptz not null default now(),
  idempotency_key text,
  created_at      timestamptz not null default now(),
  constraint mill_passes_tenant_idem_ux unique (tenant_id, idempotency_key),
  constraint mill_passes_run_pass_ux    unique (run_id, pass_no),
  -- THE per-pass mass-balance CHECK (invariant 1): a single machine can't emit
  -- (clean output + reject) more than it was fed. 1e-9 absorbs float dust.
  constraint mill_passes_mass_balance_chk check (output_kg + reject_kg <= input_kg + 1e-9)
);
create index mill_passes_tenant_idx on mill_passes (tenant_id);
create index mill_passes_run_idx    on mill_passes (run_id, pass_no);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. mill_byproducts — each byproduct stream is its OWN sellable, traceable lots
--    node (minted by record_mill_byproduct) + a conserved 'byproduct' lot_edge. This
--    table is the run↔node join + the kind/kg record. Append-only; RPC-only writes.
-- ════════════════════════════════════════════════════════════════════════════
create table mill_byproducts (
  id                 bigint generated always as identity primary key,
  tenant_id          uuid    not null references tenants(id) default current_tenant_id(),
  run_id             bigint  not null references milling_runs(id),
  byproduct_lot_code text    not null,                      -- the minted lots node (BYP-…)
  kind               byproduct_kind not null,              -- P3-S6 enum: husk/chaff/screen_rejects/defects
  kg                 numeric not null check (kg > 0),
  recorded_at        timestamptz not null default now(),
  idempotency_key    text,
  created_at         timestamptz not null default now(),
  constraint mill_byproducts_tenant_idem_ux unique (tenant_id, idempotency_key),
  constraint mill_byproducts_lot_tfk
    foreign key (tenant_id, byproduct_lot_code) references lots(tenant_id, code)
);
create index mill_byproducts_tenant_idx on mill_byproducts (tenant_id);
create index mill_byproducts_run_idx    on mill_byproducts (run_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Append-only immutability — recorded passes + byproduct mints are physical facts;
--    corrections are NEW runs/rows, never edits. Trigger fns, revoked from public,
--    never granted (no caller surface).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function _mill_passes_immutable() returns trigger
  language plpgsql set search_path = public
as $$
begin
  raise exception
    'mill_passes is append-only: % is not permitted — record a corrective run instead', tg_op
    using errcode = 'restrict_violation';
end $$;
create trigger mill_passes_no_update before update on mill_passes
  for each row execute function _mill_passes_immutable();
create trigger mill_passes_no_delete before delete on mill_passes
  for each row execute function _mill_passes_immutable();
revoke execute on function _mill_passes_immutable() from public;

create or replace function _mill_byproducts_immutable() returns trigger
  language plpgsql set search_path = public
as $$
begin
  raise exception
    'mill_byproducts is append-only: % is not permitted — record a new byproduct row instead', tg_op
    using errcode = 'restrict_violation';
end $$;
create trigger mill_byproducts_no_update before update on mill_byproducts
  for each row execute function _mill_byproducts_immutable();
create trigger mill_byproducts_no_delete before delete on mill_byproducts
  for each row execute function _mill_byproducts_immutable();
revoke execute on function _mill_byproducts_immutable() from public;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Command RPCs — the ONLY write doors. SECURITY DEFINER, tenant-clamped,
--    idempotent on a tenant-qualified key, lot_event appended in the same txn.
-- ════════════════════════════════════════════════════════════════════════════

-- 4a. record_mill_pass — append one machine pass. Enforces cross-pass continuity
--     (pass N input == pass N-1 output; pass 1 input == run's parchment_kg_in). The
--     per-pass mass CHECK lives on the table; this RPC adds the chain-continuity half.
create or replace function record_mill_pass(
  p_run_id        bigint,
  p_pass_no       integer,
  p_machine_kind  text,
  p_input_kg      numeric,
  p_output_kg     numeric,
  p_reject_kg     numeric,
  p_idempotency_key text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant     uuid := current_tenant_id();
  v_key        text;
  v_id         bigint;
  v_lot        text;
  v_parch_in   numeric;
  v_status     text;
  v_expected   numeric;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  -- idempotency early-return (exactly-once replay).
  select id into v_id from mill_passes
   where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then
    return v_id;
  end if;

  -- the run must exist, be ours, and still be OPEN.
  select parchment_lot_code, parchment_kg_in, status
    into v_lot, v_parch_in, v_status
    from milling_runs
   where id = p_run_id and tenant_id = v_tenant;
  if v_lot is null then
    raise exception 'unknown milling run %', p_run_id using errcode = 'foreign_key_violation';
  end if;
  if v_status <> 'open' then
    raise exception 'milling run % is % — passes can only be recorded while open', p_run_id, v_status
      using errcode = 'check_violation';
  end if;

  -- CROSS-PASS CONTINUITY (invariant 1, the in-RPC half): the clean stream is
  -- contiguous — what leaves machine N-1 is exactly what enters machine N (byproduct/
  -- reject leave WITHIN a pass, accounted at run level, not BETWEEN passes).
  if p_pass_no = 1 then
    v_expected := v_parch_in;
  else
    select output_kg into v_expected from mill_passes
     where tenant_id = v_tenant and run_id = p_run_id and pass_no = p_pass_no - 1;
    if v_expected is null then
      raise exception
        'mill-pass continuity broken: pass % has no preceding pass % on run %',
        p_pass_no, p_pass_no - 1, p_run_id
        using errcode = 'check_violation';
    end if;
  end if;
  if abs(p_input_kg - v_expected) > 1e-6 then
    raise exception
      'mill-pass continuity broken: pass % input %.4f kg does not match the expected %.4f kg (prior output / parchment in)',
      p_pass_no, p_input_kg, v_expected
      using errcode = 'check_violation';
  end if;

  insert into mill_passes
    (tenant_id, run_id, pass_no, machine_kind, input_kg, output_kg, reject_kg, idempotency_key)
  values
    (v_tenant, p_run_id, p_pass_no, p_machine_kind::pass_type,
     p_input_kg, p_output_kg, p_reject_kg, v_key)
  returning id into v_id;

  perform record_lot_event(
    v_lot, 'mill_pass_recorded',
    jsonb_build_object('run_id', p_run_id, 'pass_no', p_pass_no, 'machine_kind', p_machine_kind,
                       'input_kg', p_input_kg, 'output_kg', p_output_kg, 'reject_kg', p_reject_kg),
    now(), 'server', nextval('lot_code_seq'), v_key || ':pass');

  return v_id;
end $$;
revoke execute on function record_mill_pass(bigint, integer, text, numeric, numeric, numeric, text) from public;
grant   execute on function record_mill_pass(bigint, integer, text, numeric, numeric, numeric, text) to authenticated;

-- 4b. record_mill_byproduct — mint a fresh sellable byproduct lots node + route a
--     conserved 'byproduct' lot_edge from the parchment lot. The EXISTING
--     lot_edges_conserve_mass() trigger rejects routing more byproduct than the
--     parchment holds — the money/mass guarantee REUSED, not rebuilt. Returns the
--     minted byproduct lot code.
create or replace function record_mill_byproduct(
  p_run_id          bigint,
  p_kind            text,
  p_kg              numeric,
  p_idempotency_key text
) returns text
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant  uuid := current_tenant_id();
  v_key     text;
  v_code    text;
  v_lot     text;
  v_status  text;
  v_variety coffee_variety;
  v_sso     boolean;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  -- idempotency early-return — never mint a SECOND node / edge on replay.
  select byproduct_lot_code into v_code from mill_byproducts
   where tenant_id = v_tenant and idempotency_key = v_key;
  if v_code is not null then
    return v_code;
  end if;

  -- the run must exist, be ours, and still be OPEN.
  select parchment_lot_code, status into v_lot, v_status
    from milling_runs where id = p_run_id and tenant_id = v_tenant;
  if v_lot is null then
    raise exception 'unknown milling run %', p_run_id using errcode = 'foreign_key_violation';
  end if;
  if v_status <> 'open' then
    raise exception 'milling run % is % — byproducts can only be recorded while open', p_run_id, v_status
      using errcode = 'check_violation';
  end if;

  -- carry the parchment lot's lineage onto the byproduct node.
  select variety, is_single_origin into v_variety, v_sso
    from lots where tenant_id = v_tenant and code = v_lot;

  -- mint a fresh, collision-proof byproduct code off the shared lot_code_seq —
  -- same JC-NNN identity scheme as materialize_green_lot (the lots_code_format CHECK
  -- is digits-only `^JC-[0-9]{3,}$`); the byproduct node is distinguished by
  -- stage='byproduct', not a code prefix.
  loop
    v_code := 'JC-' || lpad(nextval('lot_code_seq')::text, 3, '0');
    exit when not exists (select 1 from lots where tenant_id = v_tenant and code = v_code);
  end loop;

  insert into lots (tenant_id, code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
  values (v_tenant, v_code, 'byproduct', v_variety, p_kg, p_kg, coalesce(v_sso, true), now());

  -- the conserved byproduct edge — lot_edges_conserve_mass() fires HERE and rejects
  -- routing more than the parchment lot's available mass (the reused guarantee).
  insert into lot_edges (tenant_id, parent_code, child_code, kind, kg)
  values (v_tenant, v_lot, v_code, 'byproduct', p_kg);

  insert into mill_byproducts (tenant_id, run_id, byproduct_lot_code, kind, kg, idempotency_key)
  values (v_tenant, p_run_id, v_code, p_kind::byproduct_kind, p_kg, v_key);

  perform record_lot_event(
    v_lot, 'mill_byproduct_recorded',
    jsonb_build_object('run_id', p_run_id, 'byproduct_lot_code', v_code,
                       'kind', p_kind, 'kg', p_kg),
    now(), 'server', nextval('lot_code_seq'), v_key || ':byproduct');

  return v_code;
end $$;
revoke execute on function record_mill_byproduct(bigint, text, numeric, text) from public;
grant   execute on function record_mill_byproduct(bigint, text, numeric, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Read views (security_invoker — inherit the caller's RLS on the base tables).
-- ════════════════════════════════════════════════════════════════════════════

-- 5a. mill_run_balance — THE closed-outturn readout. green_out is the run's recorded
--     green_kg_out once finalized (P3-S9), else the final pass's output (the running
--     candidate). accounted_moisture_loss = parchment_in × (moisture% − 10.5 green
--     floor)/100 from the latest passing readiness. loss_ceiling is DERIVED from
--     lot_yield_curve(parchment→green): 10% of the expected processing loss. balance_ok
--     ⇔ the unaccounted residual is in [−1e-9, ceiling] (no mass appearing, none
--     silently vanishing).
create view mill_run_balance with (security_invoker = on) as
select
  c.tenant_id,
  c.run_id,
  c.parchment_lot_code,
  c.parchment_in,
  c.sum_pass_output,
  c.sum_reject,
  c.sum_byproduct,
  c.green_out,
  c.accounted_moisture_loss,
  c.unaccounted_loss,
  c.loss_ceiling,
  ( c.green_out is not null
    and c.unaccounted_loss >= -1e-9
    and c.unaccounted_loss <= c.loss_ceiling ) as balance_ok
from (
  select
    r.tenant_id,
    r.id                                          as run_id,
    r.parchment_lot_code,
    r.parchment_kg_in                             as parchment_in,
    coalesce(p.sum_output, 0)                     as sum_pass_output,
    coalesce(p.sum_reject, 0)                     as sum_reject,
    coalesce(b.sum_byproduct, 0)                  as sum_byproduct,
    coalesce(r.green_kg_out, p.final_output)      as green_out,
    greatest(0, r.parchment_kg_in
                * (coalesce(mr.moisture_pct, 10.5) - 10.5) / 100.0)
                                                  as accounted_moisture_loss,
    ( r.parchment_kg_in
      - coalesce(r.green_kg_out, p.final_output, 0)
      - coalesce(b.sum_byproduct, 0)
      - coalesce(p.sum_reject, 0)
      - greatest(0, r.parchment_kg_in
                    * (coalesce(mr.moisture_pct, 10.5) - 10.5) / 100.0)
    )                                             as unaccounted_loss,
    ( r.parchment_kg_in * (1 - coalesce(yc.yield_factor, 0.80)) * 0.10 )
                                                  as loss_ceiling
  from milling_runs r
  left join lateral (
    select sum(mp.output_kg) as sum_output,
           sum(mp.reject_kg) as sum_reject,
           ( select mp2.output_kg from mill_passes mp2
              where mp2.tenant_id = r.tenant_id and mp2.run_id = r.id
              order by mp2.pass_no desc limit 1 ) as final_output
      from mill_passes mp
     where mp.tenant_id = r.tenant_id and mp.run_id = r.id
  ) p on true
  left join lateral (
    select sum(mb.kg) as sum_byproduct from mill_byproducts mb
     where mb.tenant_id = r.tenant_id and mb.run_id = r.id
  ) b on true
  left join lateral (
    select vmr.moisture_pct from v_mill_readiness vmr
     where vmr.tenant_id = r.tenant_id
       and vmr.parchment_lot_code = r.parchment_lot_code
  ) mr on true
  left join lot_yield_curve yc
    on yc.from_stage = 'parchment' and yc.to_stage = 'green'
) c;

-- 5b. mill_outturn_by_variety — Σ outturn rolled up per variety (the /mill KPI).
create view mill_outturn_by_variety with (security_invoker = on) as
select
  r.tenant_id,
  l.variety,
  sum(r.parchment_kg_in)                              as parchment_kg_in,
  sum(coalesce(r.green_kg_out, fp.final_output))      as green_kg_out,
  case when sum(r.parchment_kg_in) = 0 then null
       else sum(coalesce(r.green_kg_out, fp.final_output)) / sum(r.parchment_kg_in)
  end                                                 as outturn_pct
from milling_runs r
join lots l on l.tenant_id = r.tenant_id and l.code = r.parchment_lot_code
left join lateral (
  select mp.output_kg as final_output from mill_passes mp
   where mp.tenant_id = r.tenant_id and mp.run_id = r.id
   order by mp.pass_no desc limit 1
) fp on true
group by r.tenant_id, l.variety;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. RLS — tenant-scoped read on every new table (mirrors the P3-S0/S7 idiom). All
--    writes flow through the SECDEF RPCs (which self-clamp the tenant), so NO
--    insert/update/delete policy exists — read-only at the policy layer.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array['mill_passes','mill_byproducts']
  loop
    execute format('alter table %I enable row level security;', t);
    execute format(
      'create policy "tenant read" on public.%I for select to authenticated
         using (tenant_id = current_tenant_id());', t);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. GRANTS (AD-8) — per-object SELECT to authenticated (one statement each so the
--    name-anchored static guard matches). NO write grants; anon gets NOTHING.
-- ════════════════════════════════════════════════════════════════════════════
grant select on mill_passes            to authenticated;
grant select on mill_byproducts        to authenticated;
grant select on mill_run_balance       to authenticated;
grant select on mill_outturn_by_variety to authenticated;

commit;
