-- ════════════════════════════════════════════════════════════════════════════
-- P3-S7 · Mill readiness + run skeleton — THE no-mill-out-of-spec gate.
-- ════════════════════════════════════════════════════════════════════════════
-- Spec: docs/design/PHASE3-DESIGN.md lines 269-278 (+ §1 cross-slice rails).
-- Deps: P3-S6 (mill/roast edge-kinds + enums, 20260705090000), Phase-1 lots/workers,
--       Phase-2 P2-S4 reposo gate (reposo_status / v_reposo_status, 20260622094000).
-- Live max at authoring: 20260705090000_lot_edges_mill_roast_kinds.sql — this is
-- strictly greater, single schema author for the serial migration lane.
--
-- The keystone (invariant 2): a parchment lot physically CANNOT open a milling run
-- unless a PASSING mill_readiness row exists — moisture 10.5–11.5%, water-activity
-- aw < 0.60, AND the upstream Phase-2 reposo clearance reads `ready`. The single
-- biggest outturn-killer (milling green that is still too wet / unrested) is blocked
-- at the DATA layer, not just the UI.
--
-- HOW THE REPOSO GATE IS WIRED (the design doc predates the on-disk schema):
--   The doc names "rest_periods.cleared_for_milling" — that table does NOT exist.
--   The real, on-disk P2-S4 reposo clearance is the function reposo_status(lot).ready
--   (wrapped by the v_reposo_status view). record_mill_readiness SNAPSHOTS that
--   `ready` flag into mill_readiness.reposo_ready at record time, and `passed` is a
--   GENERATED column that folds the moisture/aw spec AND that reposo snapshot together
--   — so "a passing readiness row" means clear-on-spec AND clear-on-reposo, and
--   open_milling_run's single `passed=true` check is airtight.
--
-- Rails honored:
--   * One write door — record_mill_readiness / open_milling_run are SECURITY DEFINER
--     (set search_path = public, extensions), tenant-clamped, idempotent on a
--     tenant-qualified key, appending a lot_event in the SAME txn.
--   * AD-8/AD-9 grants — per-object `grant select … to authenticated`; on every RPC
--     `revoke execute … from public` THEN `grant execute … to authenticated`. anon
--     gets NOTHING.
--   * Tenant seam — every new table carries tenant_id + current_tenant_id() default +
--     RLS `using (tenant_id = current_tenant_id())`; the lot-bound tables composite-FK
--     to lots(tenant_id, code). New RLS tables are registered in src/test/db/
--     tenantTables.ts (the §8 parity contract).
--   * Money guarantee UNTOUCHED — milling CONSUMES parchment; it never commits green
--     inventory, so it inserts NO lot_reservations/lot_shipments row and introduces NO
--     parallel counter. The shared prevent_oversell seam is left entirely alone. (The
--     parchment→green mass-conserving lot_edges('mill') edge + the green-lot
--     materialization land at finalize in a downstream slice; S7 is the run SKELETON.)
--   * convert_qty — no unit math in this slice (kg in / kg out are both kg).

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. mill_machines — the dry-mill chain registry (huller→polisher→screen-grader→
--    gravity-table→optical-sorter). A read-only reference surface for the /mill UI;
--    hours_run / calibration_due are tracked here. DIRECT tenant root (no parent FK),
--    seeded; no client write path (so no insert/update grant — the registry is owner-
--    seeded, a maintenance-log RPC is a later concern).
-- ════════════════════════════════════════════════════════════════════════════
create table mill_machines (
  id              bigint generated always as identity primary key,
  tenant_id       uuid    not null references tenants(id) default current_tenant_id(),
  kind            pass_type not null,                       -- P3-S6 enum
  name            text    not null,
  hours_run       numeric not null default 0 check (hours_run >= 0),
  calibration_due date,
  idempotency_key text,
  created_at      timestamptz not null default now(),
  constraint mill_machines_tenant_idem_ux unique (tenant_id, idempotency_key)
);
create index mill_machines_tenant_idx on mill_machines (tenant_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. mill_readiness — THE pre-mill reposo/spec gate. Append-only: each physical
--    moisture/aw measurement is a NEW row (corrections never edit; you re-measure).
--    `passed` is GENERATED from the moisture band + aw ceiling AND the snapshotted
--    upstream reposo clearance (reposo_ready). NB the 10.5–11.5 / 0.60 thresholds are
--    the mill-spec constants (spec line 269) — held as literals because a GENERATED
--    column cannot subquery farm_season_config; they intentionally match the reposo
--    moisture band defaults.
-- ════════════════════════════════════════════════════════════════════════════
create table mill_readiness (
  id                 bigint generated always as identity primary key,
  tenant_id          uuid    not null references tenants(id) default current_tenant_id(),
  parchment_lot_code text    not null,
  moisture_pct       numeric not null check (moisture_pct >= 0 and moisture_pct <= 100),
  water_activity_aw  numeric not null check (water_activity_aw >= 0 and water_activity_aw <= 1),
  -- snapshot of reposo_status(lot).ready (the P2-S4 upstream clearance) at record time.
  reposo_ready       boolean not null default false,
  -- THE GATE: in-spec moisture AND in-spec aw AND rested/cleared (reposo). All three.
  passed             boolean generated always as (
    moisture_pct >= 10.5 and moisture_pct <= 11.5
    and water_activity_aw < 0.60
    and reposo_ready
  ) stored,
  measured_at        timestamptz not null default now(),
  idempotency_key    text,
  created_at         timestamptz not null default now(),
  constraint mill_readiness_tenant_idem_ux unique (tenant_id, idempotency_key),
  constraint mill_readiness_parchment_lot_tfk
    foreign key (tenant_id, parchment_lot_code) references lots(tenant_id, code)
);
create index mill_readiness_tenant_idx on mill_readiness (tenant_id);
create index mill_readiness_lot_idx    on mill_readiness (parchment_lot_code, measured_at desc);

-- ════════════════════════════════════════════════════════════════════════════
-- 3. milling_runs — one parchment lot through the chain. A SKELETON in S7: open_*
--    creates the row (status 'open', parchment_kg_in set); green_kg_out + the
--    'finalized' transition land in a downstream slice. outturn_pct is GENERATED
--    (NULL until green_kg_out is known). NOT immutable — finalize updates it via a
--    future RPC; clients are blocked by the absent UPDATE grant + read-only policy.
-- ════════════════════════════════════════════════════════════════════════════
create table milling_runs (
  id                 bigint generated always as identity primary key,
  tenant_id          uuid    not null references tenants(id) default current_tenant_id(),
  parchment_lot_code text    not null,
  parchment_kg_in    numeric not null check (parchment_kg_in > 0),
  green_kg_out       numeric check (green_kg_out >= 0),
  outturn_pct        numeric generated always as (
    case when green_kg_out is null or parchment_kg_in = 0 then null
         else green_kg_out / parchment_kg_in end
  ) stored,
  status             text    not null default 'open'
                       check (status in ('readiness_pending','open','finalized')),
  opened_at          timestamptz not null default now(),
  idempotency_key    text,
  created_at         timestamptz not null default now(),
  constraint milling_runs_tenant_idem_ux unique (tenant_id, idempotency_key),
  constraint milling_runs_parchment_lot_tfk
    foreign key (tenant_id, parchment_lot_code) references lots(tenant_id, code)
);
create index milling_runs_tenant_idx on milling_runs (tenant_id);
create index milling_runs_lot_idx    on milling_runs (parchment_lot_code);

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Append-only immutability — mill_readiness can never be edited/deleted (a
--    falsified spec reading is exactly what the gate exists to prevent). Trigger fn,
--    revoked from public, never granted (no caller surface).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function _mill_readiness_immutable() returns trigger
  language plpgsql set search_path = public
as $$
begin
  raise exception
    'mill_readiness is append-only: % is not permitted — record a new measurement instead', tg_op
    using errcode = 'restrict_violation';
end $$;
create trigger mill_readiness_no_update before update on mill_readiness
  for each row execute function _mill_readiness_immutable();
create trigger mill_readiness_no_delete before delete on mill_readiness
  for each row execute function _mill_readiness_immutable();
revoke execute on function _mill_readiness_immutable() from public;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Command RPCs — the ONLY write doors. SECURITY DEFINER, tenant-clamped,
--    idempotent on a tenant-qualified key, lot_event appended in the same txn.
-- ════════════════════════════════════════════════════════════════════════════

-- 5a. record_mill_readiness — append a measurement; snapshot the reposo clearance.
create or replace function record_mill_readiness(
  p_parchment_lot_code text,
  p_moisture_pct       numeric,
  p_water_activity_aw  numeric,
  p_measured_at        timestamptz,
  p_idempotency_key    text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_key    text;
  v_id     bigint;
  v_ready  boolean;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;
  select id into v_id from mill_readiness
   where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then
    return v_id;                                  -- exactly-once replay
  end if;

  -- Read the P2-S4 upstream reposo clearance (the gate the doc calls
  -- "cleared_for_milling"). Snapshot it: an append-only readiness row records the
  -- state AT measurement time; a later re-measure picks up a newer reposo state.
  select ready into v_ready from reposo_status(p_parchment_lot_code);
  v_ready := coalesce(v_ready, false);

  insert into mill_readiness
    (tenant_id, parchment_lot_code, moisture_pct, water_activity_aw,
     reposo_ready, measured_at, idempotency_key)
  values
    (v_tenant, p_parchment_lot_code, p_moisture_pct, p_water_activity_aw,
     v_ready, coalesce(p_measured_at, now()), v_key)
  returning id into v_id;

  perform record_lot_event(
    p_parchment_lot_code, 'mill_readiness',
    jsonb_build_object('readiness_id', v_id, 'moisture_pct', p_moisture_pct,
                       'water_activity_aw', p_water_activity_aw, 'reposo_ready', v_ready),
    now(), 'server', nextval('lot_code_seq'), v_key || ':readiness');

  return v_id;
end $$;
revoke execute on function record_mill_readiness(text, numeric, numeric, timestamptz, text) from public;
grant   execute on function record_mill_readiness(text, numeric, numeric, timestamptz, text) to authenticated;

-- 5b. open_milling_run — THE no-mill-out-of-spec gate. RAISES (check_violation)
--     unless a passing mill_readiness row exists for the lot. Appends 'mill_run_opened'.
create or replace function open_milling_run(
  p_parchment_lot_code text,
  p_parchment_kg_in    numeric,
  p_idempotency_key    text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_key    text;
  v_id     bigint;
  v_passed boolean;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;
  select id into v_id from milling_runs
   where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then
    return v_id;                                  -- exactly-once replay
  end if;

  -- THE KEYSTONE GATE (invariant 2): a passing readiness (in-spec moisture + aw +
  -- reposo-cleared) MUST exist for this lot, or the door stays shut.
  select exists (
    select 1 from mill_readiness
     where tenant_id = v_tenant
       and parchment_lot_code = p_parchment_lot_code
       and passed
  ) into v_passed;
  if not v_passed then
    raise exception
      'no-mill-out-of-spec: parchment lot % has no passing mill_readiness (need moisture 10.5-11.5%%, aw < 0.60, and reposo cleared) — cannot open a milling run',
      p_parchment_lot_code
      using errcode = 'check_violation';
  end if;

  insert into milling_runs (tenant_id, parchment_lot_code, parchment_kg_in, status, idempotency_key)
  values (v_tenant, p_parchment_lot_code, p_parchment_kg_in, 'open', v_key)
  returning id into v_id;

  perform record_lot_event(
    p_parchment_lot_code, 'mill_run_opened',
    jsonb_build_object('run_id', v_id, 'parchment_kg_in', p_parchment_kg_in),
    now(), 'server', nextval('lot_code_seq'), v_key || ':opened');

  return v_id;
end $$;
revoke execute on function open_milling_run(text, numeric, text) from public;
grant   execute on function open_milling_run(text, numeric, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Read views (security_invoker — inherit caller RLS on the base tables).
-- ════════════════════════════════════════════════════════════════════════════

-- 6a. v_milling_runs — the /mill board read model (run + outturn + status).
create view v_milling_runs with (security_invoker = on) as
  select r.tenant_id,
         r.id                 as run_id,
         r.parchment_lot_code,
         r.parchment_kg_in,
         r.green_kg_out,
         r.outturn_pct,
         r.status,
         r.opened_at
    from milling_runs r;

-- 6b. v_mill_readiness — the latest readiness per parchment lot (the gate panel).
create view v_mill_readiness with (security_invoker = on) as
  select distinct on (mr.tenant_id, mr.parchment_lot_code)
         mr.tenant_id,
         mr.parchment_lot_code,
         mr.moisture_pct,
         mr.water_activity_aw,
         mr.reposo_ready,
         mr.passed,
         mr.measured_at
    from mill_readiness mr
   order by mr.tenant_id, mr.parchment_lot_code, mr.measured_at desc, mr.id desc;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. RLS — tenant-scoped read on every new table (mirrors the P3-S0 idiom). All
--    writes flow through the SECDEF RPCs (which self-clamp the tenant), so NO
--    insert/update/delete policy exists — read-only at the policy layer.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array['mill_machines','mill_readiness','milling_runs']
  loop
    execute format('alter table %I enable row level security;', t);
    execute format(
      'create policy "tenant read" on public.%I for select to authenticated
         using (tenant_id = current_tenant_id());', t);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. GRANTS (AD-8) — per-object SELECT to authenticated (one statement each so the
--    name-anchored static guard matches). NO write grants; anon gets NOTHING.
-- ════════════════════════════════════════════════════════════════════════════
grant select on mill_machines    to authenticated;
grant select on mill_readiness   to authenticated;
grant select on milling_runs     to authenticated;
grant select on v_milling_runs   to authenticated;
grant select on v_mill_readiness to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 9. Seed — the 5-stage dry-mill chain registry ($0, hand-seeded). tenant_id
--    defaults to current_tenant_id() (the single-estate tenant at migration time).
-- ════════════════════════════════════════════════════════════════════════════
insert into mill_machines (kind, name, idempotency_key) values
  ('huller',         'Pinhalense huller',        'seed:mill-huller'),
  ('polisher',       'Pinhalense polisher',      'seed:mill-polisher'),
  ('screen_grader',  'Screen grader',            'seed:mill-screen-grader'),
  ('gravity_table',  'Oliver gravity table',     'seed:mill-gravity-table'),
  ('optical_sorter', 'Optical colour sorter',    'seed:mill-optical-sorter')
on conflict (tenant_id, idempotency_key) do nothing;

commit;
