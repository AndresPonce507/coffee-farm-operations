-- ════════════════════════════════════════════════════════════════════════════
-- P4-S0 · Migration 1 of 3 — TENANCY SUBSTRATE + add-nullable tenant_id
-- ════════════════════════════════════════════════════════════════════════════
-- Introduces true multi-tenancy into a schema that is single-tenant + authenticated-
-- only today. This first migration is non-destructive and fail-safe:
--   1. create the tenancy substrate (tenants, tenant_users) + the default estate.
--   2. _default_tenant_id() / current_tenant_id() — the §3 trust anchor. Reads the
--      JWT claim GUC directly (NEVER auth.uid(), which is undefined under PGlite),
--      with a MEMBERSHIP-AWARE single-tenant fallback so the existing ~668-test suite
--      stays green (CRIT-2) while still failing closed once a second tenant exists.
--   3. handle_new_user() + the auth.users signup trigger, GUARDED behind an
--      information_schema existence check (fires on prod, no-op under PGlite).
--   4. add a NULLABLE tenant_id column to every tenant-scoped table (§2.A + §2.B).
--      No default-from-claim here (current_tenant_id() is NULL during migration).
--
-- Filename strictly > 20260623110000 (the July-1 "tenant cut-over" band, §7).
-- Self-wrapped begin;…commit; (rollback-proof protocol). AD-8 grants on every fn.

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Tenancy substrate
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists tenants (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists tenant_users (
  tenant_id   uuid not null references tenants(id),
  user_id     uuid not null,                 -- auth.users(id) on prod; NO cross-schema FK (PGlite replay)
  role        text not null default 'owner'
                check (role in ('owner','manager','agronomist','viewer')),
  expires_at  timestamptz,
  created_at  timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index if not exists tenant_users_user_idx on tenant_users (user_id);

-- The tenancy substrate is RLS-governed on its own terms (NOT via the scoping loop):
-- tenants has no tenant_id; tenant_users is scoped to the caller's own memberships.
alter table tenants      enable row level security;
alter table tenant_users enable row level security;

-- 2. The default estate anchor — _default_tenant_id() resolves to this row.
insert into tenants (slug, name)
  values ('janson-coffee', 'Janson Coffee')
  on conflict (slug) do nothing;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Tenant-identity helpers (§3)
-- ──────────────────────────────────────────────────────────────────────────
create or replace function _default_tenant_id() returns uuid
  language sql stable security definer
  set search_path = public
as $$ select id from tenants where slug = 'janson-coffee' $$;

-- current_tenant_id() — the request-time tenant resolver. Reads sub/app_metadata
-- straight from request.jwt.claims (the GUC the PGlite harness stamps); NEVER calls
-- auth.uid() (CRIT-1). Resolution order:
--   1. fast path  : app_metadata.tenant_id JWT claim (the minted cache, if present).
--   2. SSOT path  : tenant_users membership lookup keyed on the JWT `sub`.
--   3. fallback   : the lone tenant — ONLY while exactly one tenant exists AND the
--                   caller is trustworthy (no sub at all = bare owner/migration, OR
--                   the sub is an enrolled app_member). Returns NULL once >1 tenant
--                   exists → every policy ANDs `tenant_id = current_tenant_id()`, so
--                   NULL ≠ any uuid → FAIL-CLOSED in a real multi-tenant deployment.
-- The membership-aware fallback is what lets owner_scoped_rls's STRANGER (an
-- authenticated non-member) fail closed while bare-owner RPC tests (no claims) and a
-- seeded member both still resolve to the default estate (CRIT-2).
create or replace function current_tenant_id() returns uuid
  language plpgsql stable security definer
  set search_path = public
as $$
declare
  v_raw    text := current_setting('request.jwt.claims', true);
  v_claims jsonb;
  v_sub    text;
begin
  -- Coerce the empty/NULL GUC (claimless owner / harness teardown resets to '') to an
  -- empty object so `::jsonb` never throws "invalid input syntax for type json".
  v_claims := case
                when v_raw is null or v_raw = '' then '{}'::jsonb
                else v_raw::jsonb
              end;
  v_sub := nullif(v_claims ->> 'sub', '');

  return coalesce(
    -- 1) fast path: the minted JWT claim (never auth.uid())
    nullif(v_claims -> 'app_metadata' ->> 'tenant_id', '')::uuid,
    -- 2) SSOT path: membership lookup keyed on the JWT `sub`
    (select tenant_id from tenant_users
       where user_id = v_sub::uuid
       limit 1),
    -- 3) membership-aware single-tenant fallback (NULL once >1 tenant → fail-closed)
    (select id from tenants
       where (select count(*) from tenants) = 1
         and (
           v_sub is null            -- bare owner / migration context (no caller)
           or public.is_member()    -- an enrolled app_member (the single-estate owner)
         )
       limit 1)
  );
