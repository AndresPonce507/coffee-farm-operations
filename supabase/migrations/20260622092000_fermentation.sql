-- P2-S3 — Fermentation & wet-mill tracker (MAKE-QUALITY TRUNK).
--
-- Extends the Phase-1 processing spine (processing_batches / advance_processing_stage
-- / lot_event) with the make-quality loop: a versioned altitude-tuned recipe library,
-- ferment-batch tracking bound to a lot_code + a recipe VERSION, a live append-only
-- pH/temp/Brix reading series, a predicted cut-point, and an eco-mill water-per-kg log.
--
-- SCHEMA-TRUTH (matches the SHIPPED phase-1 posture — NOT the design doc's
-- app.apply_farm_rls/farm_id, which do NOT exist on disk): the real spine uses simple
-- authenticated-only RLS (the "authenticated read" policy mirrored from S3/S5) and the
-- single owner writes via SECURITY DEFINER RPCs. NO farm_id / multi-tenant scoping is
-- introduced here (that is a later slice). This migration mirrors EXACTLY how the
-- phase-1 migrations do RLS + grants.
--
-- WRITE DOOR (ADR-002): every write mutates the domain row AND appends a `lot_event`
-- (the existing hash-chained, immutable ledger — stream_key = the lot code) in ONE
-- SECURITY DEFINER transaction with `set search_path = public, extensions`, idempotent
-- on `idempotency_key` via the existing record_lot_event RPC. The append-only readings
-- / water ledgers carry the same device_id/device_seq causal-ordering + dual clocks
-- the lot_event schema reserved, so every reading is offline-replayable (P2-S0).
--
-- GRANTS (AD-8): grant_hygiene locked default privileges, so EVERY new table/view gets
-- an explicit `grant select ... to authenticated`; EVERY caller-facing SECURITY DEFINER
-- RPC FIRST `revoke execute ... from public` (the PUBLIC-execute default is the exact
-- hole that let anon mint lots in S3) THEN `grant execute ... to authenticated`. The
-- domain tables get NO write grant (RPC-only). Nothing is ever granted to anon.

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. ferment_recipes — the versioned, altitude-tuned recipe library.
--    APPEND-ONLY VERSIONED: a recipe is NEVER edited in place; a new version is a
--    new row and the old row's `superseded_by` is pointed at it (the same reversing-
--    supersede discipline as cost_entry). The target curve fields are IMMUTABLE once
--    the row exists (a block trigger below) so a batch's recorded curve stays forever
--    comparable to its own target — only the supersede pointer may change.
-- ──────────────────────────────────────────────────────────────────────────
create table ferment_recipes (
  id               text           primary key,           -- e.g. 'rec-geisha-anaerobic-v1'
  name             text           not null,
  method           process_method not null,              -- reuses the Phase-1 enum
  altitude_band    text           not null,              -- e.g. '1500-1700' (masl band)
  target_ph        numeric        not null check (target_ph > 0 and target_ph <= 14),
  target_temp_c    numeric        not null,
  target_brix_drop numeric        not null check (target_brix_drop >= 0),
  target_hours     numeric        not null check (target_hours > 0),
  version          integer        not null check (version >= 1),
  superseded_by    text           references ferment_recipes(id),
  created_at       timestamptz    not null default now(),
  check (superseded_by is null or superseded_by <> id)   -- a recipe can't supersede itself
);
create index ferment_recipes_supersede_idx on ferment_recipes(superseded_by);

-- IMMUTABLE TARGET CURVE: block any UPDATE that touches a curve/identity field. Only
-- the `superseded_by` pointer (and nothing else) may change after creation — that is
-- how the append-only supersede chain advances without ever rewriting history.
create or replace function ferment_recipes_block_curve_edit() returns trigger
  language plpgsql
as $$
begin
  if new.id              is distinct from old.id
  or new.name            is distinct from old.name
  or new.method          is distinct from old.method
  or new.altitude_band   is distinct from old.altitude_band
  or new.target_ph       is distinct from old.target_ph
  or new.target_temp_c   is distinct from old.target_temp_c
  or new.target_brix_drop is distinct from old.target_brix_drop
  or new.target_hours    is distinct from old.target_hours
  or new.version         is distinct from old.version then
    raise exception
      'ferment_recipes is append-only/versioned: a recipe target is immutable — supersede with a new version row instead'
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

