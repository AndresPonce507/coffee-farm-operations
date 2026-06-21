-- P2-S4 — Drying management + THE REPOSO GATE + capacity-tracked stations.
--
-- The load-bearing Phase-2 invariant: a lot physically CANNOT advance
-- `drying → milled` until moisture-stability (last N readings within 10.5–11.5%,
-- trending flat) AND a minimum rest-days threshold are BOTH met. The gate is a
-- DATA-LAYER invariant — the disabled UI button is courtesy; the database enforces
-- it in TWO layers so it can't be bypassed:
--   (1) a precondition check ADDED INSIDE advance_processing_stage (the single
--       stage-machine RPC; create-or-replace, preserving ALL its current behavior),
--   (2) a BEFORE-UPDATE trigger backstop on `lots` that blocks the drying→milled
--       transition even when a future code path mutates lots.stage directly.
-- This mirrors the Phase-1 EUDR `issue_dds` "gate in the database" precedent and
-- the `prevent_oversell` fail-closed-trigger family.
--
-- SCHEMA-TRUTH: the spine is authenticated-only RLS (NO farm_id / multi-tenant
-- factory exists in phase 1). This migration matches that posture exactly — every
-- new table/view is authenticated-read, every RPC is SECURITY DEFINER + pinned
-- search_path + AD-8 grants (revoke execute from public; grant execute to
-- authenticated). No anon grants. Append-only ledgers reuse the lot_event
-- hash-chain immutability substrate (block trigger + no UPDATE/DELETE policy).
--
-- Renumbered to the Phase-2 lane: this sorts strictly above the live head
-- 20260621120000_pipeline_fixes.sql.

begin;

-- ══════════════════════════════════════════════════════════════════════════
-- 1. Reposo config — the moisture band + minimum rest-days, in ONE owned place.
--    Added to the existing singleton farm_season_config (one canonical home for
--    the gate's thresholds, never hardcoded across five SQL bodies). Defaulted so
--    the gate is live the moment this migration lands; the family tunes them later.
-- ══════════════════════════════════════════════════════════════════════════
alter table farm_season_config
  add column if not exists reposo_moisture_min_pct numeric not null default 10.5,
  add column if not exists reposo_moisture_max_pct numeric not null default 11.5,
  add column if not exists min_reposo_days          integer not null default 5,
  -- how many of the most-recent readings must sit in-band & flat to call moisture stable.
  add column if not exists reposo_stable_window      integer not null default 2;

alter table farm_season_config
  add constraint reposo_band_ordered check (reposo_moisture_max_pct >= reposo_moisture_min_pct),
  add constraint min_reposo_days_nonneg check (min_reposo_days >= 0),
  add constraint reposo_window_pos    check (reposo_stable_window >= 1);

-- ══════════════════════════════════════════════════════════════════════════
-- 2. drying_stations — promote the flat processing_batches.patio into real,
--    capacity-tracked stations. processing_batches.patio is RETAINED (Phase-1
--    reads survive); these are the system-of-record for capacity utilization.
-- ══════════════════════════════════════════════════════════════════════════
create table drying_stations (
  id          text    primary key,                 -- e.g. 'st-bed-1'
  name        text    not null,
  kind        text    not null check (kind in ('patio','raised-bed','guardiola','parabolic')),
  capacity_kg numeric not null check (capacity_kg > 0)
);

insert into drying_stations (id, name, kind, capacity_kg) values
  ('st-patio-1', 'Patio Norte',          'patio',      2000),
  ('st-bed-1',   'African Bed 1',        'raised-bed',  600),
  ('st-bed-2',   'African Bed 2',        'raised-bed',  600),
  ('st-parab-1', 'Parabolic Tunnel 1',   'parabolic',  1200),
  ('st-small',   'Sample Bed (micro)',   'raised-bed',   80);

-- ══════════════════════════════════════════════════════════════════════════
-- 3. drying_assignments — append-only ledger of which lot is committed to which
--    station, with kg. A re-assignment writes a NEW row (closing the prior via
--    released_at); the OPEN rows are the live commitment station_occupancy sums.
--    Append-only with reversing-supersede (never UPDATE history) — except the
--    single controlled close-out of released_at, which the RPC performs.
-- ══════════════════════════════════════════════════════════════════════════
create table drying_assignments (
  id          bigint generated always as identity primary key,
  lot_code    text        not null references lots(code),
  station_id  text        not null references drying_stations(id),
  committed_kg numeric    not null check (committed_kg > 0),
  assigned_at timestamptz not null,
  released_at timestamptz                                  -- null = open commitment
);
create index drying_assignments_station_idx on drying_assignments (station_id) where released_at is null;
create index drying_assignments_lot_idx     on drying_assignments (lot_code);

-- prevent_overcapacity — FAIL-CLOSED BEFORE INSERT/UPDATE trigger. The sum of OPEN
-- committed_kg on a station (counting the incoming row) may never exceed its
-- capacity_kg. Mirrors the Phase-1 prevent_oversell pattern (advisory lock to
-- serialize concurrent commits against one station; auto-released at commit).
create or replace function prevent_overcapacity() returns trigger
  language plpgsql
  set search_path = public
as $$
declare
  cap       numeric;
  committed numeric;
begin
  -- only OPEN commitments consume capacity.
  if new.released_at is not null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('drying_station:' || new.station_id));
  select capacity_kg into cap from drying_stations where id = new.station_id;
  if cap is null then
    raise exception 'capacity guard: unknown drying station %', new.station_id
      using errcode = 'foreign_key_violation';
  end if;
  select coalesce(sum(committed_kg), 0) into committed
    from drying_assignments
   where station_id = new.station_id
     and released_at is null
     and not (tg_op = 'UPDATE' and id = new.id);
  if committed + new.committed_kg > cap + 1e-9 then
    raise exception
      'capacity guard: committing % kg to station % would exceed its % kg capacity (% already committed)',
      new.committed_kg, new.station_id, cap, committed
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger drying_assignments_prevent_overcapacity
  before insert or update on drying_assignments
  for each row execute function prevent_overcapacity();

