-- S3 — THE TRUNK: event log + lot graph + units + first command RPCs +
-- activity-as-projection. Implements ADR-001 (event-log-as-SSOT, hash-chained,
-- immutable), ADR-002 (all writes via SECURITY DEFINER command RPCs), and the
-- activity-feed projection corner of ADR-003.
--
-- SUBSTRATE: pgcrypto lives in the `extensions` schema (ADR-005 idiom); the hash
-- chain calls `extensions.digest(bytea, 'sha256')`. PGlite loads pgcrypto/pg_trgm
-- as WASM contrib modules (see pgliteHarness.ts) so this whole migration replays
-- in-process at $0 (AD-9). gen_random_uuid() is built into PGlite/PG15 core.
--
-- GRANTS (AD-8): grant_hygiene locked default privileges, so EVERY new table/view
-- gets an explicit `grant select ... to authenticated`, and EVERY SECURITY DEFINER
-- RPC an explicit `grant execute ... to authenticated`. NO write table grants are
-- issued — `lot_event`/`lot_edges`/`lots` are mutated ONLY through the definer RPCs
-- (ADR-002: definer RPCs are the only surviving write path post-grant_hygiene).

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 0. Extensions — pgcrypto in the `extensions` schema (digest for the hash chain)
-- ──────────────────────────────────────────────────────────────────────────
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. units + convert_qty  (UCUM-lite; NULL on incommensurable / unknown — D8)
--    Each unit declares its dimension and a multiplicative factor to the
--    dimension's base unit. Conversion is legal ONLY within one dimension.
-- ──────────────────────────────────────────────────────────────────────────
create table units (
  code      text    primary key,           -- UCUM code: 'kg','g','[brix]','%','m2','ha','Cel','L','count'
  dimension text    not null,              -- 'mass','volume','area','temperature','ratio','dimensionless'
  to_base   numeric not null,             -- multiply a value in `code` by this to get the dimension's base unit
  display   text    not null
);

insert into units (code, dimension, to_base, display) values
  ('kg',     'mass',          1,       'kg'),
  ('g',      'mass',          0.001,   'g'),
  ('L',      'volume',        1,       'L'),
  ('mL',     'volume',        0.001,   'mL'),
  ('ha',     'area',          1,       'ha'),
  ('m2',     'area',          0.0001,  'm²'),
  -- [brix] (°Bx sugar content) is NOT commensurable with % — it gets its OWN
  -- dimension so convert_qty('[brix]','%') returns NULL (fails loud, never a
  -- silent wrong number — D8). Lumping both as 'ratio' would silently "convert"
  -- a sugar-content reading into a percentage.
  ('[brix]', 'sugar_content', 1,       '°Bx'),
  ('%',      'ratio',         1,       '%'),
  ('Cel',    'temperature',   1,       '°C'),
  ('count',  'dimensionless', 1,       'count');

-- convert_qty: pure function (no row mutation) — SECURITY INVOKER is fine, it only
-- reads the public `units` table the caller can already read. NULL is returned for
-- an unknown unit OR a cross-dimension request (fails loud, never silently 0).
create or replace function convert_qty(qty numeric, from_unit text, to_unit text)
  returns numeric
  language sql
  stable
  set search_path = public, extensions
as $$
  select case
    when f.code is null or t.code is null      then null      -- unknown unit
    when f.dimension <> t.dimension            then null      -- incommensurable
    else qty * f.to_base / t.to_base
  end
  from (select * from units where code = from_unit) f
  full outer join (select * from units where code = to_unit) t on true;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Promote `lots` in place (ADR / D-LOT-1): add graph-node columns.
--    Nullable / defaulted so the existing seeded `lots(code)` rows survive.
-- ──────────────────────────────────────────────────────────────────────────
alter table lots
  add column if not exists stage            text,
  add column if not exists variety          coffee_variety,
  add column if not exists origin_kg        numeric,
  add column if not exists current_kg       numeric,
  add column if not exists is_single_origin boolean not null default true,
  add column if not exists minted_at        timestamptz;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. lot_edges — the genealogy DAG; mass on EVERY edge (D6). Mass-conservation
--    is enforced by a trigger: the SUM of a parent's outgoing edge kg may never
--    exceed that parent's own kg (lots.current_kg, falling back to origin_kg).
-- ──────────────────────────────────────────────────────────────────────────
create table lot_edges (
  id          bigint generated always as identity primary key,
  parent_code text    not null references lots(code),
  child_code  text    not null references lots(code),
  kind        text    not null check (kind in ('split','merge','blend','process')),
  kg          numeric not null check (kg > 0),
  event_seq   bigint,
  created_at  timestamptz not null default now(),
  check (parent_code <> child_code)
);
create index lot_edges_parent_idx on lot_edges(parent_code);
create index lot_edges_child_idx  on lot_edges(child_code);