create trigger ferment_recipes_block_curve_edit
  before update on ferment_recipes
  for each row execute function ferment_recipes_block_curve_edit();

-- Seed the first-class versioned recipe library: the altitude-tuned Volcán recipes
-- the family runs day one. These are real first-class assets (a recipe is the SSOT
-- the curve is cut against), seeded here so /ferment has a populated picker on first
-- run. Future recipes supersede these via a new version row (never an in-place edit).
insert into ferment_recipes
  (id, name, method, altitude_band, target_ph, target_temp_c, target_brix_drop, target_hours, version) values
  ('rec-geisha-anaerobic-v1', 'Volcán Geisha — Anaerobic', 'Anaerobic', '1500-1700', 4.2, 20, 4, 36, 1),
  ('rec-geisha-washed-v1',    'Volcán Geisha — Washed',    'Washed',    '1500-1700', 4.5, 21, 3, 24, 1),
  ('rec-caturra-honey-v1',    'Caturra — Honey',           'Honey',     '1360-1500', 4.4, 22, 3, 30, 1),
  ('rec-pacamara-natural-v1', 'Pacamara — Natural',        'Natural',   '1360-1500', 4.3, 23, 5, 48, 1);

-- ──────────────────────────────────────────────────────────────────────────
-- 2. ferment_batches — a ferment RUN, bound to a lots(code) node and the recipe
--    VERSION it ran against (so the live curve is forever comparable to the exact
--    target it was cut to). One open batch per lot is the norm; the id is a uuid so
--    the offline client can mint it (P2-S0), matching the lot_event device pattern.
-- ──────────────────────────────────────────────────────────────────────────
create table ferment_batches (
  id          uuid           primary key default gen_random_uuid(),
  lot_code    text           not null references lots(code),
  recipe_id   text           references ferment_recipes(id),
  method      process_method not null,
  started_at  timestamptz    not null,
  ended_at    timestamptz,                               -- null while the ferment is live
  created_at  timestamptz    not null default now()
);
create index ferment_batches_lot_idx    on ferment_batches(lot_code);
create index ferment_batches_recipe_idx on ferment_batches(recipe_id);

-- ──────────────────────────────────────────────────────────────────────────
-- 3. ferment_readings — the APPEND-ONLY live reading series (pH / temp / Brix).
--    Manual taps now, BLE pH/temp probe later behind the same client port. Carries
--    the lot_event causal-ordering columns so the series is offline-replayable and
--    exactly-once. A reading's batch MUST exist (fail-closed FK). Immutable: no
--    UPDATE/DELETE (a block trigger + no write policy), exactly like lot_event.
-- ──────────────────────────────────────────────────────────────────────────
create table ferment_readings (
  id              bigint generated always as identity primary key,
  batch_id        uuid        not null references ferment_batches(id),
  reading_kind    text        not null check (reading_kind in ('ph','temp','brix')),
  value           numeric     not null,
  occurred_at     timestamptz not null,                  -- field wall-clock (D5)
  recorded_at     timestamptz not null default now(),    -- server accept clock (D5)
  device_id       text        not null,
  device_seq      bigint      not null,
  idempotency_key text        unique,                    -- exactly-once anchor (D4)
  unique (device_id, device_seq)                         -- D4 replay safety
);
create index ferment_readings_batch_idx on ferment_readings(batch_id, occurred_at);
create index ferment_readings_kind_idx  on ferment_readings(reading_kind);

-- Immutability: block ALL update/delete even for the owner (belt + braces alongside
-- the no-write policy below). A ferment curve is evidence — correct only by appending.
create or replace function ferment_readings_block_mutation() returns trigger
  language plpgsql
as $$
begin
  raise exception 'ferment_readings is append-only and immutable (% blocked)', tg_op
    using errcode = 'restrict_violation';
end $$;

create trigger ferment_readings_block_mutation
  before update or delete on ferment_readings
  for each row execute function ferment_readings_block_mutation();

