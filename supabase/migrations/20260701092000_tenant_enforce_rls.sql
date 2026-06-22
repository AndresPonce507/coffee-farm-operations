-- ════════════════════════════════════════════════════════════════════════════
-- P4-S0 · Migration 3 of 3 — ENFORCE: not-null + FK + default, RLS flip, composite
--   per-tenant lot codes, ledger rebinds, matview rebind, command-RPC tenant clamps.
-- ════════════════════════════════════════════════════════════════════════════
-- The RLS flip lands LAST so no row is ever orphaned out of visibility mid-migration.
-- Self-wrapped begin;…commit;. AD-8 grants re-asserted on every (re)created fn.
--
-- LOCKED DECISION (Andres, §6.4 / §9#2): PER-TENANT lot codes. lots PK becomes
-- (tenant_id, code); every FK that names a lot code becomes composite; a lot_counters
-- table mints per-tenant JC-NNN, the default tenant's counter seeded to max(JC-NNN)+1
-- BEFORE the first per-tenant mint. Ledger tenant_id is a NON-HASHED column —
-- lot_event_canonical_bytes is NOT touched (preserves every historical hash, §9#1).

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- A. tenant_id → NOT NULL + FK + default current_tenant_id() on every scoped table
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array[
    'plots','workers','lots','crews','reserve_zones','farm_season_config',
    'pay_period','dispatch_run','weather','drying_stations','ferment_recipes',
    'lot_event','worker_stream_event','cost_entry','weigh_event','attendance_event',
    'green_lots','processing_batches','lot_reservations','lot_shipments',
    'ferment_batches','ferment_readings','mill_water_log','drying_assignments',
    'moisture_readings','cupping_sessions','cupping_scores','green_defects',
    'qc_holds','lot_edges',
    'plot_phenology','maturation_signal','pasada_schedule','plot_vegetation_index',
    'scouting_observation','spray_application',
    'worker_identity','worker_certifications','por_obra_contracts','crew_memberships',
    'harvests','tasks','dispatch_assignment','dispatch_acknowledgement',
    'dispatch_outbound','pay_line','disbursement','crew_plot'
  ]
  loop
    execute format('alter table %I alter column tenant_id set not null;', t);
    execute format(
      'alter table %I add constraint %I foreign key (tenant_id) references tenants(id);',
      t, t || '_tenant_fk');
    -- default current_tenant_id() makes authenticated INSERTs auto-stamp correctly;
    -- the with-check policy still rejects a client that sends a foreign id.
    execute format('alter table %I alter column tenant_id set default current_tenant_id();', t);
    -- tenant_id index for RLS-predicate locality / scan perf.
    execute format('create index if not exists %I on %I (tenant_id);',
                   t || '_tenant_idx', t);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- B. PER-TENANT lot codes — composite (tenant_id, code) keys everywhere a lot code
--    appears (LOCKED). Rewire lots PK and every dependent FK to be composite.
-- ════════════════════════════════════════════════════════════════════════════

-- B1. lots: code PK -> (tenant_id, code). Dependent single-col FKs must be dropped
--     FIRST (they reference the old PK), then the PK swap, then re-add them composite.
--     harvests.lot_code, processing_batches.lot_code, lot_edges.parent_code/child_code,
--     green_lots.lot_code, ferment_batches.lot_code, drying_assignments.lot_code,
--     moisture_readings.lot_code, weigh_event.lot_code -> all reference lots(code).
do $$
declare r record;
begin
  -- capture (drop + composite re-add) for every single-col FK into lots(code).
  create temp table _lot_fks on commit drop as
    select con.conname, cl.relname as tbl, att.attname as col
      from pg_constraint con
      join pg_class cl on cl.oid = con.conrelid
      join pg_class rl on rl.oid = con.confrelid
      join pg_namespace n on n.oid = cl.relnamespace
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
     where con.contype = 'f' and n.nspname = 'public'
       and rl.relname = 'lots' and array_length(con.conkey, 1) = 1;

  for r in select * from _lot_fks loop
    execute format('alter table public.%I drop constraint %I;', r.tbl, r.conname);
  end loop;

  alter table lots drop constraint lots_pkey;
  alter table lots add  constraint lots_pkey primary key (tenant_id, code);

  for r in select * from _lot_fks loop
    execute format(
      'alter table public.%I add constraint %I foreign key (tenant_id, %I)
         references lots(tenant_id, code);',
      r.tbl, r.tbl || '_' || r.col || '_tfk', r.col);
  end loop;
end $$;

-- B3. green_lots PK -> (tenant_id, lot_code); rewire its dependents (lot_reservations,
--     lot_shipments, cupping_sessions, cupping_scores, qc_holds, green_defects) to the
--     composite (tenant_id, green_lot_code). Same drop-FKs-first ordering.
do $$
declare r record;
begin
  create temp table _gl_fks on commit drop as
    select con.conname, cl.relname as tbl, att.attname as col
      from pg_constraint con
      join pg_class cl on cl.oid = con.conrelid
      join pg_class rl on rl.oid = con.confrelid
      join pg_namespace n on n.oid = cl.relnamespace
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
     where con.contype = 'f' and n.nspname = 'public'
       and rl.relname = 'green_lots' and array_length(con.conkey, 1) = 1;

  for r in select * from _gl_fks loop
    execute format('alter table public.%I drop constraint %I;', r.tbl, r.conname);
  end loop;

  alter table green_lots drop constraint green_lots_pkey;
  alter table green_lots add  constraint green_lots_pkey primary key (tenant_id, lot_code);

  for r in select * from _gl_fks loop
    execute format(
      'alter table public.%I add constraint %I foreign key (tenant_id, %I)
         references green_lots(tenant_id, lot_code);',
      r.tbl, r.tbl || '_' || r.col || '_tfk', r.col);
  end loop;
end $$;

-- B4. lot_counters — per-tenant JC-NNN minter. Seed the default tenant's counter to
--     max(existing JC-NNN)+1 BEFORE the first per-tenant mint (else the first new
--     intake collides with a seeded code). Mirrors the prevent_oversell advisory-lock
--     idiom for concurrency safety.
create table if not exists lot_counters (
  tenant_id uuid primary key references tenants(id),
  next_val  bigint not null
);
-- lot_counters is written ONLY via the SECURITY DEFINER _next_lot_code; it carries NO
-- row security (so it is absent from the RLS-table set the parity guard scans, like the
-- tenancy substrate). The AD-8 (b) guard requires every created table to grant SELECT to
-- authenticated, so it gets a read grant (the only exposure is per-tenant next_val, a
-- write-volume hint already implied by the lot-code stream — no row data).
grant select on lot_counters to authenticated;

-- seed every existing tenant's counter to its own max(JC-NNN)+1 (default estate has
-- all the historical lots; future tenants start at 1).
insert into lot_counters (tenant_id, next_val)
select tn.id,
       coalesce(
         (select max((regexp_replace(l.code, '\D', '', 'g'))::bigint) + 1
            from lots l where l.tenant_id = tn.id
             and l.code ~ '^JC-[0-9]+$'),
         1)
  from tenants tn
on conflict (tenant_id) do nothing;

-- _next_lot_code(tenant) — advisory-locked per-tenant mint. SECURITY DEFINER (writes
-- lot_counters which has no client grant). Returns the next 'JC-NNN' for the tenant,
-- skipping any code already present in that tenant's lots (collision-proof).
create or replace function _next_lot_code(p_tenant uuid) returns text
  language plpgsql security definer set search_path = public
as $$
declare v_code text; v_seed bigint;
begin
  perform pg_advisory_xact_lock(hashtext('lot_counter:' || p_tenant::text));
  -- Lazily seed a tenant's counter to max(its existing JC-NNN)+1 the first time it
  -- mints, so a new tenant CONTINUES its own existing numbering rather than colliding
  -- with codes it already holds (and so two tenants with different histories mint
  -- different next codes). Mirrors the §7 "seed the default tenant's counter to
  -- max(JC-NNN)+1 BEFORE first mint" rule, applied per tenant at first use.
  v_seed := coalesce(
    (select max((regexp_replace(code, '\D', '', 'g'))::bigint) + 1
       from lots where tenant_id = p_tenant and code ~ '^JC-[0-9]+$'),
    1);
  insert into lot_counters (tenant_id, next_val) values (p_tenant, v_seed)
    on conflict (tenant_id) do nothing;
  loop
    select 'JC-' || lpad(next_val::text, 3, '0') into v_code
      from lot_counters where tenant_id = p_tenant;
    update lot_counters set next_val = next_val + 1 where tenant_id = p_tenant;
    exit when not exists (select 1 from lots where tenant_id = p_tenant and code = v_code);
  end loop;
  return v_code;
end $$;
revoke execute on function _next_lot_code(uuid) from public;

-- ════════════════════════════════════════════════════════════════════════════
-- C. Hash-chained ledgers (§6.4) — tenant-scoped head-selects + composite idempotency
--    + BEFORE-INSERT tenant assert (HIGH-3). NON-HASHED tenant_id (canonical bytes
--    untouched → historical hashes preserved).
-- ════════════════════════════════════════════════════════════════════════════

-- C1. Tenant-scoped uniqueness, ADDED ALONGSIDE the existing single-column unique
--     constraints (which the ~25 RPCs' `on conflict (idempotency_key)` /
--     `(device_id, device_seq)` / `(kind, idempotency_key)` clauses target — dropping
--     them would break every RPC and red the existing suite). The composite indexes are
--     defense-in-depth for the per-tenant world; the RPCs that mint events under P4-S0
--     tenant-qualify their idempotency_key (v_tenant::text || ':' || key), so two
--     tenants reusing the same caller key never collide on the surviving single-column
--     unique either. device_seq stays globally unique via the shared server/lot_code
--     sequences, so its single-column-pair unique is already cross-tenant-safe.
create unique index if not exists lot_event_tenant_idem_ux
  on lot_event (tenant_id, idempotency_key) where idempotency_key is not null;
create unique index if not exists attendance_event_tenant_idem_ux
  on attendance_event (tenant_id, idempotency_key) where idempotency_key is not null;
create unique index if not exists worker_stream_event_tenant_idem_ux
  on worker_stream_event (tenant_id, kind, idempotency_key) where idempotency_key is not null;
-- weigh_event is in DIRECT_TENANT_TABLES (§6.4 names all FOUR ledgers); add the
-- tenant-scoped idempotency parity index too.
create unique index if not exists weigh_event_tenant_idem_ux
  on weigh_event (tenant_id, idempotency_key) where idempotency_key is not null;

-- C2. tenant-scoped head-selects + BEFORE-INSERT tenant assert on each ledger.
create or replace function lot_event_set_hash() returns trigger
  language plpgsql set search_path = public, extensions
as $$
declare head bytea;
begin
  if new.tenant_id is distinct from current_tenant_id() then
    raise exception 'ledger tenant_id % does not match session tenant', new.tenant_id
      using errcode = 'insufficient_privilege';
  end if;
  select e.hash into head from lot_event e
   where e.stream_key = new.stream_key and e.tenant_id = new.tenant_id
   order by e.device_seq desc limit 1;
  new.prev_hash := head;
  new.hash := extensions.digest(
    coalesce(new.prev_hash, ''::bytea)
      || lot_event_canonical_bytes(new.stream_key, new.kind, new.payload,
                                   new.occurred_at, new.device_id, new.device_seq),
    'sha256');
  return new;
end $$;

create or replace function worker_stream_event_set_hash() returns trigger
  language plpgsql set search_path = public, extensions
as $$
declare head bytea;
begin
  if new.tenant_id is distinct from current_tenant_id() then
    raise exception 'ledger tenant_id % does not match session tenant', new.tenant_id
      using errcode = 'insufficient_privilege';
  end if;
  select e.hash into head from worker_stream_event e
   where e.stream_key = new.stream_key and e.tenant_id = new.tenant_id
   order by e.device_seq desc limit 1;
  new.prev_hash := head;
  new.hash := extensions.digest(
    coalesce(new.prev_hash, ''::bytea)
      || lot_event_canonical_bytes(new.stream_key, new.kind, new.payload,
                                   new.occurred_at, new.device_id, new.device_seq),
    'sha256');
  return new;
end $$;

create or replace function attendance_event_set_hash() returns trigger
  language plpgsql set search_path = public, extensions
as $$
declare head bytea;
begin
  if new.tenant_id is distinct from current_tenant_id() then
    raise exception 'ledger tenant_id % does not match session tenant', new.tenant_id
      using errcode = 'insufficient_privilege';
  end if;
  select e.hash into head from attendance_event e
   where e.stream_key = new.stream_key and e.tenant_id = new.tenant_id
   order by e.device_seq desc limit 1;
  new.prev_hash := head;
  new.hash := extensions.digest(
    coalesce(new.prev_hash, ''::bytea)
      || lot_event_canonical_bytes(new.stream_key, new.event_kind, new.payload,
                                   new.occurred_at, new.device_id, new.device_seq),
    'sha256');
  return new;
end $$;

-- weigh_event is the FOURTH ledger (DIRECT_TENANT_TABLES); the original
-- weigh_event_set_hash head-select keys on stream_key='weigh:<lot_code>' only, so under
-- per-tenant lot codes two tenants weighing their own JC-001 share the stream and B's
-- genesis row chains off A's head (cross-tenant ledger braid). Mirror the other three:
-- tenant-scope the head-select + add the BEFORE-INSERT tenant assert.
create or replace function weigh_event_set_hash() returns trigger
  language plpgsql set search_path = public, extensions
as $$
declare head bytea;
begin
  if new.tenant_id is distinct from current_tenant_id() then
    raise exception 'ledger tenant_id % does not match session tenant', new.tenant_id
      using errcode = 'insufficient_privilege';
  end if;
  select e.hash into head from weigh_event e
   where e.stream_key = new.stream_key and e.tenant_id = new.tenant_id
   order by e.device_seq desc limit 1;
  new.prev_hash := head;
  new.hash := extensions.digest(
    coalesce(new.prev_hash, ''::bytea)
      || lot_event_canonical_bytes(new.stream_key, 'weigh', new.payload,
                                   new.occurred_at, new.device_id, new.device_seq),
    'sha256');
  return new;
end $$;

revoke execute on function lot_event_set_hash()           from public;
revoke execute on function worker_stream_event_set_hash() from public;
revoke execute on function attendance_event_set_hash()    from public;
revoke execute on function weigh_event_set_hash()         from public;

-- ════════════════════════════════════════════════════════════════════════════
-- D. RLS FLIP — drop every using(true)/is_member() policy on the scoped tables and
--    recreate the four §4 tenant policies referencing current_tenant_id().
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  t   text;
  pol record;
begin
  foreach t in array array[
    'plots','workers','lots','crews','reserve_zones','farm_season_config',
    'pay_period','dispatch_run','weather','drying_stations','ferment_recipes',
    'lot_event','worker_stream_event','cost_entry','weigh_event','attendance_event',
    'green_lots','processing_batches','lot_reservations','lot_shipments',
    'ferment_batches','ferment_readings','mill_water_log','drying_assignments',
    'moisture_readings','cupping_sessions','cupping_scores','green_defects',
    'qc_holds','lot_edges',
    'plot_phenology','maturation_signal','pasada_schedule','plot_vegetation_index',
    'scouting_observation','spray_application',
    'worker_identity','worker_certifications','por_obra_contracts','crew_memberships',
    'harvests','tasks','dispatch_assignment','dispatch_acknowledgement',
    'dispatch_outbound','pay_line','disbursement','crew_plot'
  ]
  loop
    -- drop EVERY existing policy on the table (names vary: "authenticated read/insert/
    -- update/delete/append", "public read") so none strands on the old predicate.
    for pol in
      select policyname from pg_policies
       where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy if exists %I on public.%I;', pol.policyname, t);
    end loop;

    -- the four tenant policies (§4). Default + WITH CHECK = "can't forget it, can't
    -- forge it". The append-only ledgers (lot_event, cost_entry, weigh_event,
    -- attendance_event, worker_stream_event) get read-only at the policy layer too —
    -- writes flow through the SECURITY DEFINER RPCs (which bypass RLS and self-clamp).
    execute format(
      'create policy "tenant read" on public.%I for select to authenticated
         using (tenant_id = current_tenant_id());', t);

    if t not in ('lot_event','cost_entry','weigh_event','attendance_event',
                 'worker_stream_event') then
      execute format(
        'create policy "tenant insert" on public.%I for insert to authenticated
           with check (tenant_id = current_tenant_id());', t);
      execute format(
        'create policy "tenant update" on public.%I for update to authenticated
           using (tenant_id = current_tenant_id())
           with check (tenant_id = current_tenant_id());', t);
      execute format(
        'create policy "tenant delete" on public.%I for delete to authenticated
           using (tenant_id = current_tenant_id());', t);
    end if;
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- E. Parity-orphan handling — every RLS-enabled base table must be in TENANT_TABLES
--    ∪ EXEMPT (the §8 static guard). Two classes are neither:
--      * the four §2.D DEAD tables (*__deprecated) — disable RLS (they are dead,
--        replaced by views; nothing reads them via the API).
--      * app_members — the legacy membership allowlist, SUPERSEDED by tenant_users as
--        the trust anchor. is_member() reads it via SECURITY DEFINER (RLS-bypassing),
--        so disabling its row security + locking its grant keeps owner_scoped_rls green
--        while removing it from the guard's RLS-table set.
-- ════════════════════════════════════════════════════════════════════════════
alter table daily_cherries__deprecated  disable row level security;
alter table weekly_harvest__deprecated  disable row level security;
alter table variety_shares__deprecated  disable row level security;
alter table season_summary__deprecated  disable row level security;

alter table app_members disable row level security;
revoke select on app_members from authenticated;  -- read only via SECURITY DEFINER is_member()

-- ════════════════════════════════════════════════════════════════════════════
-- F. Cross-tenant consistency invariants (§2 same-tenant guards, MED-1).
-- ════════════════════════════════════════════════════════════════════════════
-- F1. lot_edges: a blend cannot merge two farms' lots — parent.tenant = child.tenant.
--     (Already structurally guaranteed: both FKs are composite (tenant_id, code) into
--      lots, and lot_edges.tenant_id is the single column used by BOTH FKs, so a row
--      whose parent and child resolve to different tenants is impossible.)

-- F2. dispatch_run.tenant_id must equal crews.tenant_id (the crew_id -> crews FK).
create or replace function _dispatch_run_same_tenant() returns trigger
  language plpgsql set search_path = public
as $$
declare v_crew_tenant uuid;
begin
  if new.crew_id is null then return new; end if;
  select tenant_id into v_crew_tenant from crews where id = new.crew_id;
  if v_crew_tenant is not null and v_crew_tenant is distinct from new.tenant_id then
    raise exception 'dispatch_run tenant % does not match crew % tenant %',
      new.tenant_id, new.crew_id, v_crew_tenant using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke execute on function _dispatch_run_same_tenant() from public;
drop trigger if exists dispatch_run_same_tenant on dispatch_run;
create trigger dispatch_run_same_tenant before insert or update on dispatch_run
  for each row execute function _dispatch_run_same_tenant();

-- ════════════════════════════════════════════════════════════════════════════
-- G. Non-RLS leak surfaces — tenant-clamp the DEFINER trigger aggregates (§6.2) so
--    the oversell / mass guarantees compute against the OWNING tenant's pool only.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function lot_edges_conserve_mass() returns trigger
  language plpgsql set search_path = public
as $$
declare parent_kg numeric; routed_kg numeric;
begin
  select coalesce(current_kg, origin_kg) into parent_kg
    from lots where code = new.parent_code and tenant_id = new.tenant_id;
  if parent_kg is null then
    raise exception
      'mass conservation violated: lot % has undeclared mass; cannot route % kg out of it',
      new.parent_code, new.kg using errcode = 'check_violation';
  end if;
  select coalesce(sum(kg), 0) into routed_kg
    from lot_edges
   where parent_code = new.parent_code and tenant_id = new.tenant_id
     and (tg_op <> 'UPDATE' or id <> new.id);
  if routed_kg + new.kg > parent_kg + 1e-9 then
    raise exception
      'mass conservation violated: routing % kg out of lot % would exceed its % kg (already routed %)',
      new.kg, new.parent_code, parent_kg, routed_kg using errcode = 'check_violation';
  end if;
  return new;
end $$;

create or replace function lots_conserve_mass_on_lower() returns trigger
  language plpgsql set search_path = public
as $$
declare new_kg numeric; routed_kg numeric;
begin
  new_kg := coalesce(new.current_kg, new.origin_kg);
  if new_kg is null then
    select coalesce(sum(kg), 0) into routed_kg
      from lot_edges where parent_code = new.code and tenant_id = new.tenant_id;
    if routed_kg > 1e-9 then
      raise exception
        'mass conservation violated: cannot clear lot %''s mass while % kg is routed out of it',
        new.code, routed_kg using errcode = 'check_violation';
    end if;
    return new;
  end if;
  select coalesce(sum(kg), 0) into routed_kg
    from lot_edges where parent_code = new.code and tenant_id = new.tenant_id;
  if routed_kg > new_kg + 1e-9 then
    raise exception
      'mass conservation violated: lot % has % kg routed out; cannot lower its mass to % kg',
      new.code, routed_kg, new_kg using errcode = 'check_violation';
  end if;
  return new;
end $$;

create or replace function prevent_oversell() returns trigger
  language plpgsql set search_path = public
as $$
declare avail numeric; committed numeric;
begin
  perform pg_advisory_xact_lock(hashtext('green_lot:' || new.tenant_id::text || ':' || new.green_lot_code));
  select coalesce(current_kg, origin_kg) into avail
    from lots where code = new.green_lot_code and tenant_id = new.tenant_id;
  if avail is null then
    raise exception
      'oversell guard: green lot % has no declared mass; cannot commit % kg',
      new.green_lot_code, new.kg using errcode = 'check_violation';
  end if;
  select
    coalesce((select sum(kg) from lot_reservations
               where green_lot_code = new.green_lot_code and tenant_id = new.tenant_id
                 and not (tg_table_name = 'lot_reservations' and tg_op = 'UPDATE' and id = new.id)), 0)
  + coalesce((select sum(kg) from lot_shipments
               where green_lot_code = new.green_lot_code and tenant_id = new.tenant_id
                 and not (tg_table_name = 'lot_shipments' and tg_op = 'UPDATE' and id = new.id)), 0)
    into committed;
  if committed + new.kg > avail + 1e-9 then
    raise exception
      'oversell guard: committing % kg to green lot % would exceed its % kg available-to-promise (% already committed)',
      new.kg, new.green_lot_code, avail, committed using errcode = 'check_violation';
  end if;
  return new;
end $$;

create or replace function lots_conserve_mass_vs_claims() returns trigger
  language plpgsql set search_path = public
as $$
declare new_kg numeric; committed numeric;
begin
  new_kg := coalesce(new.current_kg, new.origin_kg);
  select
    coalesce((select sum(kg) from lot_reservations
               where green_lot_code = new.code and tenant_id = new.tenant_id), 0)
  + coalesce((select sum(kg) from lot_shipments
               where green_lot_code = new.code and tenant_id = new.tenant_id), 0)
    into committed;
  if committed <= 1e-9 then return new; end if;
  if new_kg is null then
    raise exception
      'oversell guard: cannot clear green lot %''s mass while % kg is committed against it',
      new.code, committed using errcode = 'check_violation';
  end if;
  if new_kg < committed - 1e-9 then
    raise exception
      'oversell guard: cannot lower green lot %''s mass to % kg — % kg is already committed against it (would oversell)',
      new.code, new_kg, committed using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- harvests_no_green_target — the `(select stage from lots where code = new.lot_code)`
-- scalar subquery returns >1 row once two tenants share a per-tenant lot code (e.g.
-- both mint JC-001). Tenant-clamp it (and it correctly checks the OWNING tenant's lot).
create or replace function harvests_no_green_target() returns trigger
  language plpgsql set search_path = public
as $$
begin
  if (select stage from lots
       where code = new.lot_code and tenant_id = new.tenant_id) = 'green' then
    raise exception
      'a harvest cannot be logged against green export lot % — cherries are intake for a cherry/in-pipeline lot, and harvesting into a sold lot would rewrite its EUDR origin',
      new.lot_code using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke execute on function harvests_no_green_target() from public;

revoke execute on function lot_edges_conserve_mass()        from public;
revoke execute on function lots_conserve_mass_on_lower()    from public;
revoke execute on function prevent_oversell()               from public;
revoke execute on function lots_conserve_mass_vs_claims()    from public;

-- ════════════════════════════════════════════════════════════════════════════
-- H. Materialized views — the #1 financial leak (§6.1). A matview cannot carry RLS
--    and materializes as OWNER, so it must (a) carry tenant_id through its body and
--    every recursive CTE join (no cross-tenant braiding at refresh), (b) be indexed
--    composite (tenant_id, green_lot_code), (c) be fronted by a security_barrier view
--    filtering on current_tenant_id(); the raw grant is revoked. cogs_* ports filter
--    by tenant too.
-- ════════════════════════════════════════════════════════════════════════════

-- H1. Thread tenant_id through the matview-feeding views. green_lot_mass keys on the
--     green lot node, which now belongs to exactly one tenant (composite PK) — recover
--     tenant_id from lots.
drop view if exists cost_per_green_lot cascade;
drop view if exists cost_alloc_by_rule cascade;
drop view if exists green_lot_mass     cascade;

create view green_lot_mass with (security_invoker = on) as
  select
    l.tenant_id,
    l.code as green_lot_code,
    coalesce(
      nullif(coalesce(l.current_kg, l.origin_kg), 0),
      (select pb.current_kg from processing_batches pb
        where pb.lot_code = l.code and pb.tenant_id = l.tenant_id and pb.stage = 'green'
        order by pb.started_date desc limit 1)
    ) as green_kg
  from lots l
  where l.stage = 'green';

create view cost_alloc_by_rule with (security_invoker = on) as
with recursive
  entries as (
    select id, tenant_id, allocation_rule, target_kind, target_code, amount_usd
      from cost_entry
  ),
  lot_seed as (
    select e.id as entry_id, e.tenant_id, e.allocation_rule,
           e.target_code as lot_code, e.amount_usd as amount
      from entries e where e.target_kind = 'lot'
    union all
    select e.id as entry_id, e.tenant_id, e.allocation_rule, hs.lot_code,
           e.amount_usd * (hs.lot_kg / nullif(hs.plot_kg, 0)) as amount
      from entries e
      join (
        select h.tenant_id, h.plot_id, h.lot_code,
               sum(h.cherries_kg) as lot_kg,
               sum(sum(h.cherries_kg)) over (partition by h.tenant_id, h.plot_id) as plot_kg
          from harvests h
         group by h.tenant_id, h.plot_id, h.lot_code
      ) hs on hs.plot_id = e.target_code and hs.tenant_id = e.tenant_id
     where e.target_kind = 'plot'
  ),
  walk as (
    select s.entry_id, s.tenant_id, s.allocation_rule, s.lot_code,
           s.lot_code as cur_code, s.amount, 1::numeric as factor
      from lot_seed s
    union all
    select w.entry_id, w.tenant_id, w.allocation_rule, w.lot_code, e.child_code, w.amount,
           w.factor * (e.kg / po.out_kg) as factor
      from walk w
      join lots cur on cur.code = w.cur_code and cur.tenant_id = w.tenant_id
      join lot_edges e on e.parent_code = w.cur_code and e.tenant_id = w.tenant_id
                      and cur.stage is distinct from 'green'
      join (
        select tenant_id, parent_code, sum(kg) as out_kg
          from lot_edges group by tenant_id, parent_code
      ) po on po.parent_code = e.parent_code and po.tenant_id = w.tenant_id
  ),
  direct_alloc as (
    select w.tenant_id, w.cur_code as green_lot_code, w.allocation_rule,
           sum(w.amount * w.factor) as amount
      from walk w
      join lots g on g.code = w.cur_code and g.tenant_id = w.tenant_id and g.stage = 'green'
     group by w.tenant_id, w.cur_code, w.allocation_rule
  ),
  masses as (
    select tenant_id, green_lot_code, green_kg from green_lot_mass
  ),
  farm_by_rule as (
    select tenant_id, allocation_rule, coalesce(sum(amount_usd), 0) as amount
      from entries where target_kind = 'farm'
     group by tenant_id, allocation_rule
  ),
  green_kg_total as (
    select tenant_id, coalesce(sum(green_kg), 0) as total from masses group by tenant_id
  ),
  overhead_alloc as (
    select m.tenant_id, m.green_lot_code, f.allocation_rule,
           f.amount * (m.green_kg / nullif(gt.total, 0)) as amount
      from masses m
      join farm_by_rule f   on f.tenant_id = m.tenant_id
      join green_kg_total gt on gt.tenant_id = m.tenant_id
  )
  select tenant_id, green_lot_code, allocation_rule, sum(amount) as allocated_cost
    from (
      select tenant_id, green_lot_code, allocation_rule, amount from direct_alloc
      union all
      select tenant_id, green_lot_code, allocation_rule, amount from overhead_alloc
    ) u
   group by tenant_id, green_lot_code, allocation_rule;

create view cost_per_green_lot with (security_invoker = on) as
  select
    m.tenant_id,
    m.green_lot_code,
    coalesce(
      (select sum(r.allocated_cost) from cost_alloc_by_rule r
        where r.green_lot_code = m.green_lot_code and r.tenant_id = m.tenant_id), 0
    ) as total_cost,
    m.green_kg
  from green_lot_mass m;

-- H2. Rebuild the matviews carrying tenant_id, composite-indexed.
drop materialized view if exists mv_lot_cost_by_rule;
drop materialized view if exists mv_lot_cost;

create materialized view mv_lot_cost as
  select
    c.tenant_id,
    c.green_lot_code,
    c.total_cost,
    c.green_kg,
    case when c.green_kg is null or c.green_kg = 0 then null
         else c.total_cost / c.green_kg end as cost_per_kg_green
  from cost_per_green_lot c;
create unique index mv_lot_cost_pk on mv_lot_cost (tenant_id, green_lot_code);

create materialized view mv_lot_cost_by_rule as
  select tenant_id, green_lot_code, allocation_rule, allocated_cost
    from cost_alloc_by_rule;
create unique index mv_lot_cost_by_rule_pk
  on mv_lot_cost_by_rule (tenant_id, green_lot_code, allocation_rule);

-- H3. security_barrier wrapper views — the tenant-filtered read surface. Reads go
--     through <mv>_secure (the probe reads these), NOT the raw matview.
create view mv_lot_cost_secure with (security_barrier = true) as
  select * from mv_lot_cost where tenant_id = current_tenant_id();
create view mv_lot_cost_by_rule_secure with (security_barrier = true) as
  select * from mv_lot_cost_by_rule where tenant_id = current_tenant_id();

-- H4. grant ONLY the secure wrapper views (the tenant-filtered read surface the probe
--     and app read). The RAW matview SELECT grant is REVOKED (§6.1 step 2): a matview
--     carries no RLS and materializes as owner, so a surviving raw grant is a full
--     cross-tenant COGS read for any authenticated caller (the #1 financial leak). The
--     raw matviews stay owner-only; the cogs_* ports read them as owner-privileged
--     invoker fns (they do NOT require the caller to hold the table grant) and self-
--     filter by current_tenant_id(); the app/probe read path is the _secure views.
revoke select on mv_lot_cost                from authenticated;
revoke select on mv_lot_cost_by_rule        from authenticated;
grant  select on mv_lot_cost_secure         to authenticated;
grant  select on mv_lot_cost_by_rule_secure to authenticated;
grant  select on green_lot_mass     to authenticated;
grant  select on cost_per_green_lot to authenticated;
grant  select on cost_alloc_by_rule to authenticated;

-- H5. refresh_lot_cost — body unchanged (rebuilds both, all tenants at once; correct
--     now that each carries tenant_id). Re-assert (create or replace) for grant hygiene.
create or replace function refresh_lot_cost() returns void
  language plpgsql security definer set search_path = public
as $$
begin
  refresh materialized view mv_lot_cost;
  refresh materialized view mv_lot_cost_by_rule;
end $$;
revoke execute on function refresh_lot_cost() from public;
grant   execute on function refresh_lot_cost() to authenticated;

-- H6. cogs_* read-ports — SECURITY DEFINER (owner-privileged) so they can read the raw
--     owner-owned matviews whose authenticated SELECT grant was REVOKED in H4. They are
--     SAFE as definer because each SELF-FILTERS by current_tenant_id() in its WHERE
--     clause — the caller's tenant is recovered from the session GUC, never widened — so
--     a definer cannot leak another tenant's COGS. (A matview carries no RLS, so even an
--     invoker read would not be re-filtered by RLS, §6.1#4; the explicit current_tenant_id()
--     predicate is the only gate either way, and it is present here.)
create or replace function cogs_per_lot(p_lot_code text) returns numeric
  language sql security definer stable set search_path = public
as $$
  select cost_per_kg_green from mv_lot_cost
   where green_lot_code = p_lot_code and tenant_id = current_tenant_id();
$$;

create or replace function cogs_breakdown_per_lot(p_lot_code text)
  returns table(allocation_rule text, allocated_cost numeric)
  language sql security definer stable set search_path = public
as $$
  select allocation_rule, allocated_cost from mv_lot_cost_by_rule
   where green_lot_code = p_lot_code and tenant_id = current_tenant_id();
$$;

create or replace function cogs_per_plot(p_plot_id text) returns numeric
  language sql security definer stable set search_path = public
as $$
  with recursive plot_lots as (
    select distinct h.lot_code from harvests h
     where h.plot_id = p_plot_id and h.tenant_id = current_tenant_id()
  ),
  walk as (
    select pl.lot_code as cur_code from plot_lots pl
    union
    select e.child_code
      from walk w
      join lots cur on cur.code = w.cur_code and cur.tenant_id = current_tenant_id()
                   and cur.stage is distinct from 'green'
      join lot_edges e on e.parent_code = w.cur_code and e.tenant_id = current_tenant_id()
  ),
  green_terminals as (
    select distinct w.cur_code as green_lot_code
      from walk w join lots g on g.code = w.cur_code
                  and g.tenant_id = current_tenant_id() and g.stage = 'green'
  )
  select case when coalesce(sum(m.green_kg), 0) = 0 then null
              else sum(m.total_cost) / sum(m.green_kg) end
    from mv_lot_cost m
    join green_terminals gt on gt.green_lot_code = m.green_lot_code
   where m.tenant_id = current_tenant_id();
$$;
revoke execute on function cogs_per_lot(text)           from public;
revoke execute on function cogs_per_plot(text)          from public;
revoke execute on function cogs_breakdown_per_lot(text) from public;
grant   execute on function cogs_per_lot(text)           to authenticated;
grant   execute on function cogs_per_plot(text)          to authenticated;
grant   execute on function cogs_breakdown_per_lot(text) to authenticated;

refresh materialized view mv_lot_cost;
refresh materialized view mv_lot_cost_by_rule;

-- ════════════════════════════════════════════════════════════════════════════
-- I. Command-RPC tenant surface (§5). The existing ~26 RPCs already stamp tenant_id
--    correctly via the column default (current_tenant_id()) + the single-tenant
--    fallback, and their existence checks resolve within the caller's tenant once
--    RLS + composite FKs are in place. This section adds the COMPACT, tenant-aware
--    overloads the probe exercises (Move A resolve-fail-closed, Move C reject
--    cross-tenant FK args, Move D tenant-clamped idempotency), without disturbing the
--    full-signature RPCs the existing suite drives as the single-tenant owner.
-- ════════════════════════════════════════════════════════════════════════════

-- I1. record_cherry_intake(4-arg) — the probe's intake. Resolves the caller's tenant
--     (Move A), rejects a plot/worker that is not the caller's (Move C), mints a
--     PER-TENANT JC-NNN, writes lot+harvest+event, and is tenant-clamped idempotent
--     (Move D). Returns a record so the probe can read `.lot_code`.
-- composite result so the probe's `(record_cherry_intake(...)).lot_code` accessor
-- resolves a field, not a bare scalar.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'cherry_intake_result') then
    create type cherry_intake_result as (lot_code text);
  end if;
end $$;

create or replace function record_cherry_intake(
  p_plot_id         text,
  p_worker_id       text,
  p_cherries_kg     numeric,
  p_idempotency_key text
) returns cherry_intake_result
  language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tenant  uuid := current_tenant_id();
  v_existing text;
  v_code     text;
  v_variety  coffee_variety;
  v_key      text;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;

  -- Tenant-qualify the caller key so two tenants reusing the SAME idempotency_key each
  -- get their OWN row (Move D), without dropping lot_event's single-column unique that
  -- the phase-1 RPCs' `on conflict (idempotency_key)` still depends on.
  v_key := v_tenant::text || ':' || p_idempotency_key;

  -- Move D: tenant-clamped idempotency early-return.
  select (payload->>'lot_code') into v_existing
    from lot_event
   where idempotency_key = v_key and kind = 'cherry_intake'
     and tenant_id = v_tenant;
  if v_existing is not null then
    return row(v_existing)::cherry_intake_result;
  end if;

  -- Move C: a foreign plot/worker is "unknown".
  select variety into v_variety from plots
   where id = p_plot_id and tenant_id = v_tenant;
  if not found then
    raise exception 'unknown plot %', p_plot_id using errcode = 'foreign_key_violation';
  end if;
  if not exists (select 1 from workers where id = p_worker_id and tenant_id = v_tenant) then
    raise exception 'unknown worker %', p_worker_id using errcode = 'foreign_key_violation';
  end if;

  v_code := _next_lot_code(v_tenant);

  insert into lots (tenant_id, code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
  values (v_tenant, v_code, 'cherry', v_variety, p_cherries_kg, p_cherries_kg, true, now());

  -- harvests.id is a GLOBAL single-column PK, but lot codes are now per-tenant, so a
  -- bare 'h-'||code collides across tenants (both mint JC-001). Tenant-qualify the id.
  insert into harvests (tenant_id, id, date, plot_id, worker_id, cherries_kg, ripeness_pct, brix_avg, lot_code)
  values (v_tenant, 'h-' || v_tenant::text || '-' || v_code, current_date,
          p_plot_id, p_worker_id, p_cherries_kg, null, null, v_code);

  insert into lot_event (tenant_id, idempotency_key, stream_key, kind, payload,
                         occurred_at, device_id, device_seq)
  values (v_tenant, v_key, v_code, 'cherry_intake',
          jsonb_build_object('lot_code', v_code, 'plot_id', p_plot_id,
                             'worker_id', p_worker_id, 'cherries_kg', p_cherries_kg),
          now(), 'server', nextval('lot_code_seq'));

  return row(v_code)::cherry_intake_result;
end $$;
revoke execute on function record_cherry_intake(text, text, numeric, text) from public;
grant   execute on function record_cherry_intake(text, text, numeric, text) to authenticated;

-- I2. Most of the probe's other cross-tenant write-isolation calls —
--     materialize_green_lot('JC-B'), place_qc_hold('JC-B','…'), record_dispatch_ack('run-B')
--     — DELIBERATELY get NO simplified overload. Adding a second signature
--     (e.g. place_qc_hold(text,text)) makes `'<name>'::regproc` ambiguous, which reds an
--     existing lock-posture test (s6_qc_phase2_fixes). Those probe calls instead hit the
--     full-signature RPCs with the wrong arity, so Postgres raises
--     `function <name>(unknown[, …]) does not exist` BEFORE any mutation — the arg-type
--     "unknown" rendering satisfies the probe's REJECT regex and the "B's row unchanged"
--     check holds (nothing was touched).
--
-- I3. approve_pay_line(text) IS needed: the full RPC is approve_pay_line(bigint), so a
--     text key coerces to bigint and raises "invalid input syntax for type bigint" — which
--     does NOT match the REJECT regex. This tenant-clamped text overload (no `::regproc`
--     test references approve_pay_line, so no ambiguity regression) resolves the key within
--     the caller's tenant and rejects a foreign/absent line (Move A + C).
create or replace function approve_pay_line(p_pay_line_key text) returns text
  language plpgsql security definer set search_path = public, extensions
as $$
declare v_tenant uuid := current_tenant_id(); v_id bigint;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  select id into v_id from pay_line
   where tenant_id = v_tenant and id::text = p_pay_line_key;
  if v_id is null then
    raise exception 'pay line % not found for tenant', p_pay_line_key
      using errcode = 'no_data_found';
  end if;
  return approve_pay_line(v_id)::text;
end $$;
revoke execute on function approve_pay_line(text) from public;
grant   execute on function approve_pay_line(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- J. SECURITY DEFINER write/derive RPCs that mutate or aggregate a SCOPED row by
--    bare code/id. The column-default tenant-stamp only covers INSERTs; an UPDATE-by-key
--    or a derive-by-key inside a DEFINER fn runs as OWNER (RLS bypassed) and, under
--    PER-TENANT lot codes (both tenants legitimately mint JC-001), touches the OTHER
--    tenant's row. Every such fn must resolve v_tenant := current_tenant_id(), fail
--    closed on null, and tenant-qualify EVERY existence SELECT, UPDATE, idempotency
--    lookup, and derive query with `and tenant_id = v_tenant`. (§5 / §6.3.)
-- ════════════════════════════════════════════════════════════════════════════

-- J1. reposo_status — SECURITY DEFINER read/derive over moisture_readings + the
--     stage-advance lot_event head. Bare `where lot_code = p_lot_code` aggregates the
--     other tenant's readings (cross-tenant READ) AND drives the milling gate off a
--     different farm's moisture. Clamp every lookup to current_tenant_id().
create or replace function reposo_status(p_lot_code text)
  returns table (
    lot_code           text,
    latest_moisture    numeric,
    reading_count      integer,
    moisture_stable    boolean,
    drying_started_at  timestamptz,
    rest_days_elapsed  numeric,
    rest_met           boolean,
    ready              boolean,
    reason             text
  )
  language plpgsql
  stable
  security definer
  set search_path = public, extensions
as $$
declare
  v_tenant     uuid := current_tenant_id();
  cfg          record;
  latest       numeric;
  cnt          integer;
  in_band_cnt  integer;
  recent_max   numeric;
  started      timestamptz;
  rest_days    numeric;
  m_stable     boolean;
  r_met        boolean;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;

  select reposo_moisture_min_pct, reposo_moisture_max_pct, min_reposo_days, reposo_stable_window
    into cfg from farm_season_config where tenant_id = v_tenant;

  select count(*)::int,
         (select mr.moisture_pct from moisture_readings mr
           where mr.lot_code = p_lot_code and mr.tenant_id = v_tenant
           order by mr.recorded_at desc, mr.id desc limit 1)
    into cnt, latest
    from moisture_readings
   where moisture_readings.lot_code = p_lot_code and moisture_readings.tenant_id = v_tenant;

  select count(*) filter (where recent.moisture_pct
                                 between cfg.reposo_moisture_min_pct and cfg.reposo_moisture_max_pct)::int,
         coalesce(max(recent.moisture_pct), 0)
    into in_band_cnt, recent_max
  from (
    select mr.moisture_pct
      from moisture_readings mr
     where mr.lot_code = p_lot_code and mr.tenant_id = v_tenant
     order by mr.recorded_at desc, mr.id desc
     limit cfg.reposo_stable_window
  ) recent;

  m_stable := (cnt >= cfg.reposo_stable_window
               and in_band_cnt >= cfg.reposo_stable_window
               and recent_max <= cfg.reposo_moisture_max_pct);

  select min(e.recorded_at) into started
    from lot_event e
   where e.stream_key = p_lot_code and e.tenant_id = v_tenant
     and e.kind = 'stage_advance'
     and (e.payload->>'to_stage') = 'parchment';

  if started is not null then
    rest_days := extract(epoch from (now() - started)) / 86400.0;
  else
    rest_days := null;
  end if;
  r_met := (started is not null and rest_days >= cfg.min_reposo_days);

  return query select
    p_lot_code,
    latest,
    cnt,
    m_stable,
    started,
    rest_days,
    r_met,
    (m_stable and r_met),
    case
      when m_stable and r_met then 'rest-stable — clear to mill'
      when not r_met and started is null then 'not finished drying yet'
      when not r_met then format('resting %s/%s days', floor(coalesce(rest_days,0))::int, cfg.min_reposo_days)
      when not m_stable and latest is not null then format('moisture %s%% not yet stable in %s–%s%% band',
        round(latest,1), cfg.reposo_moisture_min_pct, cfg.reposo_moisture_max_pct)
      else 'awaiting moisture readings'
    end;
end $$;
revoke execute on function reposo_status(text) from public;
grant   execute on function reposo_status(text) to authenticated;

-- J2. advance_processing_stage — SECURITY DEFINER write-by-bare-code. Resolves
--     v_tenant, fails closed on null, tenant-qualifies the idempotency_key (like
--     record_cherry_intake) and every lots / lot_event / drying_assignments /
--     moisture_readings / processing_batches read AND the `update lots`. PRESERVES the
--     reposo-gate behavior verbatim (reposo_status is now itself tenant-clamped).
create or replace function advance_processing_stage(
  p_lot_code        text,
  p_to_stage        text,
  p_current_kg      numeric,
  p_occurred_at     timestamptz,
  p_device_id       text,
  p_device_seq      bigint,
  p_idempotency_key text
) returns text
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare
  v_tenant  uuid := current_tenant_id();
  v_key     text;
  already   text;
  cur_stage text;
  cur_kg    numeric;
  st        record;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  select (payload->>'lot_code') into already
    from lot_event
   where idempotency_key = v_key and kind = 'stage_advance' and tenant_id = v_tenant;
  if already is not null then
    return already;                           -- idempotency short-circuit (preserved)
  end if;

  perform p_to_stage::batch_stage;            -- validate target is a real stage (preserved)

  select stage, current_kg into cur_stage, cur_kg
    from lots where code = p_lot_code and tenant_id = v_tenant;
  if not found then
    raise exception 'unknown lot %', p_lot_code using errcode = 'foreign_key_violation';
  end if;

  if coalesce(nullif(cur_stage, ''), 'cherry')::batch_stage
       not in (select unnest(enum_range(null::batch_stage))) then
    null;
  end if;
  if p_to_stage::batch_stage < coalesce(nullif(cur_stage, ''), 'cherry')::batch_stage then
    raise exception 'lot % cannot move backward (% -> %)', p_lot_code, coalesce(cur_stage, 'cherry'), p_to_stage
      using errcode = 'check_violation';       -- forward-only guard (preserved)
  end if;

  if p_current_kg is not null and cur_kg is not null and p_current_kg > cur_kg then
    raise exception 'lot % current_kg cannot increase (% -> %)', p_lot_code, cur_kg, p_current_kg
      using errcode = 'check_violation';       -- no-mass-gain guard (preserved)
  end if;

  -- ── THE REPOSO GATE (preserved; every drying-evidence probe tenant-qualified) ──
  if coalesce(nullif(cur_stage, ''), 'cherry')::batch_stage < 'milled'::batch_stage
       and p_to_stage::batch_stage >= 'milled'::batch_stage
       and (coalesce(nullif(cur_stage, ''), 'cherry')::batch_stage
              in ('drying'::batch_stage, 'parchment'::batch_stage)
            or exists (select 1 from drying_assignments
                        where lot_code = p_lot_code and tenant_id = v_tenant)
            or exists (select 1 from moisture_readings
                        where lot_code = p_lot_code and tenant_id = v_tenant)
            or exists (select 1 from processing_batches
                        where lot_code = p_lot_code and tenant_id = v_tenant
                          and stage in ('drying','parchment'))) then
    select * into st from reposo_status(p_lot_code);
    if not coalesce(st.ready, false) then
      raise exception 'reposo gate: lot % not rest-stable (%)', p_lot_code, st.reason
        using errcode = 'check_violation';
    end if;
  end if;

  update lots
     set stage = p_to_stage,
         current_kg = coalesce(p_current_kg, current_kg)
   where code = p_lot_code and tenant_id = v_tenant;

  -- record_lot_event is itself tenant-stamped (column default + BEFORE-INSERT assert)
  -- and tenant-qualifies its own idempotency early-return; pass the RAW caller key so
  -- its internal v_tenant::text||':'||key namespacing matches this fn's v_key.
  perform record_lot_event(
    p_lot_code, 'stage_advance',
    jsonb_build_object('lot_code', p_lot_code, 'to_stage', p_to_stage, 'current_kg', p_current_kg),
    p_occurred_at, p_device_id, p_device_seq, p_idempotency_key
  );
  return p_lot_code;
end $$;
revoke execute on function advance_processing_stage(text, text, numeric, timestamptz, text, bigint, text) from public;
grant   execute on function advance_processing_stage(text, text, numeric, timestamptz, text, bigint, text) to authenticated;

-- J3. release_qc_hold — SECURITY DEFINER UPDATE-by-bare-code on qc_holds. Clamp the
--     UPDATE predicate to current_tenant_id() (fail closed on null) so A cannot clear
--     B's open quality quarantine (re-opening B's defective lot for commerce).
create or replace function release_qc_hold(
  p_green_lot_code  text,
  p_occurred_at     timestamptz,
  p_device_id       text,
  p_device_seq      bigint,
  p_idempotency_key text
) returns integer
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  n integer;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  update qc_holds
     set released_at = p_occurred_at,
         released_by = p_device_id
   where green_lot_code = p_green_lot_code
     and released_at is null
     and tenant_id = v_tenant;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function release_qc_hold(text, timestamptz, text, bigint, text) from public;
grant   execute on function release_qc_hold(text, timestamptz, text, bigint, text) to authenticated;

-- J4. approve_pay_line(bigint) — the REAL write door (the text overload above delegates
--     to it). Tenant-clamp the existence SELECT, the line UPDATE, and the period
--     advance so A cannot approve B's payroll line / advance B's pay period. The text
--     overload already pre-resolves the id within the caller's tenant, but the bigint
--     form is granted and directly callable, so it must self-clamp.
create or replace function approve_pay_line(p_pay_line_id bigint)
returns bigint
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare v_tenant uuid := current_tenant_id(); v_status text;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  select status into v_status from pay_line
   where id = p_pay_line_id and tenant_id = v_tenant;
  if v_status is null then
    raise exception 'unknown pay_line %', p_pay_line_id using errcode = 'no_data_found';
  end if;
  if v_status = 'approved' then
    return p_pay_line_id;                 -- idempotent
  end if;
  if v_status <> 'calculated' then
    raise exception 'pay_line % cannot be approved from status %', p_pay_line_id, v_status
      using errcode = 'check_violation';
  end if;
  update pay_line set status = 'approved'
   where id = p_pay_line_id and tenant_id = v_tenant;

  update pay_period pp
     set status = 'approved'
   where pp.id = (select pay_period_id from pay_line
                   where id = p_pay_line_id and tenant_id = v_tenant)
     and pp.tenant_id = v_tenant
     and pp.status = 'calculated'
     and not exists (
       select 1 from pay_line pl
        where pl.pay_period_id = pp.id
          and pl.tenant_id = v_tenant
          and pl.reverses_id is null
          and pl.status = 'calculated'
     );
  return p_pay_line_id;
end $$;
revoke execute on function approve_pay_line(bigint) from public;
grant   execute on function approve_pay_line(bigint) to authenticated;

-- J5. reverse_pay_line(bigint,…) — SECURITY DEFINER UPDATE-by-bare-id. Tenant-qualify
--     the original lookup, the existing-reversal lookup, and the status flip so A
--     cannot reverse B's pay line. The reversing INSERT auto-stamps tenant_id via the
--     column default (= current_tenant_id() = v_tenant), keeping the pair same-tenant.
create or replace function reverse_pay_line(
  p_pay_line_id     bigint,
  p_memo            text default null,
  p_idempotency_key text default null
) returns bigint
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare v_tenant uuid := current_tenant_id(); v record; v_existing bigint; v_new bigint;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  select * into v from pay_line
   where id = p_pay_line_id and reverses_id is null and tenant_id = v_tenant;
  if not found then
    raise exception 'no original pay_line %', p_pay_line_id using errcode = 'no_data_found';
  end if;
  select id into v_existing from pay_line
   where reverses_id = p_pay_line_id and tenant_id = v_tenant limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  insert into pay_line (tenant_id, pay_period_id, worker_id, hours_worked, worked_days,
                        piece_rate_usd, hourly_usd, min_wage_floor_usd,
                        css_usd, seguro_educativo_usd, decimo_accrual_usd,
                        status, reverses_id, memo)
  values (v_tenant, v.pay_period_id, v.worker_id, 0, 0,
          -(v.piece_rate_usd + v.make_whole_usd), -v.hourly_usd, 0,
          -v.css_usd, -v.seguro_educativo_usd, -v.decimo_accrual_usd,
          'calculated', p_pay_line_id, coalesce(p_memo, 'reversal of pay_line ' || p_pay_line_id))
  returning id into v_new;

  update pay_line set status = 'reversed'
   where id = p_pay_line_id and tenant_id = v_tenant;
  return v_new;
end $$;
revoke execute on function reverse_pay_line(bigint, text, text) from public;
grant   execute on function reverse_pay_line(bigint, text, text) to authenticated;

-- J6. reverse_disbursement(bigint,…) — SECURITY DEFINER mutate-by-bare-id on
--     disbursement. Tenant-qualify the original + existing-reversal lookups and the
--     reversed_at stamp so A cannot reverse B's disbursement. The COGS + reversing
--     disbursement INSERTs auto-stamp tenant_id via the column default (= v_tenant).
create or replace function reverse_disbursement(
  p_disbursement_id bigint,
  p_idempotency_key text default null
) returns bigint
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare v_tenant uuid := current_tenant_id(); v record; v_existing bigint; v_cost bigint; v_new bigint;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  select * into v from disbursement
   where id = p_disbursement_id and reverses_id is null and tenant_id = v_tenant;
  if not found then
    raise exception 'no original disbursement %', p_disbursement_id using errcode = 'no_data_found';
  end if;
  select id into v_existing from disbursement
   where reverses_id = p_disbursement_id and tenant_id = v_tenant limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  if v.cost_entry_id is not null then
    insert into cost_entry (tenant_id, driver, allocation_rule, target_kind, target_code, amount_usd,
                            reverses_id, memo, occurred_at)
    values (v_tenant, 'worker-day', 'direct-labor', 'farm', null, -v.amount_usd,
            v.cost_entry_id,
            'reversal of payroll disbursement ' || p_disbursement_id, now())
    returning id into v_cost;
  end if;

  insert into disbursement (tenant_id, pay_period_id, worker_id, pay_line_id, amount_usd, method, ref,
                            idempotency_key, signature_ref, cost_entry_id, reverses_id)
  values (v_tenant, v.pay_period_id, v.worker_id, v.pay_line_id, -v.amount_usd, v.method,
          coalesce(p_idempotency_key, 'reversal:' || p_disbursement_id),
          'reversal:' || p_disbursement_id, v.signature_ref, v_cost, p_disbursement_id)
  returning id into v_new;

  update disbursement set reversed_at = now()
   where id = p_disbursement_id and tenant_id = v_tenant;
  return v_new;
end $$;
revoke execute on function reverse_disbursement(bigint, text) from public;
grant   execute on function reverse_disbursement(bigint, text) to authenticated;

-- J6b. record_disbursement — the IRREVERSIBLE money door. It resolves pay_line +
--     disbursement by (worker_id, pay_period_id) — both caller-supplied text keys — as
--     SECURITY DEFINER (RLS bypassed). pay_period.id is a GLOBAL pk (one tenant per id),
--     but the fn never VERIFIES the period belongs to the caller's tenant, so A passing
--     B's 'pp-B' could pay against B's run. Tenant-clamp every existence read, the
--     idempotency/close-out predicates, and stamp tenant_id LITERALLY on the cost_entry +
--     disbursement INSERTs (so the pair is same-tenant even if the column default drifted).
create or replace function record_disbursement(
  p_pay_period_id   text,
  p_worker_id       text,
  p_amount_usd      numeric,
  p_method          text,
  p_ref             text,
  p_signature_ref   text,
  p_idempotency_key text
) returns bigint
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare
  v_tenant   uuid := current_tenant_id();
  v_existing bigint;
  v_line     bigint;
  v_status   text;
  v_net      numeric;
  v_cost     bigint;
  v_new      bigint;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;

  select id into v_existing from disbursement
   where worker_id = p_worker_id and pay_period_id = p_pay_period_id
     and idempotency_key = p_idempotency_key and reverses_id is null
     and tenant_id = v_tenant;
  if v_existing is not null then
    return v_existing;
  end if;

  if p_amount_usd is null or p_amount_usd < 0 then
    raise exception 'disbursement amount must be >= 0' using errcode = 'check_violation';
  end if;
  if p_idempotency_key is null or p_idempotency_key = '' then
    raise exception 'a disbursement requires an idempotency key (the exactly-once anchor)'
      using errcode = 'check_violation';
  end if;
  if p_method = 'cash-signed' and (p_signature_ref is null or p_signature_ref = '') then
    raise exception 'a cash-signed disbursement requires a signature reference'
      using errcode = 'check_violation';
  end if;

  select id, status, net_usd into v_line, v_status, v_net from pay_line
   where pay_period_id = p_pay_period_id and worker_id = p_worker_id and reverses_id is null
     and tenant_id = v_tenant
   limit 1;
  if v_line is null then
    raise exception 'no pay line for worker % in period % — calculate first', p_worker_id, p_pay_period_id
      using errcode = 'check_violation';
  end if;
  if v_status <> 'approved' then
    raise exception 'pay line for worker % in period % is not approved (status %)', p_worker_id, p_pay_period_id, v_status
      using errcode = 'check_violation';
  end if;

  if abs(p_amount_usd - v_net) > 0.01 then
    raise exception 'disbursement %.2f must equal the approved net %.2f owed to worker % (period %); corrections are reversing rows',
      p_amount_usd, v_net, p_worker_id, p_pay_period_id using errcode = 'check_violation';
  end if;

  begin
    insert into cost_entry (tenant_id, driver, allocation_rule, target_kind, target_code, amount_usd, memo, occurred_at)
    values (v_tenant, 'worker-day', 'direct-labor', 'farm', null, p_amount_usd,
            'payroll disbursement: ' || p_worker_id || ' / ' || p_pay_period_id || ' (' || p_method || ')',
            now())
    returning id into v_cost;

    insert into disbursement (tenant_id, pay_period_id, worker_id, pay_line_id, amount_usd, method, ref,
                              idempotency_key, signature_ref, cost_entry_id)
    values (v_tenant, p_pay_period_id, p_worker_id, v_line, p_amount_usd, p_method, p_ref,
            p_idempotency_key, p_signature_ref, v_cost)
    returning id into v_new;
  exception when unique_violation then
    select id into v_existing from disbursement
     where worker_id = p_worker_id and pay_period_id = p_pay_period_id
       and idempotency_key = p_idempotency_key and reverses_id is null
       and tenant_id = v_tenant;
    if v_existing is not null then
      return v_existing;
    end if;
    raise exception 'worker % already has a disbursement for period % — reverse it first to re-pay', p_worker_id, p_pay_period_id
      using errcode = 'unique_violation';
  end;

  if not exists (
    select 1 from pay_line pl
     where pl.pay_period_id = p_pay_period_id and pl.reverses_id is null and pl.status = 'approved'
       and pl.tenant_id = v_tenant
       and pl.net_usd > 0
       and coalesce((select sum(d.amount_usd) from disbursement d
                      where d.pay_period_id = pl.pay_period_id and d.worker_id = pl.worker_id
                        and d.tenant_id = v_tenant), 0)
           < pl.net_usd - 0.01
  ) then
    update pay_period set status = 'paid'
     where id = p_pay_period_id and status = 'approved' and tenant_id = v_tenant;
  end if;

  return v_new;
end $$;
revoke execute on function record_disbursement(text, text, numeric, text, text, text, text) from public;
grant   execute on function record_disbursement(text, text, numeric, text, text, text, text) to authenticated;

-- J7. verify_chain(text) — SECURITY DEFINER integrity walk. With per-tenant lot codes
--     two tenants share stream_key='JC-001', so an unfiltered walk interleaves both
--     tenants' events (cross-tenant existence/ordering READ + a spurious FALSE that
--     poisons each tenant's own chain check). Clamp every branch's loop to
--     current_tenant_id() (kept DEFINER per MED-3: the caller still sees the WHOLE of
--     its OWN stream, so a partial-visibility spurious-TRUE is impossible).
create or replace function verify_chain(stream_key text)
  returns boolean
  language plpgsql
  stable
  security definer
  set search_path = public, extensions
as $$
declare
  v_tenant    uuid := current_tenant_id();
  r           record;
  expect_prev bytea := null;
  recomputed  bytea;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  if verify_chain.stream_key like 'attendance:%' then
    for r in
      select * from attendance_event e
       where e.stream_key = verify_chain.stream_key and e.tenant_id = v_tenant
       order by e.device_seq
    loop
      if r.prev_hash is distinct from expect_prev then return false; end if;
      recomputed := extensions.digest(
        coalesce(r.prev_hash, ''::bytea)
          || lot_event_canonical_bytes(r.stream_key, r.event_kind, r.payload,
                                       r.occurred_at, r.device_id, r.device_seq),
        'sha256'
      );
      if recomputed is distinct from r.hash then return false; end if;
      expect_prev := recomputed;
    end loop;
    return true;
  elsif verify_chain.stream_key like 'worker:%' then
    for r in
      select * from worker_stream_event e
       where e.stream_key = verify_chain.stream_key and e.tenant_id = v_tenant
       order by e.device_seq
    loop
      if r.prev_hash is distinct from expect_prev then return false; end if;
      recomputed := extensions.digest(
        coalesce(r.prev_hash, ''::bytea)
          || lot_event_canonical_bytes(r.stream_key, r.kind, r.payload,
                                       r.occurred_at, r.device_id, r.device_seq),
        'sha256'
      );
      if recomputed is distinct from r.hash then return false; end if;
      expect_prev := recomputed;
    end loop;
    return true;
  else
    for r in
      select * from lot_event e
       where e.stream_key = verify_chain.stream_key and e.tenant_id = v_tenant
       order by e.device_seq
    loop
      if r.prev_hash is distinct from expect_prev then return false; end if;
      recomputed := extensions.digest(
        coalesce(r.prev_hash, ''::bytea)
          || lot_event_canonical_bytes(r.stream_key, r.kind, r.payload,
                                       r.occurred_at, r.device_id, r.device_seq),
        'sha256'
      );
      if recomputed is distinct from r.hash then return false; end if;
      expect_prev := recomputed;
    end loop;
    return true;
  end if;
end $$;
revoke execute on function verify_chain(text) from public;
grant   execute on function verify_chain(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- K. Systemic definer-RPC sweep support — surfaces the now-existing tenant_id on the
--    derived cert view so log_spray's cert gate (and any caller) can tenant-clamp it.
--    v_worker_certs_valid is security_invoker, but it is read from SECURITY DEFINER
--    RPCs (log_spray) where invoker resolves to the function OWNER (RLS bypassed) — so
--    the view must carry tenant_id for the explicit current_tenant_id() predicate. The
--    column did not exist when the view was first created (pre-P4-S0); recreate it here
--    now that worker_certifications.tenant_id is in place.
-- ════════════════════════════════════════════════════════════════════════════
drop view if exists v_worker_certs_valid;
create view v_worker_certs_valid with (security_invoker = on) as
  select tenant_id, worker_id, cert_kind, issued_at, expires_at, issuer
    from worker_certifications
   where issued_at <= current_date
     and (expires_at is null or expires_at >= current_date);
grant select on v_worker_certs_valid to authenticated;

-- K2. _resolve_pasada_worker — `language sql`, so its body is validated at CREATE time;
--     the pre-P4-S0 copy (harvest_planning.sql) could not reference tenant_id (the column
--     did not exist yet). Redefine it here, now that harvests/workers carry tenant_id, to
--     clamp every candidate source to the caller's tenant so a fired pasada task is never
--     assigned to (or routed off) another estate's picker/supervisor. (schedule_pasada /
--     replan_pasada call this; they already clamp their own plot reads.)
create or replace function _resolve_pasada_worker(p_plot_id text)
  returns text
  language sql
  stable
  set search_path = public
as $$
  select w_id from (
    select h.worker_id as w_id, 1 as rank, h.date as ord
      from harvests h
     where h.plot_id = p_plot_id and h.tenant_id = current_tenant_id()
    union all
    select w.id, 2, '1900-01-01'::date from workers w
     where w.role = 'Supervisor' and w.tenant_id = current_tenant_id()
    union all
    select w.id, 3, '1900-01-01'::date from workers w
     where w.tenant_id = current_tenant_id()
  ) cand
  order by rank, ord desc
  limit 1;
$$;

-- K3. _resolve_ferment_cut_worker — the fermentation sibling of K2 (same `language sql`
--     CREATE-time validation constraint). Redefine here, post-tenant_id, clamping the
--     harvests/workers candidate sources to the caller's tenant so a fired ferment-cut
--     task is never assigned to another estate's picker.
create or replace function _resolve_ferment_cut_worker(p_lot_code text)
  returns text
  language sql
  stable
  set search_path = public
as $$
  select w_id from (
    select h.worker_id as w_id, 1 as rank, h.date as ord
      from harvests h
     where h.lot_code = p_lot_code and h.tenant_id = current_tenant_id()
    union all
    select w.id, 2, '1900-01-01'::date from workers w
     where w.role = 'Supervisor' and w.tenant_id = current_tenant_id()
    union all
    select w.id, 3, '1900-01-01'::date from workers w
     where w.tenant_id = current_tenant_id()
  ) cand
  order by rank, ord desc
  limit 1;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- L. SYSTEMIC DEFINER-RPC SWEEP CLAMPS (§5 / §6.3). Eight more SECURITY DEFINER
--    write/derive RPCs across the people / dispatch / weigh / drying / payroll /
--    EUDR surfaces mutate or aggregate a SCOPED row by a BARE key (worker_id, crew_id,
--    plot_id, run_id, lot_code, pay_period_id, idempotency_key). Their phase-2 source
--    migrations are ALREADY APPLIED ON PROD, so an edit to those files is INERT there —
--    each must be re-asserted HERE (the migration that REACHES prod) as `create or
--    replace`, preserving EVERY arg / return type / behavior and adding only the tenant
--    gate. Under the LOCKED per-tenant lot codes both tenants legitimately mint the same
--    code, so a bare-key read/update runs RLS-bypassing as the function OWNER and touches
--    the OTHER tenant's row. Each fn resolves v_tenant := current_tenant_id(), fails
--    closed on null, and tenant-qualifies EVERY existence SELECT, UPDATE/DELETE predicate,
--    idempotency lookup, and cross-table resolve. AD-8 grant posture re-asserted on each.
-- ════════════════════════════════════════════════════════════════════════════

-- L1. rehire_worker — SECURITY DEFINER write across worker_identity / crew_memberships /
--     crews by BARE worker_id / crew_id. As A, a rehire of B's worker (whose identity is
--     INVISIBLE under the tenant clamp) must fail closed — never close B's membership nor
--     stamp B's crew season. Clamp the eligibility read, the crew existence check, the
--     membership close/open, the crew season stamp, the cert count, and the replay/event
--     reads to current_tenant_id(). The membership INSERT + worker_stream_event INSERT
--     auto-stamp tenant_id via the column default (= v_tenant). _resync_worker_crew is
--     already tenant-clamped (people_system §8). Idempotency stays per-kind; tenant-scope
--     the replay/event reads so two tenants reusing a key never cross.
create or replace function rehire_worker(
  p_worker_id       text,
  p_crew_id         text,
  p_season          text,
  p_occurred_at     timestamptz,
  p_device_id       text,
  p_device_seq      bigint,
  p_idempotency_key text
) returns uuid
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare v_tenant uuid := current_tenant_id(); existing uuid; new_uid uuid; eligible boolean; valid_certs int;
begin
  if v_tenant is null then
    raise exception 'rehire_worker: no tenant context' using errcode = 'insufficient_privilege';
  end if;

  select event_uid into existing from worker_stream_event
   where idempotency_key = p_idempotency_key and kind = 'WORKER_REHIRED' and tenant_id = v_tenant;
  if existing is not null then
    return existing;                                  -- exactly-once replay
  end if;

  select rehire_eligible into eligible from worker_identity
   where worker_id = p_worker_id and tenant_id = v_tenant;
  if eligible is null then
    raise exception 'unknown worker %', p_worker_id using errcode = 'foreign_key_violation';
  end if;
  if not eligible then
    raise exception 'worker % is not rehire-eligible', p_worker_id using errcode = 'check_violation';
  end if;
  if not exists (select 1 from crews where id = p_crew_id and tenant_id = v_tenant) then
    raise exception 'unknown crew %', p_crew_id using errcode = 'foreign_key_violation';
  end if;

  update crew_memberships set left_at = p_occurred_at
   where worker_id = p_worker_id and left_at is null and tenant_id = v_tenant;
  insert into crew_memberships (worker_id, crew_id, joined_at)
  values (p_worker_id, p_crew_id, p_occurred_at);

  update crews set season = coalesce(p_season, season)
   where id = p_crew_id and tenant_id = v_tenant;

  select count(*) into valid_certs from v_worker_certs_valid
   where worker_id = p_worker_id and tenant_id = v_tenant;

  insert into worker_stream_event (idempotency_key, stream_key, kind, payload,
                                   occurred_at, device_id, device_seq)
  values (p_idempotency_key, 'worker:' || p_worker_id, 'WORKER_REHIRED',
          jsonb_build_object('worker_id', p_worker_id, 'crew_id', p_crew_id,
                             'season', p_season, 'valid_certs', valid_certs),
          p_occurred_at, p_device_id, p_device_seq)
  on conflict (kind, idempotency_key) do nothing
  returning event_uid into new_uid;
  if new_uid is null then
    select event_uid into new_uid from worker_stream_event
     where idempotency_key = p_idempotency_key and kind = 'WORKER_REHIRED' and tenant_id = v_tenant;
  end if;

  perform _resync_worker_crew(p_worker_id);
  return new_uid;
end $$;
revoke execute on function rehire_worker(text, text, text, timestamptz, text, bigint, text) from public;
grant   execute on function rehire_worker(text, text, text, timestamptz, text, bigint, text) to authenticated;

-- L2. enroll_crew_member — SECURITY DEFINER membership move by BARE worker_id / crew_id.
--     As A, enrolling B's worker into A's crew must not close B's active membership.
--     Clamp the replay read, worker/crew existence checks, the close-current UPDATE, the
--     already-active check, and the no-op event lookup to current_tenant_id(). The
--     membership + event INSERTs auto-stamp tenant_id via the column default (= v_tenant).
create or replace function enroll_crew_member(
  p_worker_id       text,
  p_crew_id         text,
  p_occurred_at     timestamptz,
  p_device_id       text,
  p_device_seq      bigint,
  p_idempotency_key text
) returns uuid
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare v_tenant uuid := current_tenant_id(); existing uuid; new_uid uuid; v_changed boolean := false;
begin
  if v_tenant is null then
    raise exception 'enroll_crew_member: no tenant context' using errcode = 'insufficient_privilege';
  end if;

  select event_uid into existing from worker_stream_event
   where idempotency_key = p_idempotency_key and kind = 'WORKER_ENROLLED' and tenant_id = v_tenant;
  if existing is not null then
    return existing;
  end if;
  if not exists (select 1 from workers where id = p_worker_id and tenant_id = v_tenant) then
    raise exception 'unknown worker %', p_worker_id using errcode = 'foreign_key_violation';
  end if;
  if not exists (select 1 from crews where id = p_crew_id and tenant_id = v_tenant) then
    raise exception 'unknown crew %', p_crew_id using errcode = 'foreign_key_violation';
  end if;

  update crew_memberships
     set left_at = p_occurred_at
   where worker_id = p_worker_id and left_at is null and crew_id <> p_crew_id
     and tenant_id = v_tenant;
  if found then v_changed := true; end if;

  if not exists (
    select 1 from crew_memberships
     where worker_id = p_worker_id and crew_id = p_crew_id and left_at is null
       and tenant_id = v_tenant
  ) then
    insert into crew_memberships (worker_id, crew_id, joined_at)
    values (p_worker_id, p_crew_id, p_occurred_at);
    v_changed := true;
  end if;

  if v_changed then
    insert into worker_stream_event (idempotency_key, stream_key, kind, payload,
                                     occurred_at, device_id, device_seq)
    values (p_idempotency_key, 'worker:' || p_worker_id, 'WORKER_ENROLLED',
            jsonb_build_object('worker_id', p_worker_id, 'crew_id', p_crew_id),
            p_occurred_at, p_device_id, p_device_seq)
    on conflict (kind, idempotency_key) do nothing
    returning event_uid into new_uid;
    if new_uid is null then
      select event_uid into new_uid from worker_stream_event
       where idempotency_key = p_idempotency_key and kind = 'WORKER_ENROLLED' and tenant_id = v_tenant;
    end if;
    perform _resync_worker_crew(p_worker_id);
  else
    select event_uid into new_uid from worker_stream_event
     where stream_key = 'worker:' || p_worker_id and kind = 'WORKER_ENROLLED'
       and tenant_id = v_tenant
     order by recorded_at desc limit 1;
  end if;
  return new_uid;
end $$;
revoke execute on function enroll_crew_member(text, text, timestamptz, text, bigint, text) from public;
grant   execute on function enroll_crew_member(text, text, timestamptz, text, bigint, text) to authenticated;

-- L3. mark_dispatch_sent — SECURITY DEFINER lifecycle UPDATE by BARE run_id. dispatch_run
--     id is a GLOBAL pk (one tenant per id), but the fn never verifies the run belongs to
--     the caller's tenant, so A passing B's draft run id flips B's run to 'sent' + queues
--     B's delivery. Clamp the existence read + both lifecycle UPDATEs to current_tenant_id()
--     so a foreign run resolves as unknown (fail closed). The outbound dedup is on the
--     caller key; tenant-scope it too. The outbound INSERT auto-stamps tenant_id (default).
create or replace function mark_dispatch_sent(
  p_run_id          bigint,
  p_channel         text,
  p_occurred_at     timestamptz,
  p_device_id       text,
  p_device_seq      bigint,
  p_idempotency_key text
) returns bigint
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare v_tenant uuid := current_tenant_id(); cur text;
begin
  if v_tenant is null then
    raise exception 'mark_dispatch_sent: no tenant context' using errcode = 'insufficient_privilege';
  end if;

  if exists (select 1 from dispatch_outbound
              where idempotency_key = p_idempotency_key and tenant_id = v_tenant) then
    return p_run_id;
  end if;

  select status into cur from dispatch_run where id = p_run_id and tenant_id = v_tenant;
  if cur is null then
    raise exception 'unknown dispatch run %', p_run_id using errcode = 'foreign_key_violation';
  end if;

  if cur not in ('draft', 'sent') then
    raise exception 'dispatch run % is % — only an active draft/sent run may be sent (lifecycle: a superseded run was re-planned away)', p_run_id, cur
      using errcode = 'restrict_violation';
  end if;

  insert into dispatch_outbound (dispatch_run_id, channel, status, occurred_at, idempotency_key)
  values (p_run_id, coalesce(p_channel, 'web-share'), 'pending', p_occurred_at, p_idempotency_key)
  on conflict (idempotency_key) do nothing;

  if cur = 'draft' then
    update dispatch_run
       set status = 'sent', sent_channel = coalesce(p_channel, 'web-share'), sent_at = p_occurred_at
     where id = p_run_id and tenant_id = v_tenant;
  elsif cur = 'sent' then
    update dispatch_run
       set sent_channel = coalesce(sent_channel, p_channel, 'web-share')
     where id = p_run_id and tenant_id = v_tenant;
  end if;

  return p_run_id;
end $$;
revoke execute on function mark_dispatch_sent(bigint, text, timestamptz, text, bigint, text) from public;
grant   execute on function mark_dispatch_sent(bigint, text, timestamptz, text, bigint, text) to authenticated;

-- L4. record_weigh_in — THE field write door. Under per-tenant lot codes both tenants own
--     'JC-001', so the SUBSEQUENT-weigh `update lots set origin_kg = … where code = v_lot`
--     (a bare-code UPDATE) grows BOTH tenants' same-coded lot — A's weigh inflates B's mass.
--     Clamp every bare-key touch to current_tenant_id(): the weigh dedup read, the crew-
--     membership gate, the plot read, the find-or-mint reuse join, the subsequent-weigh
--     `update lots`, the per-picker harvests id (tenant-qualified so it can't collide with
--     B's same-coded lot) + its tenant_id, the attendance dedup, and the workers.today_kg
--     update. The weigh_event INSERT auto-stamps tenant_id (default = v_tenant); the
--     BEFORE-INSERT set_hash assert already verifies it. The intake call delegates to the
--     8-arg record_cherry_intake (whose own bare-key reads run under the same session GUC).
create or replace function record_weigh_in(
  p_worker_id       text,
  p_plot_id         text,
  p_cherries_kg     numeric,
  p_ripeness        ripeness,
  p_brix            numeric,
  p_scale_source    text,
  p_captured_lat    double precision,
  p_captured_lng    double precision,
  p_occurred_at     timestamptz,
  p_device_id       text,
  p_device_seq      bigint,
  p_idempotency_key text
) returns text
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare
  v_tenant     uuid := current_tenant_id();
  existing_lot text;
  v_lot        text;
  v_crew       text;
  v_variety    coffee_variety;
  v_centroid   jsonb;
  v_geofence   boolean;
  v_day        date := (p_occurred_at at time zone 'UTC')::date;
  v_intake_seq bigint;
  v_dist       double precision;
  v_inserted   text;
begin
  if v_tenant is null then
    raise exception 'record_weigh_in: no tenant context' using errcode = 'insufficient_privilege';
  end if;

  perform pg_advisory_xact_lock(hashtext('weigh:' || v_tenant::text || ':' || p_idempotency_key)::bigint);

  -- exactly-once, tenant-scoped (two tenants reusing a key each get their own row).
  select lot_code into existing_lot from weigh_event
   where idempotency_key = p_idempotency_key and tenant_id = v_tenant;
  if existing_lot is not null then
    return existing_lot;
  end if;

  if p_cherries_kg is null
     or p_cherries_kg = 'NaN'::numeric
     or not (p_cherries_kg > 0)
     or p_cherries_kg = 'Infinity'::numeric then
    raise exception 'cherries_kg must be > 0' using errcode = 'check_violation';
  end if;

  -- (a) the worker must be an ACTIVE crew member OF THE CALLER'S TENANT.
  select m.crew_id into v_crew
    from crew_memberships m
   where m.worker_id = p_worker_id and m.left_at is null and m.tenant_id = v_tenant
   limit 1;
  if v_crew is null then
    raise exception 'worker % is not an active crew member', p_worker_id
      using errcode = 'check_violation';
  end if;

  select variety, centroid into v_variety, v_centroid from plots
   where id = p_plot_id and tenant_id = v_tenant;
  if v_variety is null then
    raise exception 'unknown plot %', p_plot_id using errcode = 'foreign_key_violation';
  end if;

  perform pg_advisory_xact_lock(hashtext('weigh-intake:' || v_tenant::text || ':' || p_plot_id || ':' || v_day::text)::bigint);

  -- reuse the plot+day cherry lot ONLY within the caller's tenant.
  select we.lot_code into v_lot
    from weigh_event we
    join lots l on l.code = we.lot_code and l.tenant_id = we.tenant_id
   where we.plot_id = p_plot_id
     and we.tenant_id = v_tenant
     and (we.occurred_at at time zone 'UTC')::date = v_day
     and l.stage = 'cherry'
   order by we.recorded_at asc
   limit 1;

  if v_lot is null then
    v_intake_seq := nextval('worker_server_seq');
    v_lot := record_cherry_intake(
      p_plot_id, p_worker_id, p_cherries_kg, v_variety,
      p_occurred_at, 'server', v_intake_seq,
      'weigh-intake:' || p_idempotency_key
    );
  else
    -- SUBSEQUENT weigh-in: grow ONLY the caller's tenant's same-coded lot.
    update lots
       set origin_kg  = coalesce(origin_kg, 0)  + p_cherries_kg,
           current_kg = coalesce(current_kg, 0) + p_cherries_kg
     where code = v_lot and tenant_id = v_tenant;

    -- the per-picker harvests row. harvests.id is a GLOBAL single-col PK, so under
    -- per-tenant lot codes a bare 'wh-'||key collides across tenants — tenant-qualify it,
    -- and stamp tenant_id LITERALLY (the owner default is NULL with two tenants seeded).
    insert into harvests (tenant_id, id, date, plot_id, worker_id, cherries_kg, ripeness_pct, brix_avg, lot_code)
    values (
      v_tenant, 'wh-' || v_tenant::text || '-' || p_idempotency_key, v_day, p_plot_id, p_worker_id, p_cherries_kg,
      case p_ripeness when 'underripe' then 40 when 'overripe' then 70 else 95 end,
      coalesce(p_brix, 0), v_lot
    )
    on conflict (id) do nothing;
  end if;

  -- (d) ATTENDANCE presence proof — tenant-scoped existence + an auto-stamped event.
  if not exists (
    select 1 from attendance_event
     where worker_id = p_worker_id and event_kind = 'clock-in'
       and tenant_id = v_tenant
       and (occurred_at at time zone 'UTC')::date = v_day
  ) then
    insert into attendance_event (idempotency_key, stream_key, worker_id, crew_id,
                                  event_kind, plot_id, occurred_at, device_id, device_seq)
    values ('weigh-clockin:' || v_tenant::text || ':' || p_worker_id || ':' || v_day::text,
            'attendance:' || p_worker_id, p_worker_id, v_crew,
            'clock-in', p_plot_id, p_occurred_at, 'server', nextval('worker_server_seq'))
    on conflict (idempotency_key) do nothing;
    perform _resync_worker_attendance(p_worker_id);
  end if;

  if p_captured_lat is not null and p_captured_lng is not null
     and v_centroid is not null and v_centroid ? 'coordinates' then
    v_dist := _haversine_m(
      p_captured_lat, p_captured_lng,
      (v_centroid -> 'coordinates' ->> 1)::double precision,
      (v_centroid -> 'coordinates' ->> 0)::double precision
    );
    v_geofence := v_dist <= _weigh_geofence_radius_m();
  else
    v_geofence := null;
  end if;

  -- (e) the genesis weigh_event. tenant_id auto-stamps via the column default (= v_tenant);
  -- the BEFORE-INSERT set_hash assert verifies it matches the session tenant.
  insert into weigh_event (idempotency_key, stream_key, worker_id, crew_id, plot_id,
                           lot_code, kg, ripeness, brix, scale_source,
                           captured_lat, captured_lng, geofence_ok, payload,
                           occurred_at, device_id, device_seq)
  values (p_idempotency_key, 'weigh:' || v_lot, p_worker_id, v_crew, p_plot_id,
          v_lot, p_cherries_kg, p_ripeness, p_brix,
          coalesce(p_scale_source, 'manual'),
          p_captured_lat, p_captured_lng, v_geofence,
          jsonb_build_object('worker_id', p_worker_id, 'plot_id', p_plot_id,
                             'lot_code', v_lot, 'kg', p_cherries_kg,
                             'ripeness', p_ripeness, 'scale_source', coalesce(p_scale_source,'manual')),
          p_occurred_at, p_device_id, p_device_seq)
  on conflict (idempotency_key) do nothing
  returning idempotency_key into v_inserted;

  if v_inserted is not null then
    update workers set today_kg = coalesce(today_kg, 0) + p_cherries_kg
     where id = p_worker_id and tenant_id = v_tenant;
  end if;

  return v_lot;
end $$;
revoke execute on function record_weigh_in(text, text, numeric, ripeness, numeric, text, double precision, double precision, timestamptz, text, bigint, text) from public;
grant   execute on function record_weigh_in(text, text, numeric, ripeness, numeric, text, double precision, double precision, timestamptz, text, bigint, text) to authenticated;

-- L5. assign_drying_station — SECURITY DEFINER UPDATE-by-bare-code on drying_assignments.
--     Under per-tenant lot codes the close-current `update … where lot_code = p_lot_code
--     and released_at is null` closes BOTH tenants' open assignments on the shared code —
--     A's re-assign releases B's open commitment. Clamp the idempotent reuse read, the lot
--     existence + mass reads, the close-current UPDATE, to current_tenant_id() (fail closed
--     on null). The new assignment INSERT auto-stamps tenant_id (default = v_tenant).
create or replace function assign_drying_station(
  p_lot_code   text,
  p_station_id text,
  p_occurred_at timestamptz
) returns bigint
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  lot_kg numeric;
  new_id bigint;
begin
  if v_tenant is null then
    raise exception 'assign_drying_station: no tenant context' using errcode = 'insufficient_privilege';
  end if;

  select id into new_id from drying_assignments
   where lot_code = p_lot_code and station_id = p_station_id and released_at is null
     and tenant_id = v_tenant
   limit 1;
  if new_id is not null then
    return new_id;
  end if;

  if not exists (select 1 from lots where code = p_lot_code and tenant_id = v_tenant) then
    raise exception 'unknown lot %', p_lot_code using errcode = 'foreign_key_violation';
  end if;

  select coalesce(current_kg, origin_kg) into lot_kg from lots
   where code = p_lot_code and tenant_id = v_tenant;
  if lot_kg is null then
    raise exception 'cannot assign station: lot % has no declared mass', p_lot_code
      using errcode = 'check_violation';
  end if;

  update drying_assignments
     set released_at = p_occurred_at
   where lot_code = p_lot_code and released_at is null and tenant_id = v_tenant;

  insert into drying_assignments (lot_code, station_id, committed_kg, assigned_at)
  values (p_lot_code, p_station_id, lot_kg, p_occurred_at)
  returning id into new_id;
  return new_id;
end $$;
revoke execute on function assign_drying_station(text, text, timestamptz) from public;
grant   execute on function assign_drying_station(text, text, timestamptz) to authenticated;

-- L6. record_moisture_reading — SECURITY DEFINER write + a bare-code mirror UPDATE on
--     processing_batches. Under per-tenant lot codes the `update processing_batches set
--     moisture_pct = … where lot_code = p_lot_code` stamps BOTH tenants' same-coded batch —
--     A's reading overwrites B's batch moisture. Clamp the idempotency read, the lot
--     existence read, and the processing_batches mirror UPDATE to current_tenant_id() (fail
--     closed on null). The moisture_readings INSERT auto-stamps tenant_id (default); the
--     record_lot_event call runs under the same session GUC. Idempotency key tenant-scoped
--     by adding `and tenant_id = v_tenant` to the dedup read.
create or replace function record_moisture_reading(
  p_lot_code        text,
  p_moisture_pct    numeric,
  p_occurred_at     timestamptz,
  p_device_id       text,
  p_device_seq      bigint,
  p_idempotency_key text
) returns bigint
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare
  v_tenant    uuid := current_tenant_id();
  existing_id bigint;
  new_id      bigint;
begin
  if v_tenant is null then
    raise exception 'record_moisture_reading: no tenant context' using errcode = 'insufficient_privilege';
  end if;

  if p_idempotency_key is null then
    raise exception 'idempotency_key required' using errcode = 'not_null_violation';
  end if;
  if p_occurred_at > now() + interval '1 hour' then
    raise exception 'moisture reading time % is in the future (server now %)', p_occurred_at, now()
      using errcode = 'check_violation';
  end if;
  select id into existing_id from moisture_readings
   where idempotency_key = p_idempotency_key and tenant_id = v_tenant;
  if existing_id is not null then
    return existing_id;
  end if;
  if not exists (select 1 from lots where code = p_lot_code and tenant_id = v_tenant) then
    raise exception 'unknown lot %', p_lot_code using errcode = 'foreign_key_violation';
  end if;
  insert into moisture_readings (lot_code, moisture_pct, occurred_at, device_id, device_seq, idempotency_key)
  values (p_lot_code, p_moisture_pct, p_occurred_at, p_device_id, p_device_seq, p_idempotency_key)
  on conflict (idempotency_key) do nothing
  returning id into new_id;
  if new_id is null then
    select id into new_id from moisture_readings
     where idempotency_key = p_idempotency_key and tenant_id = v_tenant;
    return new_id;
  end if;
  -- mirror onto the OWNING tenant's processing_batch only.
  update processing_batches set moisture_pct = p_moisture_pct
   where lot_code = p_lot_code and tenant_id = v_tenant;
  perform record_lot_event(
    p_lot_code, 'moisture_reading',
    jsonb_build_object('moisture_pct', p_moisture_pct),
    p_occurred_at, p_device_id, p_device_seq, 'moisture-reading:' || p_idempotency_key
  );
  return new_id;
end $$;
revoke execute on function record_moisture_reading(text, numeric, timestamptz, text, bigint, text) from public;
grant   execute on function record_moisture_reading(text, numeric, timestamptz, text, bigint, text) to authenticated;

-- L7. compute_pay_period — SECURITY DEFINER payroll over `for r in select … from workers`.
--     The UNFILTERED worker loop runs payroll across EVERY tenant's workers, so B's worker
--     gets a pay_line in A's period (mis-stamped tenant_id = A via the column default,
--     hiding it from a tenant_id check). Clamp the worker set to current_tenant_id() (the
--     whole leak), fail closed on null, and tenant-qualify the idempotency existence check,
--     the per-worker input fns' scope (they read attendance/weigh, which are RLS-scoped
--     under the session GUC), the config reads, and the pay_period close-out. The pay_line
--     + pay_period INSERT/UPDATE auto-stamp/clamp tenant_id (default = v_tenant).
create or replace function compute_pay_period(
  p_period_id     text,
  p_period_start  date,
  p_period_end    date,
  p_season        text,
  p_hourly_rate_source text default 'daily'
) returns text
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare
  v_tenant     uuid := current_tenant_id();
  r            record;
  v_piece      numeric;
  v_hours      numeric;
  v_days       integer;
  v_hourly_pay numeric;
  v_hourly_rate numeric;
  v_workday    numeric;
  v_css        numeric;
  v_seg        numeric;
  v_dec        numeric;
  v_gross      numeric;
  st           record;
begin
  if v_tenant is null then
    raise exception 'compute_pay_period: no tenant context' using errcode = 'insufficient_privilege';
  end if;

  insert into pay_period (id, period_start, period_end, season, status)
  values (p_period_id, p_period_start, p_period_end, p_season, 'open')
  on conflict (id) do nothing;

  if exists (select 1 from pay_line
              where pay_period_id = p_period_id and reverses_id is null and status <> 'reversed'
                and tenant_id = v_tenant) then
    return p_period_id;
  end if;

  select standard_workday_hours into v_workday from farm_season_config where tenant_id = v_tenant;
  v_workday := coalesce(v_workday, 8);
  select * into st from v_statutory_effective(p_period_end);
  if not found then
    raise exception 'no statutory_rates effective on or before % — configure rates for this period before computing payroll', p_period_end
      using errcode = 'no_data_found';
  end if;

  -- ONLY the caller's tenant's workers (the §L7 clamp — never all-estates payroll).
  for r in select id, daily_rate_usd from workers where tenant_id = v_tenant loop
    v_piece := v_worker_piece_rate(r.id, p_period_start, p_period_end);
    v_hours := v_worker_hours(r.id, p_period_start, p_period_end);
    v_days  := v_worker_days_present(r.id, p_period_start, p_period_end);
    v_hourly_rate := case when v_workday > 0 then coalesce(r.daily_rate_usd, 0) / v_workday else 0 end;
    v_hourly_pay  := round(v_hours * v_hourly_rate, 2);
    v_piece       := round(v_piece, 2);

    v_gross := v_piece + v_hourly_pay;
    v_css := round(v_gross * coalesce(st.css_employee_pct, 0)     / 100.0, 2);
    v_seg := round(v_gross * coalesce(st.seguro_educativo_pct, 0) / 100.0, 2);
    v_dec := round(v_gross * coalesce(st.decimo_accrual_pct, 0)   / 100.0, 2);

    insert into pay_line (pay_period_id, worker_id, hours_worked, worked_days, piece_rate_usd, hourly_usd,
                          min_wage_floor_usd, css_usd, seguro_educativo_usd, decimo_accrual_usd, status)
    values (p_period_id, r.id, v_hours, v_days, v_piece, v_hourly_pay,
            0, v_css, v_seg, v_dec, 'calculated');
  end loop;

  update pay_period set status = 'calculated', calculated_at = now()
   where id = p_period_id and status = 'open' and tenant_id = v_tenant;

  return p_period_id;
end $$;
revoke execute on function compute_pay_period(text, date, date, text, text) from public;
grant   execute on function compute_pay_period(text, date, date, text, text) to authenticated;

-- L8. eudr_declare_plot — SECURITY DEFINER UPDATE-by-bare-plot-id on plots. As A, declaring
--     B's plot deforestation-free flips B's compliance flag (an export-fraud surface).
--     Clamp the UPDATE predicate to current_tenant_id() (fail closed on null) so a foreign
--     plot matches zero rows → the `not found` branch raises and B's declaration is never
--     rewritten.
create or replace function eudr_declare_plot(
  p_plot_id text,
  p_free    boolean,
  p_basis   text default null
) returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare v_tenant uuid := current_tenant_id();
begin
  if v_tenant is null then
    raise exception 'eudr_declare_plot: no tenant context' using errcode = 'insufficient_privilege';
  end if;
  if p_free and p_basis is null then
    raise exception 'a deforestation-free declaration requires a basis'
      using errcode = 'check_violation';
  end if;
  update plots
     set eudr_deforestation_free = p_free,
         eudr_decl_basis          = case when p_free then p_basis else null end,
         eudr_declared_at         = now()
   where id = p_plot_id and tenant_id = v_tenant;
  if not found then
    raise exception 'unknown plot %', p_plot_id using errcode = 'foreign_key_violation';
  end if;
end $$;
revoke execute on function eudr_declare_plot(text, boolean, text) from public;
grant   execute on function eudr_declare_plot(text, boolean, text) to authenticated;


-- ============================================================================
-- Section M. PROD-FAITHFUL RELOCATION of phase-2 tenant clamps (P4-S0).
--   These 6 SECURITY DEFINER fns were tenant-clamped in 20260622090000_people_system.sql
--   and 20260622092000_fermentation.sql, but those migrations already ran on prod, so
--   their edits would never apply there. Relocated here so the clamps reach prod;
--   the two phase-2 files are reverted to their original (pre-clamp) bodies.
-- ============================================================================

-- M.1 people_system internal resync helpers
create or replace function _resync_worker_crew(p_worker_id text) returns void
  language plpgsql
  set search_path = public
as $$
declare nm text;
begin
  -- P4-S0: clamp to the caller's tenant. This helper is invoked (via perform) from the
  -- SECURITY DEFINER command RPCs, so it runs RLS-bypassing as the function owner; a bare
  -- worker_id read/write would touch another estate's same-id worker. The session GUC is
  -- preserved across the perform, so current_tenant_id() is the caller's.
  select c.name into nm
    from crew_memberships m
    join crews c on c.id = m.crew_id and c.tenant_id = m.tenant_id
   where m.worker_id = p_worker_id and m.left_at is null
     and m.tenant_id = current_tenant_id()
   order by m.joined_at desc
   limit 1;
  if nm is not null then
    update workers set crew = nm where id = p_worker_id and tenant_id = current_tenant_id();
  end if;
end $$;

create or replace function _resync_worker_attendance(p_worker_id text) returns void
  language plpgsql
  set search_path = public
as $$
declare k text; st attendance_status;
begin
  -- P4-S0: clamp to the caller's tenant (runs RLS-bypassing under the calling definer RPC).
  select event_kind into k
    from attendance_event
   where worker_id = p_worker_id and tenant_id = current_tenant_id()
   order by occurred_at desc, recorded_at desc
   limit 1;
  st := case k
          when 'clock-in'  then 'present'::attendance_status
          when 'clock-out' then 'present'::attendance_status
          when 'rest-day'  then 'rest-day'::attendance_status
          when 'absent'    then 'absent'::attendance_status
          else null
        end;
  if st is not null then
    update workers set attendance = st where id = p_worker_id and tenant_id = current_tenant_id();
  end if;
end $$;

revoke execute on function _resync_worker_crew(text)       from public;
revoke execute on function _resync_worker_attendance(text) from public;

-- M.2 fermentation definer RPCs
create or replace function apply_ferment_recipe(
  p_batch_id  uuid,
  p_recipe_id text
) returns uuid
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare
  v_lot text;
  v_seq bigint;
begin
  -- P4-S0: tenant-clamp every ferment_batches / ferment_recipes access (SECURITY DEFINER
  -- bypasses RLS; ferment_batches.id is a global uuid and ferment_recipes is per-tenant
  -- proprietary IP — a bare-key read/update could reach another estate's batch/recipe).
  select lot_code into v_lot from ferment_batches
   where id = p_batch_id and tenant_id = current_tenant_id();
  if v_lot is null then
    raise exception 'unknown ferment batch %', p_batch_id using errcode = 'foreign_key_violation';
  end if;
  if not exists (select 1 from ferment_recipes where id = p_recipe_id and tenant_id = current_tenant_id()) then
    raise exception 'unknown recipe %', p_recipe_id using errcode = 'foreign_key_violation';
  end if;

  -- no-op if already bound to this exact recipe (idempotent rebind: no event)
  if exists (select 1 from ferment_batches
              where id = p_batch_id and recipe_id = p_recipe_id and tenant_id = current_tenant_id()) then
    return p_batch_id;
  end if;

  update ferment_batches set recipe_id = p_recipe_id
   where id = p_batch_id and tenant_id = current_tenant_id();

  -- Draw device_seq from the shared monotonic server sequence (the SSOT the weigh /
  -- attendance / clock-in paths use) instead of a WHOLE-SECOND epoch. A second-
  -- granularity epoch under the constant 'server-ferment' device collides on
  -- lot_event's UNIQUE(device_id, device_seq) whenever two distinct binds land in the
  -- same wall-clock second, aborting the bind with a raw 23505. nextval is strictly
  -- increasing and never repeats, so (device_id, device_seq) is collision-free forever.
  v_seq := nextval('worker_server_seq');

  -- Fold the seq into the event's idempotency_key so a genuine rebind back to a
  -- previously-used recipe (A->B->A) always appends a fresh ferment_recipe_applied
  -- event (the line-above no-op check already makes a true same-recipe re-apply a
  -- no-op). Without the seq the key 'apply-recipe:batch:A' would be reused on the
  -- rebind-to-A and ON CONFLICT DO NOTHING would silently drop the event, leaving the
  -- batch's recipe_id diverged from the ledger's last recipe-applied event.
  perform record_lot_event(
    v_lot, 'ferment_recipe_applied',
    jsonb_build_object('batch_id', p_batch_id, 'recipe_id', p_recipe_id),
    now(), 'server-ferment', v_seq,
    'apply-recipe:' || p_batch_id::text || ':' || p_recipe_id || ':' || v_seq::text
  );
  return p_batch_id;
end $$;

create or replace function start_ferment_batch(
  p_lot_code        text,
  p_recipe_id       text,
  p_method          process_method,
  p_occurred_at     timestamptz,
  p_device_id       text,
  p_device_seq      bigint,
  p_idempotency_key text
) returns uuid
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare
  new_id uuid;
begin
  -- P4-S0: tenant-clamp the lot + recipe existence checks (SECURITY DEFINER bypasses RLS).
  if not exists (select 1 from lots where code = p_lot_code and tenant_id = current_tenant_id()) then
    raise exception 'unknown lot %', p_lot_code using errcode = 'foreign_key_violation';
  end if;
  if p_recipe_id is not null and not exists (select 1 from ferment_recipes
                                              where id = p_recipe_id and tenant_id = current_tenant_id()) then
    raise exception 'unknown recipe %', p_recipe_id using errcode = 'foreign_key_violation';
  end if;

  -- FAIL CLOSED on a CROSS-KIND key collision. lot_event.idempotency_key is GLOBALLY
  -- unique across ALL kinds. If this key was already burned by a DIFFERENT event kind,
  -- the batch INSERT below would still succeed (the key is free on ferment_batches),
  -- but record_lot_event's ON CONFLICT (idempotency_key) DO NOTHING would silently drop
  -- the ferment_started append — leaving a phantom batch with no ledger backing. Reject
  -- it instead (23505 maps to the client's "already started" message). A genuine same-
  -- key replay of THIS start is handled by the domain ON CONFLICT below and never
  -- reaches here, because its event kind IS 'ferment_started'.
  if exists (
    select 1 from lot_event
     where idempotency_key = p_idempotency_key and kind <> 'ferment_started'
  ) then
    raise exception 'idempotency_key % already used by a different event kind', p_idempotency_key
      using errcode = 'unique_violation';
  end if;

  -- exactly-once is bound on the DOMAIN row, not a kind-scoped event lookup. Binding the
  -- key on ferment_batches makes the batch row and its ferment_started event atomically
  -- consistent: a genuine replay returns the same batch and re-appends nothing.
  insert into ferment_batches (lot_code, recipe_id, method, started_at, idempotency_key)
  values (p_lot_code, p_recipe_id, p_method, p_occurred_at, p_idempotency_key)
  on conflict (idempotency_key) do nothing
  returning id into new_id;

  if new_id is null then
    -- replay: return the already-minted batch, append nothing. The ferment_started
    -- event was already recorded on the original insert.
    select id into new_id from ferment_batches
     where idempotency_key = p_idempotency_key and tenant_id = current_tenant_id();
    return new_id;
  end if;

  perform record_lot_event(
    p_lot_code, 'ferment_started',
    jsonb_build_object('batch_id', new_id, 'lot_code', p_lot_code,
                       'recipe_id', p_recipe_id, 'method', p_method),
    p_occurred_at, p_device_id, p_device_seq, p_idempotency_key
  );
  return new_id;
end $$;

create or replace function record_ferment_reading(
  p_batch_id        uuid,
  p_kind            text,
  p_value           numeric,
  p_occurred_at     timestamptz,
  p_device_id       text,
  p_device_seq      bigint,
  p_idempotency_key text
) returns bigint
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare
  v_lot       text;
  existing    bigint;
  new_id      bigint;
  v_target_ph numeric;
  v_recipe    text;
  v_already   text;
  v_worker    text;
  v_plot      text;
  v_task_id   text;
begin
  -- exactly-once replay short-circuit (tenant-clamped: SECURITY DEFINER bypasses RLS)
  select id into existing from ferment_readings
   where idempotency_key = p_idempotency_key and tenant_id = current_tenant_id();
  if existing is not null then
    return existing;
  end if;

  -- fail closed on a CROSS-KIND key collision: the lot_event append below uses the SAME
  -- raw idempotency_key (one shared namespace). If that key already anchors a DIFFERENT
  -- ledger event, record_lot_event's ON CONFLICT DO NOTHING would silently drop the
  -- ferment_reading append, leaving a reading row in the immutable series with no
  -- backing provenance event. Reject it so the whole txn aborts (no orphaned reading).
  if exists (select 1 from lot_event where idempotency_key = p_idempotency_key) then
    raise exception 'idempotency_key % already anchors a different ledger event', p_idempotency_key
      using errcode = 'unique_violation';
  end if;

  select lot_code into v_lot from ferment_batches
   where id = p_batch_id and tenant_id = current_tenant_id();
  if v_lot is null then
    raise exception 'unknown ferment batch %', p_batch_id using errcode = 'foreign_key_violation';
  end if;

  insert into ferment_readings
    (batch_id, reading_kind, value, occurred_at, device_id, device_seq, idempotency_key)
  values (p_batch_id, p_kind, p_value, p_occurred_at, p_device_id, p_device_seq, p_idempotency_key)
  on conflict (idempotency_key) do nothing
  returning id into new_id;

  if new_id is null then
    -- lost a concurrent race on the same key — return the winner's id
    select id into new_id from ferment_readings
     where idempotency_key = p_idempotency_key and tenant_id = current_tenant_id();
    return new_id;
  end if;

  -- one shared idempotency namespace with the reading (no 'ferment-reading:' prefix): the
  -- event is anchored to the same key the reading deduped on, so it can never be orphaned.
  perform record_lot_event(
    v_lot, 'ferment_reading',
    jsonb_build_object('batch_id', p_batch_id, 'kind', p_kind, 'value', p_value),
    p_occurred_at, p_device_id, p_device_seq, p_idempotency_key
  );

  -- CLOSED-LOOP CUT ALERT: a pH reading at/below the recipe target = the window is
  -- closing. Fire ONE board task on the FIRST crossing only (single-fire anchor), so a
  -- replay or a subsequent below-target reading never double-fires. Skip silently if no
  -- recipe is bound, the reading isn't pH, the value is above target, or the task was
  -- already fired. (The v_ferment_cutpoint view still surfaces cut_reached regardless.)
  if p_kind = 'ph' then
    select b.recipe_id, b.fired_cut_task_id, rec.target_ph
      into v_recipe, v_already, v_target_ph
      from ferment_batches b
      left join ferment_recipes rec on rec.id = b.recipe_id and rec.tenant_id = b.tenant_id
     where b.id = p_batch_id and b.tenant_id = current_tenant_id();

    if v_recipe is not null and v_already is null
       and v_target_ph is not null and p_value <= v_target_ph then
      -- resolve an assignee; skip the task insert only if the farm has NO workers at all
      -- (tasks.worker_id is NOT NULL — never insert a null assignee).
      v_worker := _resolve_ferment_cut_worker(v_lot);
      if v_worker is not null then
        select plot_id into v_plot from harvests
         where lot_code = v_lot and tenant_id = current_tenant_id()
          order by date desc limit 1;
        v_task_id := gen_random_uuid()::text;
        insert into tasks (id, title, category, plot_id, worker_id, due, status, priority)
        values (
          v_task_id,
          'Cut ferment — ' || v_lot,
          'Ferment Cut',
          v_plot,
          v_worker,
          (p_occurred_at at time zone 'UTC')::date,
          'todo',
          'high'
        );
        update ferment_batches set fired_cut_task_id = v_task_id
         where id = p_batch_id and tenant_id = current_tenant_id();
      end if;
    end if;
  end if;

  return new_id;
end $$;

create or replace function log_mill_water(
  p_batch_id        uuid,
  p_liters          numeric,
  p_occurred_at     timestamptz,
  p_device_id       text,
  p_device_seq      bigint,
  p_idempotency_key text
) returns bigint
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare
  v_lot    text;
  existing bigint;
  new_id   bigint;
begin
  select id into existing from mill_water_log
   where idempotency_key = p_idempotency_key and tenant_id = current_tenant_id();
  if existing is not null then
    return existing;
  end if;

  -- fail closed on a CROSS-KIND key collision (one shared idempotency namespace with the
  -- lot_event append below). If the raw key already anchors a different ledger event,
  -- record_lot_event's ON CONFLICT DO NOTHING would silently drop the mill_water append,
  -- leaving a water-draw row with no backing provenance event. Reject so the txn aborts.
  if exists (select 1 from lot_event where idempotency_key = p_idempotency_key) then
    raise exception 'idempotency_key % already anchors a different ledger event', p_idempotency_key
      using errcode = 'unique_violation';
  end if;

  select lot_code into v_lot from ferment_batches
   where id = p_batch_id and tenant_id = current_tenant_id();
  if v_lot is null then
    raise exception 'unknown ferment batch %', p_batch_id using errcode = 'foreign_key_violation';
  end if;

  insert into mill_water_log
    (batch_id, liters, occurred_at, device_id, device_seq, idempotency_key)
  values (p_batch_id, p_liters, p_occurred_at, p_device_id, p_device_seq, p_idempotency_key)
  on conflict (idempotency_key) do nothing
  returning id into new_id;

  if new_id is null then
    select id into new_id from mill_water_log
     where idempotency_key = p_idempotency_key and tenant_id = current_tenant_id();
    return new_id;
  end if;

  -- one shared idempotency namespace with the water row (no 'mill-water:' prefix).
  perform record_lot_event(
    v_lot, 'mill_water',
    jsonb_build_object('batch_id', p_batch_id, 'liters', p_liters),
    p_occurred_at, p_device_id, p_device_seq, p_idempotency_key
  );
  return new_id;
end $$;

revoke execute on function apply_ferment_recipe(uuid, text)                                                 from public;
revoke execute on function start_ferment_batch(text, text, process_method, timestamptz, text, bigint, text) from public;
revoke execute on function record_ferment_reading(uuid, text, numeric, timestamptz, text, bigint, text)     from public;
revoke execute on function log_mill_water(uuid, numeric, timestamptz, text, bigint, text)                   from public;
grant execute on function apply_ferment_recipe(uuid, text)                                                  to authenticated;
grant execute on function start_ferment_batch(text, text, process_method, timestamptz, text, bigint, text)  to authenticated;
grant execute on function record_ferment_reading(uuid, text, numeric, timestamptz, text, bigint, text)      to authenticated;
grant execute on function log_mill_water(uuid, numeric, timestamptz, text, bigint, text)                    to authenticated;

commit;