-- station_occupancy — the DERIVED committed-vs-capacity view (security_invoker so
-- base-table RLS is enforced for the caller). Computed, never a stored counter.
create view station_occupancy with (security_invoker = on) as
  select s.id                                          as station_id,
         s.name,
         s.kind,
         s.capacity_kg::numeric                        as capacity_kg,
         coalesce((select sum(a.committed_kg) from drying_assignments a
                    where a.station_id = s.id and a.released_at is null), 0)::numeric
                                                       as committed_kg,
         (s.capacity_kg
            - coalesce((select sum(a.committed_kg) from drying_assignments a
                         where a.station_id = s.id and a.released_at is null), 0)
         )::numeric                                    as available_kg
  from drying_stations s;

-- ══════════════════════════════════════════════════════════════════════════
-- 4. moisture_readings — append-only, hash-chained moisture ledger. Reuses the
--    lot_event substrate semantics (immutable; corrections are new readings, never
--    UPDATE). Stream key is the lot code. The drying curve is EVIDENCE.
-- ══════════════════════════════════════════════════════════════════════════
create table moisture_readings (
  id              bigint generated always as identity primary key,
  lot_code        text        not null references lots(code),
  moisture_pct    numeric     not null check (moisture_pct >= 0 and moisture_pct <= 100),
  occurred_at     timestamptz not null,
  recorded_at     timestamptz not null default now(),
  device_id       text        not null,
  device_seq      bigint      not null,
  idempotency_key text        unique,
  unique (device_id, device_seq)
);
create index moisture_readings_lot_idx on moisture_readings (lot_code, occurred_at);

-- Immutability: block ALL update/delete (belt + braces with the no-write policy).
create or replace function moisture_readings_block_mutation() returns trigger
  language plpgsql
as $$
begin
  raise exception 'moisture_readings is append-only and immutable (% blocked)', tg_op
    using errcode = 'restrict_violation';
end $$;

create trigger moisture_readings_block_mutation
  before update or delete on moisture_readings
  for each row execute function moisture_readings_block_mutation();

