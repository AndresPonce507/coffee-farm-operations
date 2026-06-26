-- ════════════════════════════════════════════════════════════════════════════
-- P3-S10 · Roasting — versioned golden profiles + Artisan .alog import + roast→SKU.
-- ════════════════════════════════════════════════════════════════════════════
-- Spec: docs/design/PHASE3-DESIGN.md lines 295-301 (+ §1 cross-slice rails + §0.2
--       inherited facts). The green→bag transform's last hop: a finalized roast mints
--       a roasted `lots` node at stage='roasted', green→roasted linked by a CONSERVED
--       kind='roast' lot_edge, and the green draw is committed against ATP by inserting
--       a `lot_shipments` row so the SHIPPED prevent_oversell trigger guards it — the
--       money guarantee REUSED, never rebuilt (§0.2 names "a roast draw" explicitly).
-- Deps: P3-S9 green output (finalize_milling_run / green_lots, 20260705093000),
--       P3-S6 (lot_edges 'roast' kind + roast_level/roaster_type/roast_profile_status
--       enums, 20260705090000), Phase-1 green ATP (green_lots / green_lots_atp /
--       lot_shipments / prevent_oversell), materialize-style mint via lot_code_seq,
--       cost_entry / refresh_lot_cost (costing spine), record_lot_event (hash chain).
-- Live max at authoring: 20260705093000_dry_milling_finalize.sql — this timestamp
--       (20260705094000) is strictly greater; single schema author for the serial lane.
--
-- NOTE on the enum: the design doc's "golden" lock maps onto the ON-DISK
-- roast_profile_status enum ('draft','approved','retired') landed in P3-S6 — 'approved'
-- IS the golden/locked state. lock_roast_profile is the one-way draft→approved; the
-- only onward move is →retired (versioning, never mutation). The status guard trigger
-- makes the one-way monotonic (draft<approved<retired) physically enforced.
--
-- WHAT THIS SLICE OWNS:
--   * roasters — the per-tenant roaster registry (seeded, read-only).
--   * roast_profiles — the versioned golden-curve library. A draft→approved lock is
--     one-way; the status guard rejects any backward move (no mutating a golden curve).
--   * roast_batches — the roasted `lots` node header; shrinkage_pct GENERATED from
--     (green_in_kg − roasted_kg_out)/green_in_kg so it can never drift from the weights.
--   * roast_curve_points / roast_events — the BT/ET/RoR time-series + phase markers
--     parsed from an Artisan .alog (append-only; the $0 capture path).
--   * roast_alog_imports — the .alog receipt + max-deviation-vs-golden (append-only).
--   * roast_skus — closes roast→product for the per-bag QR; the Storefront/Provenance
--     areas read THIS — this slice OWNS the link.
--   * roast_shrinkage_by_lot / roast_traceability — read views (the per-bag QR chain).
--   * lock_roast_profile / open_roast_batch / import_roast_alog / finalize_roast_batch
--     / link_roast_sku (+ create_roast_profile) — the only write doors.
--
-- Rails honored:
--   * One write door — every RPC is SECURITY DEFINER (set search_path = public,
--     extensions), tenant-clamped (v_tenant := current_tenant_id(), fail-closed on
--     null), idempotent on a tenant-qualified key, appending a lot_event in the SAME
--     txn via record_lot_event (stream_key = the green lot's code).
--   * AD-8/AD-9 grants — per-object `grant select … to authenticated`; on every RPC
--     `revoke execute … from public` THEN `grant execute … to authenticated`. anon
--     gets NOTHING. Trigger/guard fns are revoked-from-public with no grant.
--   * Money/mass guarantee REUSED — open_roast_batch inserts a lot_shipments row for
--     the green draw (prevent_oversell fires → can't roast green already reserved/
--     shipped to a buyer, nor more green than exists), and finalize routes the conserved
--     'roast' lot_edge (lot_edges_conserve_mass fires). No parallel counter.
--   * Cost truth — roast cost enters COGS through the SHIPPED cost_entry ledger +
--     refresh_lot_cost; nothing re-implemented.
--   * Tenant seam — every new table carries tenant_id + current_tenant_id() default +
--     RLS `using (tenant_id = current_tenant_id())`. Registered in tenantTables.ts.
--   * No untrusted inbound — the .alog payload is RECORDED as evidence; a human runs
--     finalize/link. convert_qty — no cross-unit math here (every quantity is kg).

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. roasters — per-tenant roaster registry. DIRECT tenant root. Read-only (no
--    client insert/update grant); seeded below per existing tenant.
-- ════════════════════════════════════════════════════════════════════════════
create table roasters (
  id              bigint generated always as identity primary key,
  tenant_id       uuid    not null references tenants(id) default current_tenant_id(),
  name            text    not null,
  kind            roaster_type not null,                       -- P3-S6 enum: drum/fluid_bed/sample
  capacity_kg     numeric not null check (capacity_kg > 0),
  idempotency_key text,
  created_at      timestamptz not null default now(),
  constraint roasters_tenant_idem_ux unique (tenant_id, idempotency_key)
);
create index roasters_tenant_idx on roasters (tenant_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. roast_profiles — the versioned golden-curve library. status flows one-way
--    draft→approved(golden)→retired; a re-tune is a NEW version row, never a mutation.
--    DIRECT tenant root. RPC-only writes (no client insert/update grant).
-- ════════════════════════════════════════════════════════════════════════════
create table roast_profiles (
  id                    bigint generated always as identity primary key,
  tenant_id             uuid    not null references tenants(id) default current_tenant_id(),
  name                  text    not null,
  version               integer not null default 1 check (version >= 1),
  variety               coffee_variety,                        -- nullable: a house style may span varieties
  roast_level           roast_level not null,                  -- P3-S6 enum
  target_charge_temp_c  numeric not null check (target_charge_temp_c > 0),
  target_drop_temp_c    numeric not null check (target_drop_temp_c  > 0),
  target_total_time_s   numeric not null check (target_total_time_s > 0),
  target_dtr_pct        numeric check (target_dtr_pct >= 0 and target_dtr_pct <= 100), -- development time ratio
  status                roast_profile_status not null default 'draft', -- P3-S6 enum: draft/approved/retired
  locked_at             timestamptz,
  retired_at            timestamptz,
  idempotency_key       text,
  created_at            timestamptz not null default now(),
  constraint roast_profiles_tenant_idem_ux unique (tenant_id, idempotency_key),
  constraint roast_profiles_name_version_ux unique (tenant_id, name, version)
);
create index roast_profiles_tenant_idx on roast_profiles (tenant_id);

-- 2a. Status guard — the ONE-WAY lock (draft<approved<retired). A golden ('approved')
--     profile can only retire; nothing can move backward. Trigger fn (not security
--     definer, leading underscore) — revoked from public, never granted.
create or replace function _roast_profile_status_guard() returns trigger
  language plpgsql set search_path = public
as $$
begin
  if new.status = old.status then
    return new;                                  -- no-op (idempotent re-write)
  end if;
  if new.status < old.status then
    raise exception
      'roast_profiles status is one-way (draft→approved→retired): cannot move % back to %',
      old.status, new.status
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;
create trigger roast_profiles_status_guard before update on roast_profiles
  for each row execute function _roast_profile_status_guard();
revoke execute on function _roast_profile_status_guard() from public;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. roast_batches — the roasted lots-node header. shrinkage_pct is GENERATED so it
--    can never disagree with the weights. INHERITED tenant (via the green lot composite
--    FK). NOT immutable (open→finalized); RPC-only writes (no client insert/update).
-- ════════════════════════════════════════════════════════════════════════════
create table roast_batches (
  id                bigint generated always as identity primary key,
  tenant_id         uuid    not null references tenants(id) default current_tenant_id(),
  green_lot_code    text    not null,
  profile_id        bigint  not null references roast_profiles(id),
  roaster_id        bigint  not null references roasters(id),
  green_in_kg       numeric not null check (green_in_kg > 0),
  roasted_lot_code  text,                                       -- the minted roasted node (set at finalize)
  roasted_kg_out    numeric check (roasted_kg_out >= 0),
  shrinkage_pct     numeric generated always as (
    case when roasted_kg_out is null or green_in_kg = 0 then null
         else (green_in_kg - roasted_kg_out) / green_in_kg end
  ) stored,
  green_shipment_id bigint  references lot_shipments(id),       -- the ATP claim backing this batch
  status            text    not null default 'open' check (status in ('open','finalized')),
  opened_at         timestamptz not null default now(),
  idempotency_key   text,
  created_at        timestamptz not null default now(),
  constraint roast_batches_tenant_idem_ux unique (tenant_id, idempotency_key),
  constraint roast_batches_green_lot_tfk
    foreign key (tenant_id, green_lot_code) references green_lots(tenant_id, lot_code)
);
create index roast_batches_tenant_idx on roast_batches (tenant_id);
create index roast_batches_green_idx  on roast_batches (green_lot_code);

-- ════════════════════════════════════════════════════════════════════════════
-- 4. roast_curve_points / roast_events — the Artisan .alog time-series + markers.
--    Append-only physical capture. INHERITED tenant (via batch_id → roast_batches).
-- ════════════════════════════════════════════════════════════════════════════
create table roast_curve_points (
  id              bigint generated always as identity primary key,
  tenant_id       uuid    not null references tenants(id) default current_tenant_id(),
  batch_id        bigint  not null references roast_batches(id),
  t_seconds       numeric not null check (t_seconds >= 0),
  bean_temp_c     numeric,                                      -- BT
  env_temp_c      numeric,                                      -- ET
  ror_c_per_min   numeric,                                      -- rate of rise
  idempotency_key text,
  created_at      timestamptz not null default now(),
  constraint roast_curve_points_tenant_idem_ux unique (tenant_id, idempotency_key)
);
create index roast_curve_points_tenant_idx on roast_curve_points (tenant_id);
create index roast_curve_points_batch_idx  on roast_curve_points (batch_id, t_seconds);

create table roast_events (
  id              bigint generated always as identity primary key,
  tenant_id       uuid    not null references tenants(id) default current_tenant_id(),
  batch_id        bigint  not null references roast_batches(id),
  marker          text    not null,                            -- charge/dry_end/first_crack/drop/…
  t_seconds       numeric not null check (t_seconds >= 0),
  temp_c          numeric,
  idempotency_key text,
  created_at      timestamptz not null default now(),
  constraint roast_events_tenant_idem_ux unique (tenant_id, idempotency_key)
);
create index roast_events_tenant_idx on roast_events (tenant_id);
create index roast_events_batch_idx  on roast_events (batch_id, t_seconds);

-- ════════════════════════════════════════════════════════════════════════════
-- 5. roast_alog_imports — the .alog receipt + max-deviation-vs-golden. Append-only.
--    INHERITED tenant (via batch_id → roast_batches).
-- ════════════════════════════════════════════════════════════════════════════
create table roast_alog_imports (
  id               bigint generated always as identity primary key,
  tenant_id        uuid    not null references tenants(id) default current_tenant_id(),
  batch_id         bigint  not null references roast_batches(id),
  source_filename  text,
  alog_payload     jsonb   not null default '{}'::jsonb,
  max_deviation_c  numeric,                                     -- max |BT − interpolated golden target|
  point_count      integer not null default 0 check (point_count >= 0),
  idempotency_key  text,
  created_at       timestamptz not null default now(),
  constraint roast_alog_imports_tenant_idem_ux unique (tenant_id, idempotency_key)
);
create index roast_alog_imports_tenant_idx on roast_alog_imports (tenant_id);
create index roast_alog_imports_batch_idx  on roast_alog_imports (batch_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 6. roast_skus — closes roast→product (the per-bag QR identity). INHERITED tenant
--    (via batch_id → roast_batches; roasted_lot_code composite-FKs to lots).
-- ════════════════════════════════════════════════════════════════════════════
create table roast_skus (
  id               bigint generated always as identity primary key,
  tenant_id        uuid    not null references tenants(id) default current_tenant_id(),
  roast_batch_id   bigint  not null references roast_batches(id),
  roasted_lot_code text    not null,
  sku_code         text    not null,
  bag_size_g       integer not null check (bag_size_g > 0),
  price_usd_cents  integer check (price_usd_cents >= 0),
  gtin             text,
  is_active        boolean not null default true,
  idempotency_key  text,
  created_at       timestamptz not null default now(),
  constraint roast_skus_tenant_idem_ux unique (tenant_id, idempotency_key),
  constraint roast_skus_tenant_sku_ux  unique (tenant_id, sku_code),
  constraint roast_skus_roasted_lot_tfk
    foreign key (tenant_id, roasted_lot_code) references lots(tenant_id, code)
);
create index roast_skus_tenant_idx on roast_skus (tenant_id);
create index roast_skus_batch_idx  on roast_skus (roast_batch_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Append-only immutability — the three pure capture ledgers. Trigger fns,
--    revoked from public, never granted (no caller surface).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function _roast_curve_points_immutable() returns trigger
  language plpgsql set search_path = public
as $$
begin
  raise exception
    'roast_curve_points is append-only: % is not permitted — re-import the .alog instead', tg_op
    using errcode = 'restrict_violation';
end $$;
create trigger roast_curve_points_no_update before update on roast_curve_points
  for each row execute function _roast_curve_points_immutable();
create trigger roast_curve_points_no_delete before delete on roast_curve_points
  for each row execute function _roast_curve_points_immutable();
revoke execute on function _roast_curve_points_immutable() from public;

create or replace function _roast_events_immutable() returns trigger
  language plpgsql set search_path = public
as $$
begin
  raise exception
    'roast_events is append-only: % is not permitted — record a new marker instead', tg_op
    using errcode = 'restrict_violation';
end $$;
create trigger roast_events_no_update before update on roast_events
  for each row execute function _roast_events_immutable();
create trigger roast_events_no_delete before delete on roast_events
  for each row execute function _roast_events_immutable();
revoke execute on function _roast_events_immutable() from public;

create or replace function _roast_alog_imports_immutable() returns trigger
  language plpgsql set search_path = public
as $$
begin
  raise exception
    'roast_alog_imports is append-only: % is not permitted — import a new .alog instead', tg_op
    using errcode = 'restrict_violation';
end $$;
create trigger roast_alog_imports_no_update before update on roast_alog_imports
  for each row execute function _roast_alog_imports_immutable();
create trigger roast_alog_imports_no_delete before delete on roast_alog_imports
  for each row execute function _roast_alog_imports_immutable();
revoke execute on function _roast_alog_imports_immutable() from public;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. Command RPCs — the ONLY write doors. SECURITY DEFINER, tenant-clamped,
--    idempotent on a tenant-qualified key, lot_event appended in the same txn.
-- ════════════════════════════════════════════════════════════════════════════

-- 8a. create_roast_profile — author a new DRAFT golden-curve candidate. Versions per
--     (tenant, name): a re-author of the same name mints the next version.
create or replace function create_roast_profile(
  p_name               text,
  p_variety            text,
  p_roast_level        text,
  p_target_charge_temp_c numeric,
  p_target_drop_temp_c   numeric,
  p_target_total_time_s  numeric,
  p_target_dtr_pct       numeric,
  p_idempotency_key      text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant  uuid := current_tenant_id();
  v_key     text;
  v_id      bigint;
  v_version integer;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  select id into v_id from roast_profiles where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then return v_id; end if;

  select coalesce(max(version), 0) + 1 into v_version
    from roast_profiles where tenant_id = v_tenant and name = p_name;

  insert into roast_profiles
    (tenant_id, name, version, variety, roast_level, target_charge_temp_c,
     target_drop_temp_c, target_total_time_s, target_dtr_pct, status, idempotency_key)
  values
    (v_tenant, p_name, v_version, p_variety::coffee_variety, p_roast_level::roast_level,
     p_target_charge_temp_c, p_target_drop_temp_c, p_target_total_time_s, p_target_dtr_pct,
     'draft', v_key)
  returning id into v_id;

  return v_id;
end $$;
revoke execute on function create_roast_profile(text, text, text, numeric, numeric, numeric, numeric, text) from public;
grant   execute on function create_roast_profile(text, text, text, numeric, numeric, numeric, numeric, text) to authenticated;

-- 8b. lock_roast_profile — the ONE-WAY draft→approved (golden) lock. Raises unless the
--     profile is currently draft. A locked profile is versioned, never mutated.
create or replace function lock_roast_profile(
  p_profile_id      bigint,
  p_idempotency_key text
) returns text
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_key    text;
  v_status roast_profile_status;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  select status into v_status from roast_profiles
   where id = p_profile_id and tenant_id = v_tenant;
  if v_status is null then
    raise exception 'unknown roast profile %', p_profile_id using errcode = 'foreign_key_violation';
  end if;
  -- idempotent replay: already golden → return without re-locking.
  if v_status = 'approved' then
    return v_status::text;
  end if;
  if v_status <> 'draft' then
    raise exception
      'roast profile % is % — only a draft can be locked golden (versioning is one-way)', p_profile_id, v_status
      using errcode = 'check_violation';
  end if;

  update roast_profiles
     set status = 'approved', locked_at = now()
   where id = p_profile_id and tenant_id = v_tenant;

  perform record_lot_event(
    'roast-profile:' || p_profile_id, 'roast_profile_locked',
    jsonb_build_object('profile_id', p_profile_id),
    now(), 'server', nextval('lot_code_seq'), v_key || ':locked');

  return 'approved';
end $$;
revoke execute on function lock_roast_profile(bigint, text) from public;
grant   execute on function lock_roast_profile(bigint, text) to authenticated;

-- 8c. open_roast_batch — open a batch against a GOLDEN profile + a green lot. KEYSTONE
--     GATES: (1) the profile must be 'approved' (golden); (2) the green draw is
--     committed by inserting a lot_shipments row, so the SHIPPED prevent_oversell
--     trigger physically rejects roasting more green than the lot's ATP (and green
--     already reserved/shipped to a buyer is unavailable — invariant 3).
create or replace function open_roast_batch(
  p_green_lot_code  text,
  p_profile_id      bigint,
  p_roaster_id      bigint,
  p_green_in_kg     numeric,
  p_idempotency_key text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant  uuid := current_tenant_id();
  v_key     text;
  v_id      bigint;
  v_status  roast_profile_status;
  v_atp     numeric;
  v_ship    bigint;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  select id into v_id from roast_batches where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then return v_id; end if;

  -- (1) GOLDEN-PROFILE GATE — can't roast against a draft / retired curve.
  select status into v_status from roast_profiles
   where id = p_profile_id and tenant_id = v_tenant;
  if v_status is null then
    raise exception 'unknown roast profile %', p_profile_id using errcode = 'foreign_key_violation';
  end if;
  if v_status <> 'approved' then
    raise exception
      'roast profile % is % — only a GOLDEN (approved) profile can be roasted against', p_profile_id, v_status
      using errcode = 'check_violation';
  end if;

  -- the roaster must exist and be ours.
  if not exists (select 1 from roasters where id = p_roaster_id and tenant_id = v_tenant) then
    raise exception 'unknown roaster %', p_roaster_id using errcode = 'foreign_key_violation';
  end if;

  -- the green lot must exist, be ours, and be green.
  if not exists (
    select 1 from lots where tenant_id = v_tenant and code = p_green_lot_code and stage = 'green'
  ) then
    raise exception 'unknown green lot %', p_green_lot_code using errcode = 'foreign_key_violation';
  end if;

  -- friendly pre-check (the hard wall is prevent_oversell on the shipment insert below):
  -- tenant-clamped ATP = current_kg − Σreservations − Σshipments.
  select coalesce(l.current_kg, l.origin_kg, 0)
         - coalesce((select sum(kg) from lot_reservations r
                      where r.green_lot_code = p_green_lot_code and r.tenant_id = v_tenant), 0)
         - coalesce((select sum(kg) from lot_shipments s
                      where s.green_lot_code = p_green_lot_code and s.tenant_id = v_tenant), 0)
    into v_atp
    from lots l where l.code = p_green_lot_code and l.tenant_id = v_tenant;
  if v_atp < p_green_in_kg - 1e-9 then
    raise exception
      'roast oversell: green lot % has only %.3f kg available-to-promise; cannot draw %.3f kg to the roaster (already sold/reserved)',
      p_green_lot_code, v_atp, p_green_in_kg
      using errcode = 'check_violation';
  end if;

  -- (2) THE MONEY GUARANTEE REUSED — commit the green draw as a lot_shipments row.
  --     prevent_oversell fires HERE and is the authoritative guard; §0.2 names "a roast
  --     draw" as one of the acts that commit green inventory through this trigger.
  insert into lot_shipments (tenant_id, green_lot_code, destination, kg)
  values (v_tenant, p_green_lot_code, 'roaster', p_green_in_kg)
  returning id into v_ship;

  insert into roast_batches
    (tenant_id, green_lot_code, profile_id, roaster_id, green_in_kg, green_shipment_id, status, idempotency_key)
  values
    (v_tenant, p_green_lot_code, p_profile_id, p_roaster_id, p_green_in_kg, v_ship, 'open', v_key)
  returning id into v_id;

  perform record_lot_event(
    p_green_lot_code, 'roast_batch_opened',
    jsonb_build_object('batch_id', v_id, 'profile_id', p_profile_id, 'roaster_id', p_roaster_id,
                       'green_in_kg', p_green_in_kg, 'shipment_id', v_ship),
    now(), 'server', nextval('lot_code_seq'), v_key || ':opened');

  return v_id;
end $$;
revoke execute on function open_roast_batch(text, bigint, bigint, numeric, text) from public;
grant   execute on function open_roast_batch(text, bigint, bigint, numeric, text) to authenticated;

-- 8d. import_roast_alog — the $0 capture path. Parses a normalized Artisan .alog jsonb
--     ({points:[{t,bt,et,ror}], events:[{marker,t,temp}]}), inserts the curve points +
--     phase markers, and computes the max |BT − golden target| where the golden target
--     is a linear interpolation charge→drop over [0, target_total_time_s] of the batch's
--     profile. Idempotent on the import key.
create or replace function import_roast_alog(
  p_batch_id        bigint,
  p_source_filename text,
  p_alog_payload    jsonb,
  p_idempotency_key text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant   uuid := current_tenant_id();
  v_key      text;
  v_id       bigint;
  v_green    text;
  v_status   text;
  v_charge   numeric;
  v_drop     numeric;
  v_total    numeric;
  v_max_dev  numeric;
  v_count    integer;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  select id into v_id from roast_alog_imports where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then return v_id; end if;

  -- the batch must exist and be ours; pull its green lot + golden profile targets.
  select b.green_lot_code, b.status, p.target_charge_temp_c, p.target_drop_temp_c, p.target_total_time_s
    into v_green, v_status, v_charge, v_drop, v_total
    from roast_batches b
    join roast_profiles p on p.id = b.profile_id and p.tenant_id = b.tenant_id
   where b.id = p_batch_id and b.tenant_id = v_tenant;
  if v_green is null then
    raise exception 'unknown roast batch %', p_batch_id using errcode = 'foreign_key_violation';
  end if;

  -- insert the curve points (BT/ET/RoR) — each carries a per-row idempotency key.
  insert into roast_curve_points
    (tenant_id, batch_id, t_seconds, bean_temp_c, env_temp_c, ror_c_per_min, idempotency_key)
  select v_tenant, p_batch_id,
         (e.pt->>'t')::numeric, (e.pt->>'bt')::numeric, (e.pt->>'et')::numeric, (e.pt->>'ror')::numeric,
         v_key || ':pt:' || (e.ord - 1)
    from jsonb_array_elements(coalesce(p_alog_payload->'points', '[]'::jsonb)) with ordinality as e(pt, ord);

  -- insert the phase markers (charge/dry_end/first_crack/drop/…).
  insert into roast_events
    (tenant_id, batch_id, marker, t_seconds, temp_c, idempotency_key)
  select v_tenant, p_batch_id,
         e.ev->>'marker', (e.ev->>'t')::numeric, (e.ev->>'temp')::numeric,
         v_key || ':ev:' || (e.ord - 1)
    from jsonb_array_elements(coalesce(p_alog_payload->'events', '[]'::jsonb)) with ordinality as e(ev, ord);

  -- DEVIATION vs GOLDEN — max |BT − interpolated target(t)|; target ramps linearly from
  -- the charge temp (t=0) to the drop temp (t=total_time), clamped past drop.
  select max(abs(
           (e.pt->>'bt')::numeric
           - (v_charge + (v_drop - v_charge) * least(1.0, (e.pt->>'t')::numeric / nullif(v_total, 0)))
         )),
         count(*)::integer
    into v_max_dev, v_count
    from jsonb_array_elements(coalesce(p_alog_payload->'points', '[]'::jsonb)) e(pt)
   where e.pt ? 'bt';

  insert into roast_alog_imports
    (tenant_id, batch_id, source_filename, alog_payload, max_deviation_c, point_count, idempotency_key)
  values
    (v_tenant, p_batch_id, p_source_filename, p_alog_payload, v_max_dev, coalesce(v_count, 0), v_key)
  returning id into v_id;

  perform record_lot_event(
    v_green, 'roast_alog_imported',
    jsonb_build_object('batch_id', p_batch_id, 'import_id', v_id,
                       'max_deviation_c', v_max_dev, 'point_count', coalesce(v_count, 0)),
    now(), 'server', nextval('lot_code_seq'), v_key || ':alog');

  return v_id;
end $$;
revoke execute on function import_roast_alog(bigint, text, jsonb, text) from public;
grant   execute on function import_roast_alog(bigint, text, jsonb, text) to authenticated;

-- 8e. finalize_roast_batch — mint the roasted lots node, route the CONSERVED 'roast'
--     lot_edge (lot_edges_conserve_mass guards it), post the roast cost into COGS, and
--     finalize. Idempotent on the batch (a replayed finalize returns the same minted
--     roasted code and posts NO second cost row).
create or replace function finalize_roast_batch(
  p_batch_id        bigint,
  p_roasted_kg_out  numeric,
  p_roast_cost_usd  numeric,
  p_location        text,
  p_idempotency_key text
) returns text
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant   uuid := current_tenant_id();
  v_key      text;
  v_green    text;
  v_status   text;
  v_green_in numeric;
  v_variety  coffee_variety;
  v_sso      boolean;
  v_roasted  text;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  select green_lot_code, status, green_in_kg, roasted_lot_code
    into v_green, v_status, v_green_in, v_roasted
    from roast_batches where id = p_batch_id and tenant_id = v_tenant;
  if v_green is null then
    raise exception 'unknown roast batch %', p_batch_id using errcode = 'foreign_key_violation';
  end if;

  -- idempotent: an already-finalized batch returns its minted roasted code.
  if v_status = 'finalized' then
    return v_roasted;
  end if;
  if v_status <> 'open' then
    raise exception 'roast batch % is % — only an open batch can be finalized', p_batch_id, v_status
      using errcode = 'check_violation';
  end if;
  if p_roasted_kg_out > v_green_in + 1e-9 then
    raise exception
      'roast batch %: roasted out %.3f kg cannot exceed green in %.3f kg (roasting only loses mass)',
      p_batch_id, p_roasted_kg_out, v_green_in
      using errcode = 'check_violation';
  end if;

  -- carry the green lot's lineage onto the roasted node.
  select variety, is_single_origin into v_variety, v_sso
    from lots where tenant_id = v_tenant and code = v_green;

  -- mint a fresh JC-NNN roasted node off the shared sequence (lots_code_format ^JC-…$;
  -- distinguished by stage='roasted', not a code prefix).
  loop
    v_roasted := 'JC-' || lpad(nextval('lot_code_seq')::text, 3, '0');
    exit when not exists (select 1 from lots where tenant_id = v_tenant and code = v_roasted);
  end loop;

  insert into lots (tenant_id, code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
  values (v_tenant, v_roasted, 'roasted', v_variety, p_roasted_kg_out, p_roasted_kg_out,
          coalesce(v_sso, true), now());

  -- the CONSERVED 'roast' edge: routes the consumed green mass (green_in_kg) from the
  -- green lot to the roasted node. lot_edges_conserve_mass rejects routing more green
  -- than the lot holds — the mass guarantee REUSED (the roasted node carries the
  -- post-shrinkage weight; the edge carries the consumed green weight).
  insert into lot_edges (tenant_id, parent_code, child_code, kind, kg)
  values (v_tenant, v_green, v_roasted, 'roast', v_green_in);

  update roast_batches
     set roasted_lot_code = v_roasted, roasted_kg_out = p_roasted_kg_out, status = 'finalized'
   where id = p_batch_id and tenant_id = v_tenant;

  -- post the roast cost so it flows into the costing ledger.
  if coalesce(p_roast_cost_usd, 0) > 0 then
    insert into cost_entry (tenant_id, driver, allocation_rule, target_kind, target_code, amount_usd, occurred_at)
    values (v_tenant, 'processing-batch', 'processing', 'lot', v_roasted, p_roast_cost_usd, now());
    perform refresh_lot_cost();
  end if;

  perform record_lot_event(
    v_green, 'roast_finalized',
    jsonb_build_object('batch_id', p_batch_id, 'roasted_lot_code', v_roasted,
                       'green_in_kg', v_green_in, 'roasted_kg_out', p_roasted_kg_out,
                       'roast_cost_usd', coalesce(p_roast_cost_usd, 0), 'location', p_location),
    now(), 'server', nextval('lot_code_seq'), v_key || ':finalized');

  return v_roasted;
end $$;
revoke execute on function finalize_roast_batch(bigint, numeric, numeric, text, text) from public;
grant   execute on function finalize_roast_batch(bigint, numeric, numeric, text, text) to authenticated;

-- 8f. link_roast_sku — close roast→product. Requires a FINALIZED batch; the SKU points
--     at the batch's roasted lot (the per-bag QR's load-bearing link the Storefront reads).
create or replace function link_roast_sku(
  p_batch_id        bigint,
  p_sku_code        text,
  p_bag_size_g      integer,
  p_price_usd_cents integer,
  p_gtin            text,
  p_idempotency_key text
) returns bigint
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant  uuid := current_tenant_id();
  v_key     text;
  v_id      bigint;
  v_green   text;
  v_status  text;
  v_roasted text;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  select id into v_id from roast_skus where tenant_id = v_tenant and idempotency_key = v_key;
  if v_id is not null then return v_id; end if;

  select green_lot_code, status, roasted_lot_code into v_green, v_status, v_roasted
    from roast_batches where id = p_batch_id and tenant_id = v_tenant;
  if v_green is null then
    raise exception 'unknown roast batch %', p_batch_id using errcode = 'foreign_key_violation';
  end if;
  if v_status <> 'finalized' or v_roasted is null then
    raise exception 'roast batch % is not finalized — finalize it before linking a SKU', p_batch_id
      using errcode = 'check_violation';
  end if;

  insert into roast_skus
    (tenant_id, roast_batch_id, roasted_lot_code, sku_code, bag_size_g, price_usd_cents, gtin, idempotency_key)
  values
    (v_tenant, p_batch_id, v_roasted, p_sku_code, p_bag_size_g, p_price_usd_cents, p_gtin, v_key)
  returning id into v_id;

  perform record_lot_event(
    v_green, 'roast_sku_linked',
    jsonb_build_object('batch_id', p_batch_id, 'sku_id', v_id, 'roasted_lot_code', v_roasted,
                       'sku_code', p_sku_code, 'bag_size_g', p_bag_size_g),
    now(), 'server', nextval('lot_code_seq'), v_key || ':sku');

  return v_id;
end $$;
revoke execute on function link_roast_sku(bigint, text, integer, integer, text, text) from public;
grant   execute on function link_roast_sku(bigint, text, integer, integer, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 9. Read views (security_invoker — inherit the caller's RLS on the base tables).
-- ════════════════════════════════════════════════════════════════════════════

-- 9a. roast_shrinkage_by_lot — Σ green-in / Σ roasted-out + the realized shrinkage,
--     rolled up per green lot over its finalized batches (the /roast KPI).
create view roast_shrinkage_by_lot with (security_invoker = on) as
select
  b.tenant_id,
  b.green_lot_code,
  sum(b.green_in_kg)                                   as green_in_kg,
  sum(b.roasted_kg_out)                                as roasted_kg_out,
  case when sum(b.green_in_kg) = 0 then null
       else (sum(b.green_in_kg) - sum(b.roasted_kg_out)) / sum(b.green_in_kg)
  end                                                  as shrinkage_pct
from roast_batches b
where b.status = 'finalized'
group by b.tenant_id, b.green_lot_code;

-- 9b. roast_traceability — the per-bag QR chain: roast batch → roasted node → green lot
--     → SCA prep + cup score + the golden profile that produced it.
create view roast_traceability with (security_invoker = on) as
select
  b.tenant_id,
  b.id                       as roast_batch_id,
  b.roasted_lot_code,
  b.green_lot_code,
  b.green_in_kg,
  b.roasted_kg_out,
  b.shrinkage_pct,
  b.status,
  p.name                     as profile_name,
  p.version                  as profile_version,
  p.roast_level,
  p.status                   as profile_status,
  gl.cupping_score,
  gl.sca_grade,
  vg.sca_prep,
  vg.cat1_defects,
  vg.cat2_defects
from roast_batches b
join roast_profiles p on p.id = b.profile_id and p.tenant_id = b.tenant_id
join green_lots gl    on gl.tenant_id = b.tenant_id and gl.lot_code = b.green_lot_code
left join v_green_grade vg on vg.tenant_id = b.tenant_id and vg.green_lot_code = b.green_lot_code;

-- ════════════════════════════════════════════════════════════════════════════
-- 10. RLS — tenant-scoped read on every new table (mirrors the P3-S7/S8/S9 idiom).
--     All writes flow through the SECDEF RPCs (which self-clamp the tenant), so NO
--     insert/update/delete policy exists — read-only at the policy layer.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array['roasters','roast_profiles','roast_batches','roast_curve_points',
                           'roast_events','roast_alog_imports','roast_skus']
  loop
    execute format('alter table %I enable row level security;', t);
    execute format(
      'create policy "tenant read" on public.%I for select to authenticated
         using (tenant_id = current_tenant_id());', t);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 11. GRANTS (AD-8) — per-object SELECT to authenticated (one statement each so the
--     name-anchored static guard matches). NO write grants; anon gets NOTHING.
-- ════════════════════════════════════════════════════════════════════════════
grant select on roasters              to authenticated;
grant select on roast_profiles        to authenticated;
grant select on roast_batches         to authenticated;
grant select on roast_curve_points    to authenticated;
grant select on roast_events          to authenticated;
grant select on roast_alog_imports    to authenticated;
grant select on roast_skus            to authenticated;
grant select on roast_shrinkage_by_lot to authenticated;
grant select on roast_traceability    to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 12. Seed one drum roaster per existing tenant (read-only registry; the family's
--     real Probat-class drum roaster). Future roasters are added by a one-off seed.
-- ════════════════════════════════════════════════════════════════════════════
insert into roasters (tenant_id, name, kind, capacity_kg)
select id, 'Probat L12 (drum)', 'drum', 12 from tenants
on conflict do nothing;

commit;