end;
$$;

revoke execute on function _default_tenant_id()  from public;
grant   execute on function _default_tenant_id()  to authenticated;
revoke execute on function current_tenant_id()    from public;
grant   execute on function current_tenant_id()    to authenticated;

-- tenant_users policy: a caller reads only the rows that name their own tenant.
drop policy if exists "tenant_users self" on tenant_users;
create policy "tenant_users self" on tenant_users for select to authenticated
  using (tenant_id = current_tenant_id());

-- tenants policy: a caller reads only their own tenant row.
drop policy if exists "tenant self" on tenants;
create policy "tenant self" on tenants for select to authenticated
  using (id = current_tenant_id());

grant select on tenants      to authenticated;
grant select on tenant_users to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Signup binding — prod-only (auth.users absent under PGlite → guarded no-op).
-- ──────────────────────────────────────────────────────────────────────────
-- _handle_new_user — trigger-only (never caller-facing). Leading underscore per the
-- AD-8 convention: it runs from the auth.users signup trigger as the owner and must
-- NOT be granted execute to authenticated (a grant would open a forge door).
create or replace function _handle_new_user() returns trigger
  language plpgsql security definer set search_path = public
as $$
declare t uuid;
begin
  t := _default_tenant_id();
  insert into tenant_users (tenant_id, user_id, role)
    values (t, new.id, 'owner') on conflict (tenant_id, user_id) do nothing;
  return new;
end $$;
revoke execute on function _handle_new_user() from public;

do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'auth' and table_name = 'users') then
    -- (re)create the trigger idempotently
    if exists (select 1 from pg_trigger where tgname = 'on_auth_user_created') then
      execute 'drop trigger on_auth_user_created on auth.users';
    end if;
    execute 'create trigger on_auth_user_created after insert on auth.users
             for each row execute function _handle_new_user()';
  end if;
end $$;

-- Guarded tenant_users backfill: enroll every existing auth.users id into the default
-- estate (prod only). A bare `from auth.users` would error at replay under PGlite —
-- the existence guard makes it a clean no-op there (tenant_users is seeded directly
-- by the probe instead, §8/MED-4).
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'auth' and table_name = 'users') then
    execute 'insert into tenant_users (tenant_id, user_id, role)
             select _default_tenant_id(), id, ''owner'' from auth.users
             on conflict (tenant_id, user_id) do nothing';
  end if;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 5. Add NULLABLE tenant_id to every tenant-scoped table (§2.A + §2.B).
--    The array below is the SAME ~54-table source of truth the probe imports as
--    TENANT_TABLES (src/test/db/tenantTables.ts). The §8 static parity guard
--    reconciles it against pg_class, so they cannot drift. No default-from-claim
--    here (current_tenant_id() is NULL during migration → would stamp NULL).
-- ──────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    -- §2.A DIRECT roots + no-FK ledgers/costing orphans
    'plots','workers','lots','crews','reserve_zones','farm_season_config',
    'pay_period','dispatch_run','weather','drying_stations','ferment_recipes',
    'lot_event','worker_stream_event','cost_entry','weigh_event','attendance_event',
    -- §2.B INHERITED (lot subtree)
    'green_lots','processing_batches','lot_reservations','lot_shipments',
    'ferment_batches','ferment_readings','mill_water_log','drying_assignments',
    'moisture_readings','cupping_sessions','cupping_scores','green_defects',
    'qc_holds','lot_edges',
    -- §2.B INHERITED (plot subtree)
    'plot_phenology','maturation_signal','pasada_schedule','plot_vegetation_index',
    'scouting_observation','spray_application',
    -- §2.B INHERITED (worker subtree)
    'worker_identity','worker_certifications','por_obra_contracts','crew_memberships',
    -- §2.B multi-parent operational
    'harvests','tasks','dispatch_assignment','dispatch_acknowledgement',
    'dispatch_outbound','pay_line','disbursement','crew_plot'
  ]
  loop
    execute format('alter table %I add column if not exists tenant_id uuid;', t);
  end loop;
end $$;

commit;