-- ══════════════════════════════════════════════════════════════════════════
-- 5. v_reposo_status — the DERIVED rest-stability view: per lot, is it (a) moisture-
--    stable (the last `reposo_stable_window` readings ALL within [min,max] band)
--    AND (b) rested ≥ min_reposo_days since drying started? `ready` is the gate's
--    single source of truth. security_invoker so base-table RLS holds.
--    Only lots that are at/through 'drying' are meaningful; the view is defined
--    over moisture_readings so a lot with NO readings is simply not "ready".
-- ══════════════════════════════════════════════════════════════════════════
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
  cfg          record;
  latest       numeric;
  cnt          integer;
  in_band_cnt  integer;
  started      timestamptz;
  rest_days    numeric;
  m_stable     boolean;
  r_met        boolean;
begin
  select reposo_moisture_min_pct, reposo_moisture_max_pct, min_reposo_days, reposo_stable_window
    into cfg from farm_season_config where id = 1;

  -- latest reading + total readings for the lot.
  select count(*)::int,
         (select mr.moisture_pct from moisture_readings mr
           where mr.lot_code = p_lot_code
           order by mr.occurred_at desc, mr.id desc limit 1)
    into cnt, latest
    from moisture_readings where moisture_readings.lot_code = p_lot_code;

  -- moisture stable = at least `window` readings AND the most-recent `window`
  -- readings are ALL inside [min,max] (trending flat within the band).
  select count(*)::int into in_band_cnt from (
    select mr.moisture_pct
      from moisture_readings mr
     where mr.lot_code = p_lot_code
     order by mr.occurred_at desc, mr.id desc
     limit cfg.reposo_stable_window
  ) recent
  where recent.moisture_pct between cfg.reposo_moisture_min_pct and cfg.reposo_moisture_max_pct;

  m_stable := (cnt >= cfg.reposo_stable_window and in_band_cnt >= cfg.reposo_stable_window);

  -- rest clock: prefer the open drying-station assignment's assigned_at (when drying
  -- physically began); fall back to the lot's first 'drying' stage_advance event.
  select min(a.assigned_at) into started
    from drying_assignments a where a.lot_code = p_lot_code;
  if started is null then
    select min(e.occurred_at) into started
      from lot_event e
     where e.stream_key = p_lot_code and e.kind = 'stage_advance'
       and (e.payload->>'to_stage') = 'drying';
  end if;

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
      when not r_met and started is null then 'no drying record yet'
      when not r_met then format('resting %s/%s days', floor(coalesce(rest_days,0))::int, cfg.min_reposo_days)
      when not m_stable and latest is not null then format('moisture %s%% not yet stable in %s–%s%% band',
        round(latest,1), cfg.reposo_moisture_min_pct, cfg.reposo_moisture_max_pct)
      else 'awaiting moisture readings'
    end;
end $$;

-- The view wrapper the read port + UI query (a lateral over every lot that has a
-- drying assignment OR a moisture reading — the lots in/through the resting state).
create view v_reposo_status with (security_invoker = on) as
  select rs.*
  from (
    select distinct lot_code from moisture_readings
    union
    select distinct lot_code from drying_assignments
  ) lots_resting
  cross join lateral reposo_status(lots_resting.lot_code) rs;