create or replace function lot_edges_conserve_mass() returns trigger
  language plpgsql
  set search_path = public
as $$
declare
  parent_kg numeric;
  routed_kg numeric;
begin
  select coalesce(current_kg, origin_kg) into parent_kg from lots where code = new.parent_code;
  if parent_kg is null then
    -- A parent with UNDECLARED mass is NOT an unlimited mass source (finding #4):
    -- routing out of a node that never declared mass would let the graph conjure
    -- mass from nothing. Reject — declare the parent's mass first.
    raise exception
      'mass conservation violated: lot % has undeclared mass; cannot route % kg out of it',
      new.parent_code, new.kg
      using errcode = 'check_violation';
  end if;
  select coalesce(sum(kg), 0) into routed_kg
    from lot_edges
   where parent_code = new.parent_code
     and (tg_op <> 'UPDATE' or id <> new.id);
  if routed_kg + new.kg > parent_kg + 1e-9 then
    raise exception
      'mass conservation violated: routing % kg out of lot % would exceed its % kg (already routed %)',
      new.kg, new.parent_code, parent_kg, routed_kg
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- Conservation must also hold AFTER edges exist (finding #3): lowering a parent's
-- mass below what it has already routed out would silently break "the graph can't
-- conjure mass". This BEFORE UPDATE trigger on `lots` re-checks the outgoing total
-- whenever the effective parent kg drops.
create or replace function lots_conserve_mass_on_lower() returns trigger
  language plpgsql
  set search_path = public
as $$
declare
  new_kg    numeric;
  routed_kg numeric;
begin
  new_kg := coalesce(new.current_kg, new.origin_kg);
  if new_kg is null then
    -- mass cleared back to undeclared — its edges (if any) become unbacked; block
    -- only if there are outgoing edges to protect the invariant.
    select coalesce(sum(kg), 0) into routed_kg from lot_edges where parent_code = new.code;
    if routed_kg > 1e-9 then
      raise exception
        'mass conservation violated: cannot clear lot %''s mass while % kg is routed out of it',
        new.code, routed_kg
        using errcode = 'check_violation';
    end if;
    return new;
  end if;
  select coalesce(sum(kg), 0) into routed_kg from lot_edges where parent_code = new.code;
  if routed_kg > new_kg + 1e-9 then
    raise exception
      'mass conservation violated: lot % has % kg routed out; cannot lower its mass to % kg',
      new.code, routed_kg, new_kg
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger lots_conserve_mass_on_lower
  before update on lots
  for each row
  when (
    coalesce(new.current_kg, new.origin_kg) is distinct from
    coalesce(old.current_kg, old.origin_kg)
  )
  execute function lots_conserve_mass_on_lower();

create trigger lot_edges_conserve_mass
  before insert or update on lot_edges
  for each row execute function lot_edges_conserve_mass();

-- ──────────────────────────────────────────────────────────────────────────
-- 4. lot_yield_curve — house yield-loss factors per process stage (placeholder,
--    flagged for agronomy review). Lets the conservation `≈` carry a real number
--    later without a schema change.
-- ──────────────────────────────────────────────────────────────────────────
create table lot_yield_curve (
  from_stage     text    not null,
  to_stage       text    not null,
  yield_factor   numeric not null check (yield_factor > 0 and yield_factor <= 1),
  primary key (from_stage, to_stage)
);
insert into lot_yield_curve (from_stage, to_stage, yield_factor) values
  ('cherry',       'fermentation', 0.95),   -- PLACEHOLDER — agronomy review
  ('fermentation', 'drying',       0.50),
  ('drying',       'parchment',    0.90),
  ('parchment',    'milled',       0.80),
  ('milled',       'green',        0.98);

-- ──────────────────────────────────────────────────────────────────────────
-- 5. lot_code_seq — the gap-free, monotonic JC-NNN minter source (ADR-002).
--    Start above the existing seeded JC-6xx codes so a mint never collides.
-- ──────────────────────────────────────────────────────────────────────────
create sequence lot_code_seq as bigint start with 700 increment by 1;

-- ──────────────────────────────────────────────────────────────────────────
-- 6. lot_event — append-only, hash-chained ledger (ADR-001 / D4 / D5).
--    prev_hash/hash are computed SERVER-SIDE in a BEFORE INSERT trigger; the
--    client hash is never trusted (the trigger overwrites whatever is supplied).
-- ──────────────────────────────────────────────────────────────────────────
create table lot_event (
  event_uid       uuid        primary key default gen_random_uuid(),
  idempotency_key text        unique,
  stream_key      text        not null,
  kind            text        not null,
  payload         jsonb       not null default '{}'::jsonb
                    check (octet_length(payload::text) < 4096),
  occurred_at     timestamptz not null,                    -- field wall-clock (D5)
  recorded_at     timestamptz not null default now(),      -- server accept clock (D5)
  device_id       text        not null,
  device_seq      bigint      not null,
  prev_hash       bytea,
  hash            bytea,
  unique (device_id, device_seq)                           -- D4 replay safety
);
create index lot_event_stream_idx   on lot_event (stream_key, device_seq);
create index lot_event_recorded_idx on lot_event (recorded_at);
create index lot_event_kind_idx     on lot_event (kind);

-- Canonical bytes a row's hash binds — deterministic, stable column order.
create or replace function lot_event_canonical_bytes(
  p_stream_key text, p_kind text, p_payload jsonb,
  p_occurred_at timestamptz, p_device_id text, p_device_seq bigint
) returns bytea
  language sql
  immutable
as $$
  select convert_to(
    coalesce(p_stream_key,'') || '|' ||
    coalesce(p_kind,'')       || '|' ||
    coalesce(p_payload::text,'') || '|' ||
    coalesce(to_char(p_occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'') || '|' ||
    coalesce(p_device_id,'')  || '|' ||
    coalesce(p_device_seq::text,''),
    'UTF8'
  );
$$;

-- BEFORE INSERT: set prev_hash from the stream's current head, compute hash.
create or replace function lot_event_set_hash() returns trigger
  language plpgsql
  set search_path = public, extensions
as $$
declare
  head bytea;
begin
  select e.hash into head
    from lot_event e
   where e.stream_key = new.stream_key
   order by e.device_seq desc
   limit 1;
  new.prev_hash := head;  -- NULL for the first event in a stream
  new.hash := extensions.digest(
    coalesce(new.prev_hash, ''::bytea)
      || lot_event_canonical_bytes(new.stream_key, new.kind, new.payload,
                                   new.occurred_at, new.device_id, new.device_seq),
    'sha256'
  );
  return new;
end $$;

create trigger lot_event_set_hash
  before insert on lot_event
  for each row execute function lot_event_set_hash();

-- Immutability: block ALL update/delete, even for the table owner (belt + braces
-- alongside the no-UPDATE/DELETE policy + force RLS below). Named so a test can
-- temporarily disable it to simulate an out-of-band tamper.
create or replace function lot_event_block_mutation() returns trigger
  language plpgsql
as $$
begin
  raise exception 'lot_event is append-only and immutable (% blocked)', tg_op
    using errcode = 'restrict_violation';
end $$;

create trigger lot_event_block_mutation
  before update or delete on lot_event
  for each row execute function lot_event_block_mutation();

-- verify_chain — recompute the chain from stored payloads; return false on any
-- drift. NOTE (finding #2): this proves INTERNAL CONSISTENCY only, not
-- authenticity — the chain is self-anchored (no external head pin), so an attacker
-- with raw table-write access can re-forge every hash and this still returns true.
-- It is a corruption detector; the PRIMARY tamper guards are the append-only block
-- trigger + force-RLS + no write grant (writes only via the definer RPCs). The
-- shared hashing util — single owner.
create or replace function verify_chain(stream_key text)
  returns boolean
  language plpgsql
  stable
  security definer
  set search_path = public, extensions
as $$
declare
  r          record;
  expect_prev bytea := null;
  recomputed bytea;
begin
  for r in
    select * from lot_event e
     where e.stream_key = verify_chain.stream_key
     order by e.device_seq
  loop
    -- prev_hash must equal the previous row's recomputed hash (NULL for the first)
    if r.prev_hash is distinct from expect_prev then
      return false;
    end if;
    recomputed := extensions.digest(
      coalesce(r.prev_hash, ''::bytea)
        || lot_event_canonical_bytes(r.stream_key, r.kind, r.payload,
                                     r.occurred_at, r.device_id, r.device_seq),
      'sha256'
    );
    if recomputed is distinct from r.hash then
      return false;     -- stored hash doesn't match its inputs => tampered
    end if;
    expect_prev := recomputed;
  end loop;
  return true;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 7. Command RPCs (ADR-002) — SECURITY DEFINER, pinned search_path, mutate the
--    domain row AND append the event in ONE transaction, EXECUTE to authenticated.
--    Idempotency is structural: ON CONFLICT (idempotency_key) DO NOTHING (D4).
-- ──────────────────────────────────────────────────────────────────────────

-- record_lot_event — the generic append. Exactly-once on idempotency_key.
create or replace function record_lot_event(
  p_stream_key      text,
  p_kind            text,
  p_payload         jsonb,
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
  existing uuid;
  new_uid  uuid;
begin
  select event_uid into existing from lot_event where idempotency_key = p_idempotency_key;
  if existing is not null then
    return existing;                       -- exactly-once replay
  end if;
  insert into lot_event (idempotency_key, stream_key, kind, payload,
                         occurred_at, device_id, device_seq)
  values (p_idempotency_key, p_stream_key, p_kind, coalesce(p_payload,'{}'::jsonb),
          p_occurred_at, p_device_id, p_device_seq)
  on conflict (idempotency_key) do nothing
  returning event_uid into new_uid;
  if new_uid is null then
    -- lost a concurrent race on the same key — return the winner's uid
    select event_uid into new_uid from lot_event where idempotency_key = p_idempotency_key;
  end if;
  return new_uid;
end $$;

-- record_cherry_intake — the canonical, gap-free monotonic JC-NNN minter. Mints a
-- lot, sets its mass/stage, and appends the intake event, all in one txn.
-- Exactly-once on idempotency_key: a replay returns the originally minted code and
-- creates NO second lot and NO second event.
create or replace function record_cherry_intake(
  p_plot_id         text,
  p_worker_id       text,
  p_cherries_kg     numeric,
  p_variety         coffee_variety,
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
  existing_code text;
  new_code      text;
begin
  -- exactly-once: if this intake was already recorded, return its minted lot code.
  select (payload->>'lot_code') into existing_code
    from lot_event
   where idempotency_key = p_idempotency_key and kind = 'cherry_intake';
  if existing_code is not null then
    return existing_code;
  end if;

  new_code := 'JC-' || lpad(nextval('lot_code_seq')::text, 3, '0');

  insert into lots (code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
  values (new_code, 'cherry', p_variety, p_cherries_kg, p_cherries_kg, true, p_occurred_at);

  perform record_lot_event(
    new_code,                               -- stream per lot
    'cherry_intake',
    jsonb_build_object(
      'lot_code', new_code, 'plot_id', p_plot_id, 'worker_id', p_worker_id,
      'cherries_kg', p_cherries_kg, 'variety', p_variety
    ),
    p_occurred_at, p_device_id, p_device_seq, p_idempotency_key
  );

  return new_code;
end $$;

-- advance_processing_stage — moves a lot to its next stage and appends the event.
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
  already text;
begin
  select (payload->>'lot_code') into already
    from lot_event
   where idempotency_key = p_idempotency_key and kind = 'stage_advance';
  if already is not null then
    return already;
  end if;

  update lots
     set stage = p_to_stage,
         current_kg = coalesce(p_current_kg, current_kg)
   where code = p_lot_code;
  if not found then
    raise exception 'unknown lot %', p_lot_code using errcode = 'foreign_key_violation';
  end if;

  perform record_lot_event(
    p_lot_code, 'stage_advance',
    jsonb_build_object('lot_code', p_lot_code, 'to_stage', p_to_stage, 'current_kg', p_current_kg),
    p_occurred_at, p_device_id, p_device_seq, p_idempotency_key
  );
  return p_lot_code;
end $$;

-- _seed_activity_event — a definer helper to seed the activity feed as lot_event
-- rows (used by seed.sql and the parity test). It writes one 'activity.<kind>'
-- event whose payload carries the original feed id/kind/text. Idempotent per id.
create or replace function _seed_activity_event(
  p_id text, p_at date, p_kind activity_kind, p_text text
) returns uuid
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
begin
  return record_lot_event(
    'activity',
    'activity.' || p_kind::text,
    jsonb_build_object('id', p_id, 'at', p_at::text, 'kind', p_kind::text, 'text', p_text),
    (p_at::timestamptz),
    'seed',
    -- a deterministic per-row device_seq from the act-NN id so (device_id,device_seq)
    -- stays unique and the chain order is stable.
    (regexp_replace(p_id, '\D', '', 'g'))::bigint,
    'seed-activity-' || p_id
  );
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 8. activity — convert the hand-authored table into a security_invoker VIEW over
--    lot_event, preserving the EXACT (id, at, kind, text) columns the frozen
--    getActivity()/mapActivity read (ADR-001 first projection). Dropping the table
--    also drops its RLS policy; the view inherits base-table RLS via invoker.
-- ──────────────────────────────────────────────────────────────────────────
drop table if exists activity cascade;

create view activity with (security_invoker = on) as
  select payload->>'id'                       as id,
         (payload->>'at')::date               as at,
         (payload->>'kind')::activity_kind    as kind,
         payload->>'text'                     as text
  from lot_event
  where stream_key = 'activity';

-- ──────────────────────────────────────────────────────────────────────────
-- 9. RLS — authenticated-only read on the new tables (mirrors auth_required_rls).
--    lot_event additionally `force`s RLS so even the owner is governed, and gets
--    NO update/delete policy (immutability at the policy layer too — ADR-001).
-- ──────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['units','lot_edges','lot_event','lot_yield_curve']
  loop
    execute format('alter table %I enable row level security;', t);
    execute format($p$create policy "authenticated read" on %I for select to authenticated using (true);$p$, t);
  end loop;
end $$;

alter table lot_event force row level security;   -- even the owner reads via policy; no write policy exists

-- ──────────────────────────────────────────────────────────────────────────
-- 10. GRANTS (AD-8) — explicit SELECT on every new table/view; explicit EXECUTE on
--     every definer RPC; NO write table grants (writes go through the RPCs only).
-- ──────────────────────────────────────────────────────────────────────────
-- Per-object SELECT grants (one statement per object so the AD-8 static guard can
-- match each created table/view by name — a blanket multi-table grant reads as a
-- grant on only the first table to its name-anchored regex).
grant select on units           to authenticated;
grant select on lot_edges       to authenticated;
grant select on lot_event       to authenticated;
grant select on lot_yield_curve to authenticated;
grant select on activity        to authenticated;

-- CRITICAL (finding #1): Postgres grants EXECUTE to PUBLIC on every newly created
-- function by default, so the unauthenticated `anon` REST key could mint lots and
-- forge events via the SECURITY DEFINER RPCs (which run as the table owner and
-- bypass RLS) — defeating the entire ADR-002 / AD-8 "authenticated-only, RPC-only
-- write" posture. EVERY function below MUST first `revoke execute ... from public`,
-- then grant ONLY to the intended role (fail-closed, per AD-8). Internal/seed
-- helpers (lot_event_*, lot_edges_*, lots_*, _seed_activity_event) get NO grant —
-- they run only as the owner (triggers / seed.sql), never from the REST API.

-- 10a. Slam every function's PUBLIC EXECUTE shut (callable RPCs + every helper).
revoke execute on function convert_qty(numeric, text, text)                              from public;
revoke execute on function verify_chain(text)                                            from public;
revoke execute on function record_lot_event(text, text, jsonb, timestamptz, text, bigint, text) from public;
revoke execute on function record_cherry_intake(text, text, numeric, coffee_variety, timestamptz, text, bigint, text) from public;
revoke execute on function advance_processing_stage(text, text, numeric, timestamptz, text, bigint, text) from public;
revoke execute on function _seed_activity_event(text, date, activity_kind, text)         from public;
revoke execute on function lot_event_canonical_bytes(text, text, jsonb, timestamptz, text, bigint) from public;
revoke execute on function lot_event_set_hash()                                          from public;
revoke execute on function lot_event_block_mutation()                                    from public;
revoke execute on function lot_edges_conserve_mass()                                     from public;
revoke execute on function lots_conserve_mass_on_lower()                                 from public;

-- 10b. Grant EXECUTE ONLY to authenticated on the caller-facing RPCs. The seed
-- helper `_seed_activity_event` is deliberately NOT granted — it is an owner/seed
-- door; a signed-in user must never be able to forge activity-feed rows.
grant execute on function convert_qty(numeric, text, text)                              to authenticated;
grant execute on function verify_chain(text)                                            to authenticated;
grant execute on function record_lot_event(text, text, jsonb, timestamptz, text, bigint, text) to authenticated;
grant execute on function record_cherry_intake(text, text, numeric, coffee_variety, timestamptz, text, bigint, text) to authenticated;
grant execute on function advance_processing_stage(text, text, numeric, timestamptz, text, bigint, text) to authenticated;

commit;