-- ──────────────────────────────────────────────────────────────────────────
-- 4. mill_water_log — the eco-mill water-per-kg ledger. APPEND-ONLY: each row is a
--    water draw against a ferment batch; v_water_per_kg derives the L/kg sustainability
--    number Phase-3/4 carbon & Bird-Friendly dossiers read.
-- ──────────────────────────────────────────────────────────────────────────
create table mill_water_log (
  id              bigint generated always as identity primary key,
  batch_id        uuid        not null references ferment_batches(id),
  liters          numeric     not null check (liters > 0),
  occurred_at     timestamptz not null,
  recorded_at     timestamptz not null default now(),
  device_id       text        not null,
  device_seq      bigint      not null,
  idempotency_key text        unique,
  unique (device_id, device_seq)
);
create index mill_water_log_batch_idx on mill_water_log(batch_id);

create or replace function mill_water_log_block_mutation() returns trigger
  language plpgsql
as $$
begin
  raise exception 'mill_water_log is append-only and immutable (% blocked)', tg_op
    using errcode = 'restrict_violation';
end $$;

create trigger mill_water_log_block_mutation
  before update or delete on mill_water_log
  for each row execute function mill_water_log_block_mutation();

-- ──────────────────────────────────────────────────────────────────────────
-- 5. Command RPCs (ADR-002) — SECURITY DEFINER, pinned search_path, mutate the
--    domain row AND append a lot_event in ONE transaction, EXECUTE to authenticated.
--    Idempotency is structural (the readings/water ledgers dedupe on idempotency_key;
--    batch/recipe RPCs check-then-act). Every RPC accepts the client-minted
--    device_id/device_seq/idempotency_key so it is offline-replayable (P2-S0).
-- ──────────────────────────────────────────────────────────────────────────

-- apply_ferment_recipe — bind (or rebind) a batch to a recipe version. Append-only at
-- the event layer: writes a 'ferment_recipe_applied' lot_event. Idempotent per
-- (batch, recipe): re-applying the same recipe is a no-op.
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
begin
  select lot_code into v_lot from ferment_batches where id = p_batch_id;
  if v_lot is null then
    raise exception 'unknown ferment batch %', p_batch_id using errcode = 'foreign_key_violation';
  end if;
  if not exists (select 1 from ferment_recipes where id = p_recipe_id) then
    raise exception 'unknown recipe %', p_recipe_id using errcode = 'foreign_key_violation';
  end if;

  -- no-op if already bound to this exact recipe (idempotent rebind)
  if exists (select 1 from ferment_batches where id = p_batch_id and recipe_id = p_recipe_id) then
    return p_batch_id;
  end if;

  update ferment_batches set recipe_id = p_recipe_id where id = p_batch_id;

  perform record_lot_event(
    v_lot, 'ferment_recipe_applied',
    jsonb_build_object('batch_id', p_batch_id, 'recipe_id', p_recipe_id),
    now(), 'server-ferment', extract(epoch from clock_timestamp())::bigint,
    'apply-recipe:' || p_batch_id::text || ':' || p_recipe_id
  );
  return p_batch_id;
end $$;

-- start_ferment_batch — open a ferment run on a lot, bound to a recipe version, and
-- append a 'ferment_started' lot_event, all in one txn. Exactly-once on idempotency_key:
-- a replay returns the originally minted batch id and creates NO second batch/event.
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
  existing uuid;
  new_id   uuid;
begin
  -- exactly-once: if this start was already recorded, return its batch id.
  select (payload->>'batch_id')::uuid into existing
    from lot_event
   where idempotency_key = p_idempotency_key and kind = 'ferment_started';
  if existing is not null then
    return existing;
  end if;

  if not exists (select 1 from lots where code = p_lot_code) then
    raise exception 'unknown lot %', p_lot_code using errcode = 'foreign_key_violation';
  end if;
  if p_recipe_id is not null and not exists (select 1 from ferment_recipes where id = p_recipe_id) then
    raise exception 'unknown recipe %', p_recipe_id using errcode = 'foreign_key_violation';
  end if;

  insert into ferment_batches (lot_code, recipe_id, method, started_at)
  values (p_lot_code, p_recipe_id, p_method, p_occurred_at)
  returning id into new_id;

  perform record_lot_event(
    p_lot_code, 'ferment_started',
    jsonb_build_object('batch_id', new_id, 'lot_code', p_lot_code,
                       'recipe_id', p_recipe_id, 'method', p_method),
    p_occurred_at, p_device_id, p_device_seq, p_idempotency_key
  );
  return new_id;