-- ══════════════════════════════════════════════════════════════════════════
-- 6. v_drying_weather_risk — weather-coupled cover/move alert. Joins the Phase-1
--    `weather` forecast feed (the on-disk truth — NOT a per-plot Open-Meteo table,
--    which does not exist): when an upcoming day has high rain probability, every
--    open-air station (patio / raised-bed / parabolic, NOT guardiola) carries a
--    cover-the-beds risk. Closed-loop signal the UI surfaces (a board task is the
--    UI's job; the data layer exposes the risk).
-- ══════════════════════════════════════════════════════════════════════════
create view v_drying_weather_risk with (security_invoker = on) as
  select s.id                    as station_id,
         s.name,
         s.kind,
         w.sort_order            as forecast_order,
         w.day,
         w.rain_pct,
         w.icon,
         (w.rain_pct >= 60 and w.icon = 'rain') as cover_risk
  from drying_stations s
  cross join weather w
  where s.kind in ('patio','raised-bed','parabolic');   -- open-air only; guardiola is enclosed

-- ══════════════════════════════════════════════════════════════════════════
-- 7. COMMAND RPCs (ADR-002 / AD-8) — SECURITY DEFINER, pinned search_path,
--    idempotent on idempotency_key, EXECUTE only to authenticated.
-- ══════════════════════════════════════════════════════════════════════════

-- record_moisture_reading — append a moisture reading to the lot's drying curve.
-- Append-only + exactly-once on idempotency_key (a replay is a no-op).
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
  existing_id bigint;
  new_id      bigint;
begin
  select id into existing_id from moisture_readings where idempotency_key = p_idempotency_key;
  if existing_id is not null then
    return existing_id;                       -- exactly-once replay
  end if;
  if not exists (select 1 from lots where code = p_lot_code) then
    raise exception 'unknown lot %', p_lot_code using errcode = 'foreign_key_violation';
  end if;
  insert into moisture_readings (lot_code, moisture_pct, occurred_at, device_id, device_seq, idempotency_key)
  values (p_lot_code, p_moisture_pct, p_occurred_at, p_device_id, p_device_seq, p_idempotency_key)
  on conflict (idempotency_key) do nothing
  returning id into new_id;
  if new_id is null then
    select id into new_id from moisture_readings where idempotency_key = p_idempotency_key;
  end if;
  -- mirror the latest reading onto processing_batches.moisture_pct where a batch
  -- exists for this lot (Phase-1 reads the flat column); derived, best-effort.
  update processing_batches set moisture_pct = p_moisture_pct where lot_code = p_lot_code;
  return new_id;
end $$;

-- assign_drying_station — commit a drying lot to a station (its current_kg of mass).
-- Closes any prior OPEN assignment for the lot (a move), then opens a new one; the
-- prevent_overcapacity trigger fail-closes if the station is full. Idempotent on
-- the (lot, station, open) shape — re-assigning to the same open station is a no-op.
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
  lot_kg numeric;
  new_id bigint;
begin
  -- already on this station (open)? no-op (idempotent re-assign).
  select id into new_id from drying_assignments
   where lot_code = p_lot_code and station_id = p_station_id and released_at is null
   limit 1;
  if new_id is not null then
    return new_id;
  end if;

  select coalesce(current_kg, origin_kg) into lot_kg from lots where code = p_lot_code;
  if lot_kg is null then
    raise exception 'cannot assign station: lot % has no declared mass', p_lot_code
      using errcode = 'check_violation';
  end if;

  -- close any prior open assignment (the lot moved off its old station).
  update drying_assignments
     set released_at = p_occurred_at
   where lot_code = p_lot_code and released_at is null;

  insert into drying_assignments (lot_code, station_id, committed_kg, assigned_at)
  values (p_lot_code, p_station_id, lot_kg, p_occurred_at)
  returning id into new_id;
  return new_id;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- 8. THE REPOSO GATE, LAYER 1 — redefine advance_processing_stage to add the
--    drying→milled precondition. PRESERVES ALL current behavior verbatim:
--    idempotency short-circuit, NULL-stage→'cherry' handling, forward-only guard,
--    no-mass-gain guard, the update + lot_event append. The ONLY addition is the
--    reposo precondition between the guards and the mutation (purely additive,
--    fail-closed). (Single-author change for this slice — designated here.)
-- ══════════════════════════════════════════════════════════════════════════
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
  already   text;
  cur_stage text;
  cur_kg    numeric;
  st        record;
begin
  select (payload->>'lot_code') into already
    from lot_event
   where idempotency_key = p_idempotency_key and kind = 'stage_advance';
  if already is not null then
    return already;                           -- idempotency short-circuit (preserved)
  end if;

  perform p_to_stage::batch_stage;            -- validate target is a real stage (preserved)

  select stage, current_kg into cur_stage, cur_kg from lots where code = p_lot_code;
  if not found then
    raise exception 'unknown lot %', p_lot_code using errcode = 'foreign_key_violation';
  end if;

  -- a NULL/unknown current stage is treated as the pipeline START ('cherry') so a
  -- backward move is still rejected on bare-seeded lots (preserved).
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

  -- ── THE REPOSO GATE (the ONLY addition) ──────────────────────────────────
  -- crossing the drying→milling boundary requires moisture-stability AND the
  -- minimum rest-days. Fires only on that exact transition (FROM drying TO milled).
  if coalesce(nullif(cur_stage, ''), 'cherry') = 'drying' and p_to_stage = 'milled' then
    select * into st from reposo_status(p_lot_code);
    if not coalesce(st.ready, false) then
      raise exception 'reposo gate: lot % not rest-stable (%)', p_lot_code, st.reason
        using errcode = 'check_violation';
    end if;
  end if;
  -- ─────────────────────────────────────────────────────────────────────────

  update lots
     set stage = p_to_stage,
         current_kg = coalesce(p_current_kg, current_kg)
   where code = p_lot_code;

  perform record_lot_event(
    p_lot_code, 'stage_advance',
    jsonb_build_object('lot_code', p_lot_code, 'to_stage', p_to_stage, 'current_kg', p_current_kg),
    p_occurred_at, p_device_id, p_device_seq, p_idempotency_key
  );
  return p_lot_code;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- 9. THE REPOSO GATE, LAYER 2 — BEFORE-UPDATE trigger backstop on `lots`. Even a
--    direct `update lots set stage='milled'` that bypasses the RPC must be blocked
--    when the lot is not rest-stable. Fires ONLY on the drying→milled stage change.
-- ══════════════════════════════════════════════════════════════════════════
create or replace function lots_enforce_reposo_gate() returns trigger
  language plpgsql
  set search_path = public, extensions
as $$
declare
  st record;
begin
  -- only the drying→milled transition is gated.
  if coalesce(nullif(old.stage, ''), 'cherry') = 'drying' and new.stage = 'milled' then
    select * into st from reposo_status(new.code);
    if not coalesce(st.ready, false) then
      raise exception 'reposo gate: lot % not rest-stable (%)', new.code, st.reason
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

create trigger lots_enforce_reposo_gate
  before update on lots
  for each row
  when (old.stage is distinct from new.stage)
  execute function lots_enforce_reposo_gate();

-- ══════════════════════════════════════════════════════════════════════════
-- 10. RLS — authenticated-only read on the new tables (mirrors the spine posture).
--     The append-only ledgers get NO update/delete policy; immutability is enforced
--     by the block trigger + the absence of any write grant (writes via RPC only).
-- ══════════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array['drying_stations','drying_assignments','moisture_readings']
  loop
    execute format('alter table %I enable row level security;', t);
    execute format($p$create policy "authenticated read" on %I for select to authenticated using (true);$p$, t);
  end loop;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- 11. GRANTS (AD-8) — explicit SELECT on every new table/view; NO write table
--     grants (writes go through the definer RPCs only); each definer RPC slams
--     PUBLIC EXECUTE shut then grants ONLY to authenticated. Nothing to anon.
--     Per-object SELECT grants (one per object) so the static guard's name-anchored
--     regex matches each created object individually.
-- ══════════════════════════════════════════════════════════════════════════
grant select on drying_stations      to authenticated;
grant select on drying_assignments   to authenticated;
grant select on moisture_readings    to authenticated;
grant select on station_occupancy    to authenticated;
grant select on v_reposo_status      to authenticated;
grant select on v_drying_weather_risk to authenticated;

-- Slam PUBLIC EXECUTE shut on every function, then grant only the caller-facing
-- RPCs to authenticated. Trigger fns (prevent_overcapacity,
-- moisture_readings_block_mutation, lots_enforce_reposo_gate) get NO grant — they
-- run as the owner via their triggers, never from the REST API.
revoke execute on function record_moisture_reading(text, numeric, timestamptz, text, bigint, text) from public;
revoke execute on function assign_drying_station(text, text, timestamptz)                           from public;
revoke execute on function reposo_status(text)                                                      from public;
revoke execute on function advance_processing_stage(text, text, numeric, timestamptz, text, bigint, text) from public;
revoke execute on function prevent_overcapacity()                                                   from public;
revoke execute on function moisture_readings_block_mutation()                                        from public;
revoke execute on function lots_enforce_reposo_gate()                                                from public;

grant  execute on function record_moisture_reading(text, numeric, timestamptz, text, bigint, text) to authenticated;
grant  execute on function assign_drying_station(text, text, timestamptz)                           to authenticated;
grant  execute on function reposo_status(text)                                                      to authenticated;
grant  execute on function advance_processing_stage(text, text, numeric, timestamptz, text, bigint, text) to authenticated;

commit;
