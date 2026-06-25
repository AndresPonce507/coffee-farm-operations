-- ════════════════════════════════════════════════════════════════════════════
-- P3-S2 · B2B sample tracking + sample-approval-as-contract-prerequisite.
-- ════════════════════════════════════════════════════════════════════════════
-- Spec: docs/design/PHASE3-DESIGN.md lines 213–224 (+ §1 cross-slice rails).
-- Depends (HARD): P3-S1 (b2b_buyers / sales_contracts / contract_lines /
--                 sign_sales_contract); Phase-1 green inventory (green_lots /
--                 green_lots_atp / lot_shipments / prevent_oversell); P3-S0
--                 (price_regime_for_lot); lot_event / record_lot_event; convert_qty.
--
-- THE KEYSTONE: a reserve contract cannot be SIGNED until the buyer has APPROVED a
--   pre-shipment sample of every reserve-band lot on it. sign_sales_contract (owned
--   by P3-S1, re-created here on the seam it left) now gates on an approved
--   pre_shipment green_samples row — the database refuses to sign a Geisha contract
--   that was never sampled.
--
-- DOCUMENTED DEGRADATION (spec §213-224): sample grams are NOT routed through
--   lot_edges (sub-100 g is below the mass-conservation resolution — a side ledger,
--   same spirit as Phase-1's green_lot_mass fallback). offer / type / arbitration
--   samples are tracked as pure documentation (no ATP claim). A PRE_SHIPMENT sample —
--   physically drawn from inventory and couriered — DOES route a lot_shipments draw
--   (grams→kg via convert_qty), so the EXISTING prevent_oversell trigger guards it
--   for free: a sample cannot be pulled from a lot already fully committed. (The
--   sample_dispatches ATP-claim variant is the P3-S18 CRM path, deconflicted there.)
--
-- Rails honored:
--   * One write door — log_sample / record_sample_verdict are SECURITY DEFINER
--     (set search_path = public, extensions), tenant-clamped, idempotent on a
--     tenant-qualified key, appending the relevant lot_event in the SAME txn
--     (sample_logged / sample_approved).
--   * AD-8/AD-9 grants — per-object `grant select … to authenticated`; on every RPC
--     `revoke execute … from public` THEN `grant execute … to authenticated`. anon
--     gets NOTHING.
--   * Tenant seam — green_samples carries tenant_id + current_tenant_id() default +
--     an RLS read policy `using (tenant_id = current_tenant_id())`. Registered in
--     src/test/db/tenantTables.ts (INHERITED — via green_lots).
--   * Append-only at the client boundary — green_samples has NO client UPDATE/DELETE
--     grant and NO update/delete policy; the verdict transition is written by
--     record_sample_verdict as owner (the price_quotes posture — no all-blocking
--     immutability trigger, the RPC must set the verdict columns).
--   * The money guarantee is REUSED, not rebuilt — a pre-shipment draw is a
--     lot_shipments INSERT; prevent_oversell fires. No parallel counter.
--   * grams→kg routes through convert_qty(p_grams,'g','kg') (never a hardcoded /1000).

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. sample_kind enum — the four B2B sample stages.
-- ════════════════════════════════════════════════════════════════════════════
create type sample_kind as enum ('offer', 'pre_shipment', 'type', 'arbitration');

-- ════════════════════════════════════════════════════════════════════════════
-- 2. green_samples — append-only (client-boundary) sample ledger. grams + courier +
--    plain-text tracking_no ($0 paid-gate: a deep link to the courier's public
--    tracker, NO carrier API). buyer_score / buyer_verdict are written later by
--    record_sample_verdict (as owner); clients hold no UPDATE grant. shipment_id is
--    set only when a pre_shipment draw claimed ATP via lot_shipments.
-- ════════════════════════════════════════════════════════════════════════════
create table green_samples (
  id              bigint generated always as identity primary key,
  tenant_id       uuid    not null references tenants(id) default current_tenant_id(),
  green_lot_code  text    not null,
  buyer_id        bigint  references b2b_buyers(id),         -- NULL = a spec/type sample (no requester)
  sample_kind     sample_kind not null,
  grams           numeric not null check (grams > 0),
  courier         text,
  tracking_no     text,                                      -- plain text + public-tracker deep link ($0)
  shipment_id     bigint  references lot_shipments(id),      -- set iff a pre_shipment ATP draw fired
  buyer_score     numeric check (buyer_score is null or (buyer_score >= 0 and buyer_score <= 100)),
  buyer_verdict   text    check (buyer_verdict is null or buyer_verdict in ('approved', 'rejected', 'counter')),
  verdict_at      timestamptz,
  dispatched_at   timestamptz not null default now(),
  idempotency_key text,
  created_at      timestamptz not null default now(),
  constraint green_samples_green_lot_tfk
    foreign key (tenant_id, green_lot_code) references green_lots(tenant_id, lot_code),
  constraint green_samples_tenant_idem_ux unique (tenant_id, idempotency_key)
);
create index green_samples_tenant_idx on green_samples (tenant_id);
create index green_samples_lot_idx    on green_samples (tenant_id, green_lot_code);
-- partial index for the keystone prereq lookup (approved pre-shipment samples per lot).
create index green_samples_approved_idx on green_samples (tenant_id, green_lot_code)
  where sample_kind = 'pre_shipment' and buyer_verdict = 'approved';

-- ════════════════════════════════════════════════════════════════════════════
-- 3. v_sample_pipeline (security_invoker) — open samples awaiting buyer feedback
--    (verdict NULL) ⨝ buyer name ⨝ green-lot grade/score.
-- ════════════════════════════════════════════════════════════════════════════
create view v_sample_pipeline with (security_invoker = on) as
  select
    s.tenant_id,
    s.id            as sample_id,
    s.green_lot_code,
    s.buyer_id,
    b.name          as buyer_name,
    s.sample_kind,
    s.grams,
    s.courier,
    s.tracking_no,
    s.dispatched_at,
    g.sca_grade,
    g.cupping_score
  from green_samples s
  left join b2b_buyers b on b.id = s.buyer_id and b.tenant_id = s.tenant_id
  join green_lots g on g.lot_code = s.green_lot_code and g.tenant_id = s.tenant_id
  where s.buyer_verdict is null;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. log_sample — the sample-dispatch writer. For sample_kind='pre_shipment' it
--    draws ATP first (lot_shipments INSERT → prevent_oversell fires), then logs the
--    sample carrying the shipment_id. offer/type/arbitration are documentation only
--    (no claim — sub-resolution side ledger). Appends 'sample_logged'.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function log_sample(
  p_green_lot_code  text,
  p_buyer_id        bigint,
  p_sample_kind     text,
  p_grams           numeric,
  p_courier         text,
  p_tracking_no     text,
  p_idempotency_key text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_key    text;
  v_id     bigint;
  v_kind   sample_kind;
  v_ship   bigint;
  v_kg     numeric;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  select id into v_id from green_samples where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then
    return v_id;                                   -- exactly-once replay
  end if;

  v_kind := p_sample_kind::sample_kind;

  if p_buyer_id is not null
     and not exists (select 1 from b2b_buyers where id = p_buyer_id and tenant_id = v_tenant) then
    raise exception 'unknown buyer % for tenant', p_buyer_id using errcode = 'foreign_key_violation';
  end if;

  -- A PRE_SHIPMENT sample is physically drawn from inventory: claim ATP via
  -- lot_shipments so the EXISTING prevent_oversell trigger guards it (no parallel
  -- counter). grams→kg routes through convert_qty (never a hardcoded /1000).
  if v_kind = 'pre_shipment' then
    v_kg := convert_qty(p_grams, 'g', 'kg');
    insert into lot_shipments (tenant_id, green_lot_code, destination, kg)
    values (v_tenant, p_green_lot_code, 'sample:' || coalesce(p_tracking_no, p_idempotency_key), v_kg)
    returning id into v_ship;
  end if;

  insert into green_samples (tenant_id, green_lot_code, buyer_id, sample_kind, grams,
                             courier, tracking_no, shipment_id, idempotency_key)
  values (v_tenant, p_green_lot_code, p_buyer_id, v_kind, p_grams,
          p_courier, p_tracking_no, v_ship, v_key)
  returning id into v_id;

  perform record_lot_event(
    p_green_lot_code, 'sample_logged',
    jsonb_build_object('sample_id', v_id, 'sample_kind', p_sample_kind, 'grams', p_grams,
                       'buyer_id', p_buyer_id, 'courier', p_courier, 'tracking_no', p_tracking_no,
                       'shipment_id', v_ship),
    now(), 'server', nextval('lot_code_seq'), v_key || ':logged');

  return v_id;
end $$;
revoke execute on function log_sample(text, bigint, text, numeric, text, text, text) from public;
grant   execute on function log_sample(text, bigint, text, numeric, text, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. record_sample_verdict — the buyer's feedback writer. Sets buyer_score +
--    buyer_verdict + verdict_at on the sample row (as owner; clients hold no UPDATE
--    grant). Appends 'sample_approved' ONLY on approval (the keystone unlock event).
--    Idempotent: a replay that re-asserts the SAME verdict returns without re-firing;
--    a 'counter' may later be superseded by 'approved'.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function record_sample_verdict(
  p_sample_id       bigint,
  p_buyer_score     numeric,
  p_buyer_verdict   text,
  p_idempotency_key text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant  uuid := current_tenant_id();
  v_key     text;
  v_sample  record;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  if p_buyer_verdict not in ('approved', 'rejected', 'counter') then
    raise exception 'invalid sample verdict % (approved|rejected|counter)', p_buyer_verdict
      using errcode = 'check_violation';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  select * into v_sample from green_samples
   where id = p_sample_id and tenant_id = v_tenant;
  if not found then
    raise exception 'unknown sample %', p_sample_id using errcode = 'foreign_key_violation';
  end if;

  -- idempotent replay: the SAME verdict already recorded → no-op return.
  if v_sample.buyer_verdict is not distinct from p_buyer_verdict then
    return p_sample_id;
  end if;

  update green_samples
     set buyer_score = p_buyer_score, buyer_verdict = p_buyer_verdict, verdict_at = now()
   where id = p_sample_id and tenant_id = v_tenant;

  -- Append 'sample_approved' ONLY on approval (the contract-unlock event). A
  -- rejection/counter is recorded on the row but does not append the unlock event;
  -- record_lot_event itself dedupes on the tenant-qualified key.
  if p_buyer_verdict = 'approved' then
    perform record_lot_event(
      v_sample.green_lot_code, 'sample_approved',
      jsonb_build_object('sample_id', p_sample_id, 'sample_kind', v_sample.sample_kind,
                         'buyer_id', v_sample.buyer_id, 'buyer_score', p_buyer_score),
      now(), 'server', nextval('lot_code_seq'), v_key || ':approved');
  end if;

  return p_sample_id;
end $$;
revoke execute on function record_sample_verdict(bigint, numeric, text, text) from public;
grant   execute on function record_sample_verdict(bigint, numeric, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. THE KEYSTONE — sign_sales_contract gains the reserve-sample prerequisite.
--    Re-created here on the explicit seam P3-S1 left ("add the green_samples prereq
--    there, not here"). Carries forward ALL P3-S1 logic verbatim, then adds: for
--    every distinct reserve-band lot (price_regime_for_lot = 'reserve') on the
--    contract, an APPROVED pre_shipment green_samples row must exist or the sign is
--    refused. Commodity contracts are unaffected.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function sign_sales_contract(
  p_contract_id     bigint,
  p_idempotency_key text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_key    text;
  v_no     text;
  v_status text;
  v_lines  integer;
  r        record;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  select contract_no, status into v_no, v_status
    from sales_contracts where id = p_contract_id and tenant_id = v_tenant;
  if v_no is null then
    raise exception 'unknown contract % for tenant', p_contract_id using errcode = 'foreign_key_violation';
  end if;
  if v_status = 'signed' then
    return p_contract_id;                          -- idempotent
  end if;
  if v_status <> 'draft' then
    raise exception 'contract % cannot be signed from status %', v_no, v_status
      using errcode = 'check_violation';
  end if;

  select count(*) into v_lines from contract_lines
   where contract_id = p_contract_id and tenant_id = v_tenant;
  if v_lines = 0 then
    raise exception 'contract % cannot be signed with no lines', v_no
      using errcode = 'check_violation';
  end if;

  -- P3-S2 KEYSTONE: every reserve-band lot on this contract must have an APPROVED
  -- pre-shipment sample before the contract can be signed. The crown-jewel ships
  -- only after the buyer has cupped what they will receive.
  for r in
    select distinct green_lot_code from contract_lines
     where contract_id = p_contract_id and tenant_id = v_tenant
  loop
    if price_regime_for_lot(r.green_lot_code) = 'reserve' then
      if not exists (
        select 1 from green_samples
         where tenant_id = v_tenant
           and green_lot_code = r.green_lot_code
           and sample_kind = 'pre_shipment'
           and buyer_verdict = 'approved'
      ) then
        raise exception
          'reserve contract %: green lot % needs an APPROVED pre-shipment sample before signing',
          v_no, r.green_lot_code
          using errcode = 'check_violation';
      end if;
    end if;
  end loop;

  update sales_contracts set status = 'signed', signed_at = now()
   where id = p_contract_id and tenant_id = v_tenant;

  -- append a 'contract_signed' event per distinct green lot (verify_chain covers
  -- offer→sold for each lot).
  for r in
    select distinct green_lot_code from contract_lines
     where contract_id = p_contract_id and tenant_id = v_tenant
  loop
    perform record_lot_event(
      r.green_lot_code, 'contract_signed',
      jsonb_build_object('contract_id', p_contract_id, 'contract_no', v_no,
                         'green_lot_code', r.green_lot_code),
      now(), 'server', nextval('lot_code_seq'),
      v_key || ':signed:' || r.green_lot_code);
  end loop;

  return p_contract_id;
end $$;
revoke execute on function sign_sales_contract(bigint, text) from public;
grant   execute on function sign_sales_contract(bigint, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. RLS — tenant-scoped read on green_samples (mirrors the P4-S0 idiom). Writes
--    flow through the SECDEF RPCs (which bypass RLS + self-clamp the tenant), so NO
--    insert/update/delete policy — read-only at the policy layer (client append-only).
-- ════════════════════════════════════════════════════════════════════════════
alter table green_samples enable row level security;
create policy "tenant read" on public.green_samples for select to authenticated
  using (tenant_id = current_tenant_id());

-- ════════════════════════════════════════════════════════════════════════════
-- 8. GRANTS (AD-8) — per-object SELECT to authenticated (one statement each so the
--    name-anchored static guard matches). NO write grants; anon gets NOTHING. RPC
--    execute is revoked-from-public-then-granted above.
-- ════════════════════════════════════════════════════════════════════════════
grant select on green_samples     to authenticated;
grant select on v_sample_pipeline to authenticated;

commit;