end $$;

-- record_ferment_reading — append one pH/temp/Brix reading to the live series and a
-- 'ferment_reading' lot_event, in one txn. The batch MUST exist (fail-closed FK).
-- Exactly-once on idempotency_key: a replay (e.g. from the offline outbox) is one row.
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
  v_lot      text;
  existing   bigint;
  new_id     bigint;
begin
  -- exactly-once replay short-circuit
  select id into existing from ferment_readings where idempotency_key = p_idempotency_key;
  if existing is not null then
    return existing;
  end if;

  select lot_code into v_lot from ferment_batches where id = p_batch_id;
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
    select id into new_id from ferment_readings where idempotency_key = p_idempotency_key;
    return new_id;
  end if;

  perform record_lot_event(
    v_lot, 'ferment_reading',
    jsonb_build_object('batch_id', p_batch_id, 'kind', p_kind, 'value', p_value),
    p_occurred_at, p_device_id, p_device_seq, 'ferment-reading:' || p_idempotency_key
  );
  return new_id;
end $$;

-- log_mill_water — append one water draw against a ferment batch and a 'mill_water'
-- lot_event, in one txn. Exactly-once on idempotency_key. liters > 0 (CHECK).
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
  select id into existing from mill_water_log where idempotency_key = p_idempotency_key;
  if existing is not null then
    return existing;
  end if;

  select lot_code into v_lot from ferment_batches where id = p_batch_id;
  if v_lot is null then
    raise exception 'unknown ferment batch %', p_batch_id using errcode = 'foreign_key_violation';
  end if;

  insert into mill_water_log
    (batch_id, liters, occurred_at, device_id, device_seq, idempotency_key)
  values (p_batch_id, p_liters, p_occurred_at, p_device_id, p_device_seq, p_idempotency_key)
  on conflict (idempotency_key) do nothing
  returning id into new_id;

  if new_id is null then
    select id into new_id from mill_water_log where idempotency_key = p_idempotency_key;
    return new_id;
  end if;

  perform record_lot_event(
    v_lot, 'mill_water',
    jsonb_build_object('batch_id', p_batch_id, 'liters', p_liters),
    p_occurred_at, p_device_id, p_device_seq, 'mill-water:' || p_idempotency_key
  );
  return new_id;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 6. Read views (security_invoker so base-table RLS is enforced for the caller).
-- ──────────────────────────────────────────────────────────────────────────

-- v_ferment_curve — every reading flattened per batch + lot for the live curve.
create view v_ferment_curve with (security_invoker = on) as
  select b.id          as batch_id,
         b.lot_code,
         r.reading_kind,
         r.value,
         r.occurred_at,
         -- hours since the batch started — the x-axis of the live curve
         (extract(epoch from (r.occurred_at - b.started_at)) / 3600.0)::numeric as hours_elapsed
    from ferment_batches b
    join ferment_readings r on r.batch_id = b.id;

-- v_ferment_cutpoint — the predicted cut-point per batch. v1 (per the spec's de-risk):
-- a SIMPLE target-threshold crossing on pH — the latest pH reading vs the recipe's
-- target_ph. cut_reached fires when the live pH has fallen to/through the target (pH
-- DROPS during a ferment, so ≤ target = the window is closing/closed). The logged
-- readings are the durable asset; a better projection model is Phase-4 ML.
create view v_ferment_cutpoint with (security_invoker = on) as
  select b.id        as batch_id,
         b.lot_code,
         b.recipe_id,
         rec.target_ph,
         rec.target_hours,
         lp.latest_ph,
         lp.latest_at,
         -- hours of ferment elapsed at the latest pH reading
         case when lp.latest_at is not null
              then (extract(epoch from (lp.latest_at - b.started_at)) / 3600.0)::numeric
              else null end                                        as hours_elapsed,
         -- the cut signal: a recipe + a pH reading at/below target => cut the ferment.
         (rec.target_ph is not null and lp.latest_ph is not null
            and lp.latest_ph <= rec.target_ph)                     as cut_reached
    from ferment_batches b
    left join ferment_recipes rec on rec.id = b.recipe_id
    left join lateral (
      select r.value as latest_ph, r.occurred_at as latest_at
        from ferment_readings r
       where r.batch_id = b.id and r.reading_kind = 'ph'
       order by r.occurred_at desc, r.id desc
       limit 1
    ) lp on true;

-- v_water_per_kg — the eco-mill sustainability number: Σ liters over a lot's mass.
create view v_water_per_kg with (security_invoker = on) as
  select b.lot_code,
         coalesce(l.current_kg, l.origin_kg, 0)::numeric          as lot_kg,
         coalesce(sum(w.liters), 0)::numeric                      as total_liters,
         case when coalesce(l.current_kg, l.origin_kg, 0) > 0
              then (coalesce(sum(w.liters), 0) / coalesce(l.current_kg, l.origin_kg))::numeric
              else null end                                        as liters_per_kg
    from ferment_batches b
    join lots l            on l.code = b.lot_code
    left join mill_water_log w on w.batch_id = b.id
   group by b.lot_code, l.current_kg, l.origin_kg;

-- ──────────────────────────────────────────────────────────────────────────
-- 7. RLS — authenticated-only read on the new tables (mirrors the S3/S5 posture).
--    Writes go via the RPCs (never UPDATE/DELETE); the readings/water ledgers are
--    append-only with the block triggers above and NO write policy at all.
-- ──────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['ferment_recipes','ferment_batches','ferment_readings','mill_water_log']
  loop
    execute format('alter table %I enable row level security;', t);
    execute format($p$create policy "authenticated read" on %I for select to authenticated using (true);$p$, t);
  end loop;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 8. GRANTS (AD-8) — explicit SELECT on every new table/view; NO write table grants
--    (RPC-only); each definer RPC slams PUBLIC EXECUTE shut then grants only to
--    authenticated. Nothing to anon. One statement per object so the AD-8 static
--    guard's name-anchored regex matches each created object individually.
-- ──────────────────────────────────────────────────────────────────────────
grant select on ferment_recipes    to authenticated;
grant select on ferment_batches     to authenticated;
grant select on ferment_readings    to authenticated;
grant select on mill_water_log      to authenticated;
grant select on v_ferment_curve     to authenticated;
grant select on v_ferment_cutpoint  to authenticated;
grant select on v_water_per_kg      to authenticated;

-- CRITICAL (the S3 lesson): Postgres grants EXECUTE to PUBLIC on every new function by
-- default, and a SECURITY DEFINER fn runs as the table owner (bypassing RLS) — so a
-- leftover PUBLIC grant would let the unauthenticated anon key forge ferment data.
-- Slam PUBLIC shut FIRST on every fn (callable RPCs + the trigger helpers), then grant
-- ONLY the caller-facing RPCs to authenticated. Trigger fns get NO grant.
revoke execute on function apply_ferment_recipe(uuid, text)                                              from public;
revoke execute on function start_ferment_batch(text, text, process_method, timestamptz, text, bigint, text) from public;
revoke execute on function record_ferment_reading(uuid, text, numeric, timestamptz, text, bigint, text)  from public;
revoke execute on function log_mill_water(uuid, numeric, timestamptz, text, bigint, text)                from public;
revoke execute on function ferment_recipes_block_curve_edit()                                            from public;
revoke execute on function ferment_readings_block_mutation()                                             from public;
revoke execute on function mill_water_log_block_mutation()                                               from public;

grant execute on function apply_ferment_recipe(uuid, text)                                              to authenticated;
grant execute on function start_ferment_batch(text, text, process_method, timestamptz, text, bigint, text) to authenticated;
grant execute on function record_ferment_reading(uuid, text, numeric, timestamptz, text, bigint, text)  to authenticated;
grant execute on function log_mill_water(uuid, numeric, timestamptz, text, bigint, text)                to authenticated;

commit;
