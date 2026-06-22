-- P2-S8 — Ripeness-aware harvest planning & pasada scheduler.
--
-- Closes the loop from the maturation model to the picker's morning: a per-plot
-- ripeness/readiness model (GDD + NDVI-ready inputs; readiness DERIVED, never a
-- typed status) staggers the harvest down the 1,360–1,700 masl altitude gradient
-- (lower plots ripen first); a "pasada" (harvest-pass) schedule entity that
-- re-plans around rain fronts as an APPEND-ONLY/superseded chain; and a command
-- that FIRES a task onto the existing phase-1 `tasks` board.
--
-- ───────────────────────────────────────────────────────────────────────────
-- SCHEMA-TRUTH (matches the on-disk phase-1 posture, NOT the design-doc factory):
--   * The live spine is AUTHENTICATED-ONLY RLS — there is NO `app.apply_farm_rls`
--     factory and NO `farm_id` column anywhere in phase 1. This slice mirrors the
--     real posture: `alter table … enable row level security` + an "authenticated
--     read" policy + an explicit `grant select … to authenticated`. No farm_id /
--     multi-tenant; no anon grants.
--   * The write door is the command RPC (ADR-002): SECURITY DEFINER, pinned
--     `set search_path = public, extensions`, idempotent on idempotency_key,
--     accepting the client-minted device_id/device_seq so every write is
--     offline-replayable through the S0 outbox. NO write table grants are issued.
--   * AD-8 grant hygiene: default privileges are locked, so EVERY new table/view
--     gets an explicit per-object `grant select … to authenticated`, and EVERY
--     function `revoke execute … from public` then `grant execute … to
--     authenticated` (the PUBLIC-execute default is the hole that let anon mint in
--     S3). Internal/trigger helpers get NO grant.
--   * Timestamp 20260622100000 sorts strictly above the live head
--     20260621120000_pipeline_fixes.sql — keep it.
--
-- READINESS IS DERIVED, NEVER TYPED: v_harvest_readiness computes a [0,1] score and
-- a predicted ready date from GDD progress toward the bloom→cherry requirement,
-- nudged by NDVI when present, and staggered by altitude. There is no hand-set
-- "ready" flag anywhere (the phase-1 derived-metrics discipline).
--
-- TASK-FIRING: schedule_pasada inserts ONE row into the EXISTING phase-1 `tasks`
-- table (the real board the /tasks UI reads). tasks.worker_id is NOT NULL, so the
-- assignee is resolved: the plot's most-recent picker → else a Supervisor → else
-- any worker. The category uses a NEW additive enum value 'Harvest' on the
-- existing `task_category` type (an `ALTER TYPE ADD VALUE`, which does NOT alter
-- the `tasks` table structure, its columns, or any constraint — the cleanest
-- semantically-honest category for a harvest-pass task). FLAGGED below.
-- ───────────────────────────────────────────────────────────────────────────

-- ── Additive enum value for the fired harvest-pass task ───────────────────────
-- `ALTER TYPE … ADD VALUE` cannot be used in the SAME transaction that adds it on
-- real Postgres, so it runs here OUTSIDE the begin/commit block (autocommit). It is
-- idempotent (IF NOT EXISTS) and purely additive — it touches the `task_category`
-- enum only, never the `tasks` table itself or `advance_processing_stage`.
-- FLAG: this is the one place the slice extends a shared phase-1 domain type.
alter type task_category add value if not exists 'Harvest';

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. plot_phenology — per-plot maturation MODEL INPUTS (one row per plot).
--    Fed by the phase-1 weather feed (GDD from Open-Meteo temps) and optionally
--    the S12 NDVI ingest. `bloom_date`/`gdd_accumulated`/`ndvi_latest` are the raw
--    signals; readiness itself is NEVER stored here — it is derived downstream.
--    Upserted ONLY by record_maturation_signal (the command door).
-- ──────────────────────────────────────────────────────────────────────────
create table plot_phenology (
  plot_id         text        primary key references plots(id),
  bloom_date      date,                                  -- null until the family logs a bloom
  gdd_accumulated numeric     not null default 0 check (gdd_accumulated >= 0),
  ndvi_latest     numeric              check (ndvi_latest is null or ndvi_latest between 0 and 1),
  gdd_to_cherry   numeric     not null default 2200 check (gdd_to_cherry > 0),  -- variety requirement (calibration flag)
  updated_at      timestamptz not null default now()
);

-- ──────────────────────────────────────────────────────────────────────────
-- 2. maturation_signal — APPEND-ONLY ledger of every signal that moved a plot's
--    phenology. The evidence trail behind the derived readiness (a GDD update, an
--    NDVI observation, a logged bloom). Corrections are NEW rows, never UPDATEs —
--    same immutability discipline as the phase-1 cost_entry / lot_event ledgers.
-- ──────────────────────────────────────────────────────────────────────────
create table maturation_signal (
  id              bigint generated always as identity primary key,
  plot_id         text        not null references plots(id),
  bloom_date      date,
  gdd_accumulated numeric              check (gdd_accumulated is null or gdd_accumulated >= 0),
  ndvi_latest     numeric              check (ndvi_latest is null or ndvi_latest between 0 and 1),
  occurred_at     timestamptz not null,
  recorded_at     timestamptz not null default now(),
  device_id       text        not null,
  device_seq      bigint      not null,
  idempotency_key text        unique,
  unique (device_id, device_seq)
);
create index maturation_signal_plot_idx on maturation_signal (plot_id, recorded_at);

create or replace function maturation_signal_immutable() returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  raise exception
    'maturation_signal is append-only: % is not permitted — record a new signal instead',
    tg_op
    using errcode = 'restrict_violation';
end $$;
create trigger maturation_signal_no_update before update on maturation_signal
  for each row execute function maturation_signal_immutable();
create trigger maturation_signal_no_delete before delete on maturation_signal
  for each row execute function maturation_signal_immutable();

-- ──────────────────────────────────────────────────────────────────────────
-- 3. pasada_schedule — the staggered harvest-pass schedule, APPEND-ONLY/SUPERSEDED.
--    Re-planning around a rain front writes a NEW row and marks the prior one
--    'superseded' (via superseded_by) — the plan history is forever auditable, the
--    morning's plan is never edited away. `status` is the plan lifecycle; readiness
--    inputs (predicted_ready_date/ripe_pct) are snapshotted at plan time.
-- ──────────────────────────────────────────────────────────────────────────
create table pasada_schedule (
  id                   bigint generated always as identity primary key,
  plot_id              text        not null references plots(id),
  season               text        not null,
  pasada_number        integer     not null check (pasada_number >= 1),
  predicted_ready_date date        not null,
  predicted_ripe_pct   text        not null default 'medium'
                         check (predicted_ripe_pct in ('low','medium','high')),
  status               text        not null default 'planned'
                         check (status in ('planned','dispatched','picked','superseded')),
  reason               text,                              -- why this (re)plan exists, e.g. 'rain front'
  superseded_by        bigint      references pasada_schedule(id),
  -- the tasks row this plan fired (if any). FK to the phase-1 `tasks` board with
  -- ON DELETE SET NULL: the board is a freely-mutable phase-1 surface (authenticated
  -- DELETE is granted by convention), so we must NOT block a task delete with a hard
  -- FK — instead a deleted task makes the broken plan->task link surface as NULL
  -- rather than a dangling phantom id (the append-only plan row itself is preserved).
  fired_task_id        text        references tasks(id) on delete set null,
  occurred_at          timestamptz not null,
  recorded_at          timestamptz not null default now(),
  device_id            text        not null,
  device_seq           bigint      not null,
  idempotency_key      text        unique,
  unique (device_id, device_seq)
);
create index pasada_schedule_plot_idx   on pasada_schedule (plot_id, pasada_number);
create index pasada_schedule_active_idx on pasada_schedule (status) where status <> 'superseded';
create index pasada_schedule_fired_task_idx on pasada_schedule (fired_task_id) where fired_task_id is not null;

-- pasada_schedule is append-only too: the ONLY legal UPDATE is the supersede stamp
-- (status -> 'superseded' + superseded_by set), performed by replan_pasada as the
-- table owner. A general UPDATE/DELETE from a caller is blocked. The trigger lets
-- the owner-run supersede through (it sets status='superseded') and rejects any
-- other mutation, so history is never rewritten.
create or replace function pasada_schedule_guard() returns trigger
  language plpgsql
  set search_path = public
as $$
declare
  is_supersede_stamp boolean;
  is_fk_clear        boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'pasada_schedule is append-only: DELETE is not permitted'
      using errcode = 'restrict_violation';
  end if;

  -- Sanctioned UPDATE #1 — the supersede STAMP: a planned row becoming superseded,
  -- where ONLY status + superseded_by change. Every other column is pinned, so
  -- history (incl. the idempotency_key the exactly-once contract depends on, the
  -- fired_task_id linkage, the device/occurred_at envelope) is never rewritten.
  is_supersede_stamp :=
         (old.status <> 'superseded' and new.status = 'superseded'
          and new.id            =  old.id
          and new.plot_id       =  old.plot_id
          and new.season        =  old.season
          and new.pasada_number =  old.pasada_number
          and new.predicted_ready_date is not distinct from old.predicted_ready_date
          and new.predicted_ripe_pct   =  old.predicted_ripe_pct
          and new.reason          is not distinct from old.reason
          and new.fired_task_id   is not distinct from old.fired_task_id
          and new.occurred_at     =  old.occurred_at
          and new.recorded_at     =  old.recorded_at
          and new.device_id       =  old.device_id
          and new.device_seq      =  old.device_seq
          and new.idempotency_key is not distinct from old.idempotency_key);

  -- Sanctioned UPDATE #2 — the FK-driven fired_task_id CLEAR: when a fired task is
  -- deleted from the phase-1 board, the fired_task_id FK (on delete set null) nulls
  -- ONLY that column. That is not history rewriting — the link to a now-gone task
  -- honestly becomes NULL. Permit fired_task_id going from a value to NULL with
  -- every other column (status included) unchanged; reject any other re-pointing.
  is_fk_clear :=
         (old.fired_task_id is not null and new.fired_task_id is null
          and new.id            =  old.id
          and new.plot_id       =  old.plot_id
          and new.season        =  old.season
          and new.pasada_number =  old.pasada_number
          and new.status        =  old.status
          and new.superseded_by is not distinct from old.superseded_by
          and new.predicted_ready_date is not distinct from old.predicted_ready_date
          and new.predicted_ripe_pct   =  old.predicted_ripe_pct
          and new.reason          is not distinct from old.reason
          and new.occurred_at     =  old.occurred_at
          and new.recorded_at     =  old.recorded_at
          and new.device_id       =  old.device_id
          and new.device_seq      =  old.device_seq
          and new.idempotency_key is not distinct from old.idempotency_key);

  if not (is_supersede_stamp or is_fk_clear) then
    raise exception 'pasada_schedule is append-only: re-plan with a NEW row, only the supersede stamp may UPDATE'
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;
create trigger pasada_schedule_no_delete before delete on pasada_schedule
  for each row execute function pasada_schedule_guard();
create trigger pasada_schedule_supersede_only before update on pasada_schedule
  for each row execute function pasada_schedule_guard();

-- ──────────────────────────────────────────────────────────────────────────
-- 4. v_harvest_readiness — the DERIVED, never-typed readiness ranking. One row per
--    plot (a plot with NO phenology still appears, honestly low — readiness that
--    can't be substantiated is surfaced, never silently upgraded). security_invoker
--    so base-table RLS governs the caller.
--
--    readiness  : clamp(gdd_accumulated / gdd_to_cherry, 0, 1) nudged by NDVI when
--                 present (the agronomy/gdd.ts readinessScore, in SQL).
--    stagger    : (altitude - 1360)/100 * 4 days — the higher the plot, the later.
--    predicted_ready_date : bloom + (remaining GDD / recent-GDD-rate) + stagger.
--                 Without a bloom date it is NULL (an honest unknown).
--    confidence : high (bloom + NDVI/ripeness), medium (bloom only), low (GDD only).
-- ──────────────────────────────────────────────────────────────────────────
create view v_harvest_readiness with (security_invoker = on) as
with recent_ripeness as (
  select h.plot_id, avg(h.ripeness_pct) as ripe_pct
  from harvests h
  where h.date >= (select coalesce(max(date), '1900-01-01'::date) from harvests) - interval '21 days'
  group by h.plot_id
),
base as (
  select
    p.id   as plot_id,
    p.name as plot_name,
    p.variety,
    p.altitude_masl,
    ph.bloom_date,
    coalesce(ph.gdd_accumulated, 0)  as gdd_accumulated,
    coalesce(ph.gdd_to_cherry, 2200) as gdd_to_cherry,
    ph.ndvi_latest,
    rr.ripe_pct as recent_ripeness_pct,
    -- altitude stagger in days (clamped at the 1360 floor): higher ripens later.
    greatest(0, (p.altitude_masl - 1360)::numeric) / 100 * 4 as stagger_days
  from plots p
  left join plot_phenology ph on ph.plot_id = p.id
  left join recent_ripeness rr on rr.plot_id = p.id
)
select
  b.plot_id,
  b.plot_name,
  b.variety,
  b.altitude_masl,
  b.bloom_date,
  b.gdd_accumulated,
  b.gdd_to_cherry,
  b.ndvi_latest,
  b.recent_ripeness_pct,
  -- DERIVED readiness in [0,1]: GDD spine + optional NDVI nudge (centre 0.6, ±0.15).
  least(1, greatest(0,
    least(1, greatest(0, b.gdd_accumulated / b.gdd_to_cherry))
    + case
        when b.ndvi_latest is null then 0
        else least(1, greatest(-1, (b.ndvi_latest - 0.6) / 0.4)) * 0.15
      end
  ))::numeric as readiness,
  -- honest confidence — never present a prediction as certainty.
  case
    when b.bloom_date is not null and (b.ndvi_latest is not null or b.recent_ripeness_pct is not null) then 'high'
    when b.bloom_date is not null then 'medium'
    else 'low'
  end as confidence,
  b.stagger_days,
  -- predicted ready date: bloom + (remaining GDD / a nominal 50 GDD/day accrual)
  -- + the altitude stagger. NULL without a bloom anchor (an honest unknown). The
  -- 50 GDD/day is the v1 transparent accrual (calibration flag) — the family's own
  -- logged rate refines it; here it makes the stagger ORDERING correct and visible.
  case
    when b.bloom_date is null then null
    else (b.bloom_date
          + (greatest(0, b.gdd_to_cherry - b.gdd_accumulated) / 50.0)::int
          + ceil(b.stagger_days)::int)
  end as predicted_ready_date
from base b;

-- ──────────────────────────────────────────────────────────────────────────
-- 5. v_pasada_calendar — the staggered pasada calendar: only the ACTIVE
--    (non-superseded) plan per (plot, pasada), joined to plot name + altitude so
--    the timeline can stagger visually down the gradient. security_invoker.
-- ──────────────────────────────────────────────────────────────────────────
create view v_pasada_calendar with (security_invoker = on) as
  select
    ps.id,
    ps.plot_id,
    p.name          as plot_name,
    p.variety,
    p.altitude_masl,
    ps.season,
    ps.pasada_number,
    ps.predicted_ready_date,
    ps.predicted_ripe_pct,
    ps.status,
    ps.reason,
    ps.fired_task_id
  from pasada_schedule ps
  join plots p on p.id = ps.plot_id
  where ps.status <> 'superseded';

-- ──────────────────────────────────────────────────────────────────────────
-- 6. _resolve_pasada_worker — pick the assignee for a fired harvest-pass task.
--    tasks.worker_id is NOT NULL, so this NEVER returns null when any worker
--    exists: the plot's most-recent picker → else a Supervisor → else any worker.
--    Internal helper (owner-only; NOT granted to any REST role).
-- ──────────────────────────────────────────────────────────────────────────
create or replace function _resolve_pasada_worker(p_plot_id text)
  returns text
  language sql
  stable
  set search_path = public
as $$
  select w_id from (
    -- 1. the plot's most-recent picker (highest priority)
    select h.worker_id as w_id, 1 as rank, h.date as ord
      from harvests h
     where h.plot_id = p_plot_id
    union all
    -- 2. any Supervisor
    select w.id, 2, '1900-01-01'::date from workers w where w.role = 'Supervisor'
    union all
    -- 3. any worker at all (last resort, so the NOT NULL constraint always holds)
    select w.id, 3, '1900-01-01'::date from workers w
  ) cand
  order by rank, ord desc
  limit 1;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 7. record_maturation_signal — the ONLY writer of plot_phenology + the
--    maturation_signal ledger. Upserts the plot's phenology and appends one
--    ledger row, in one txn, idempotent on idempotency_key. Accepts the
--    client-minted device ids (offline-replayable via the S0 outbox).
-- ──────────────────────────────────────────────────────────────────────────
create or replace function record_maturation_signal(
  p_plot_id         text,
  p_bloom_date      date,
  p_gdd_accumulated numeric,
  p_ndvi_latest     numeric,
  p_occurred_at     timestamptz,
  p_device_id       text,
  p_device_seq      bigint,
  p_idempotency_key text
) returns void
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
begin
  -- exactly-once must not silently depend on the caller sending a non-null key:
  -- `idempotency_key = NULL` is UNKNOWN (never short-circuits) and a UNIQUE column
  -- permits unlimited NULLs, so a NULL key would disable the replay guard entirely.
  -- Reject it up front (app callers always mint a uuid, so this only fires for a
  -- direct/bypassing caller).
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'idempotency_key is required'
      using errcode = 'invalid_parameter_value';
  end if;

  -- exactly-once: a replay with the same key is a no-op (no second ledger row,
  -- no double-applied phenology).
  if exists (select 1 from maturation_signal where idempotency_key = p_idempotency_key) then
    return;
  end if;

  insert into maturation_signal (plot_id, bloom_date, gdd_accumulated, ndvi_latest,
                                 occurred_at, device_id, device_seq, idempotency_key)
  values (p_plot_id, p_bloom_date, p_gdd_accumulated, p_ndvi_latest,
          p_occurred_at, p_device_id, p_device_seq, p_idempotency_key)
  on conflict (idempotency_key) do nothing;

  -- upsert the derived-input row: latest signal wins, but only advances columns
  -- the signal actually carried (a null gdd/ndvi/bloom in the signal leaves the
  -- prior value intact).
  insert into plot_phenology (plot_id, bloom_date, gdd_accumulated, ndvi_latest, updated_at)
  values (p_plot_id, p_bloom_date, coalesce(p_gdd_accumulated, 0), p_ndvi_latest, p_occurred_at)
  on conflict (plot_id) do update set
    bloom_date      = coalesce(excluded.bloom_date,      plot_phenology.bloom_date),
    gdd_accumulated = coalesce(p_gdd_accumulated,        plot_phenology.gdd_accumulated),
    ndvi_latest     = coalesce(excluded.ndvi_latest,     plot_phenology.ndvi_latest),
    updated_at      = excluded.updated_at;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 8. schedule_pasada — append a pasada plan AND fire a task onto the EXISTING
--    phase-1 `tasks` board, in one idempotent txn. The fired task is a real tasks
--    row: a resolved (NOT NULL) worker_id, the plot, the 'Harvest' category, a due
--    date = the predicted ready date, priority from the ripe-pct band.
-- ──────────────────────────────────────────────────────────────────────────
create or replace function schedule_pasada(
  p_plot_id              text,
  p_season               text,
  p_pasada_number        integer,
  p_predicted_ready_date date,
  p_predicted_ripe_pct   text,
  p_occurred_at          timestamptz,
  p_device_id            text,
  p_device_seq           bigint,
  p_idempotency_key      text
) returns bigint
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare
  existing_id bigint;
  worker      text;
  task_id     text;
  plan_id     bigint;
  plot_name   text;
  prio        priority;
begin
  -- exactly-once must not depend on a non-null key (see record_maturation_signal).
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'idempotency_key is required'
      using errcode = 'invalid_parameter_value';
  end if;

  -- exactly-once
  select id into existing_id from pasada_schedule where idempotency_key = p_idempotency_key;
  if existing_id is not null then
    return existing_id;
  end if;

  select name into plot_name from plots where id = p_plot_id;
  if plot_name is null then
    raise exception 'unknown plot %', p_plot_id using errcode = 'foreign_key_violation';
  end if;

  -- SERIALIZE per (plot, pasada) — same defense green_inventory.prevent_oversell
  -- takes per green lot. PostgREST runs each request in its own READ COMMITTED txn,
  -- so without a lock two concurrent (re)plans for the same pass both read the same
  -- pre-write active set and both append an active row. A txn-scoped advisory lock
  -- keyed on (plot, pasada), taken BEFORE the duplicate-active check, makes them
  -- queue (each sees the prior's committed state); it auto-releases at commit and is
  -- keyed per-pass so unrelated passes never block.
  perform pg_advisory_xact_lock(hashtext('pasada:' || p_plot_id || ':' || p_pasada_number));

  -- single-active invariant: at most ONE non-superseded plan per (plot, season,
  -- pasada). schedule_pasada is the front door for a FIRST plan; a re-schedule of an
  -- already-scheduled pass must go through replan_pasada (which supersedes the prior
  -- plan), not duplicate it. Reject the duplicate with a friendly, mappable error.
  if exists (
    select 1 from pasada_schedule
     where plot_id = p_plot_id and season = p_season
       and pasada_number = p_pasada_number and status <> 'superseded'
  ) then
    raise exception 'pasada % for plot % (season %) is already scheduled — re-plan it instead',
      p_pasada_number, p_plot_id, p_season using errcode = 'unique_violation';
  end if;

  worker := _resolve_pasada_worker(p_plot_id);
  -- map the ripe-pct band to a task priority.
  prio := case p_predicted_ripe_pct when 'high' then 'high'::priority
                                    when 'low'  then 'low'::priority
                                    else 'medium'::priority end;

  -- FIRE THE TASK onto the real phase-1 tasks board (the /tasks UI reads this).
  task_id := gen_random_uuid()::text;
  insert into tasks (id, title, category, plot_id, worker_id, due, status, priority)
  values (
    task_id,
    'Pasada ' || p_pasada_number || ' — pick ' || plot_name,
    'Harvest',
    p_plot_id,
    worker,
    p_predicted_ready_date,
    'todo',
    prio
  );

  insert into pasada_schedule (plot_id, season, pasada_number, predicted_ready_date,
                               predicted_ripe_pct, status, fired_task_id,
                               occurred_at, device_id, device_seq, idempotency_key)
  values (p_plot_id, p_season, p_pasada_number, p_predicted_ready_date,
          coalesce(p_predicted_ripe_pct, 'medium'), 'planned', task_id,
          p_occurred_at, p_device_id, p_device_seq, p_idempotency_key)
  returning id into plan_id;

  return plan_id;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 9. replan_pasada — re-plan a pasada around a rain front (or any shift): supersede
--    the current ACTIVE plan for (plot, pasada) and append a NEW plan + fire a new
--    task. APPEND-ONLY: the prior plan is stamped 'superseded', never deleted/edited.
--    Idempotent on idempotency_key.
-- ──────────────────────────────────────────────────────────────────────────
create or replace function replan_pasada(
  p_plot_id              text,
  p_season               text,
  p_pasada_number        integer,
  p_new_ready_date       date,
  p_reason               text,
  p_occurred_at          timestamptz,
  p_device_id            text,
  p_device_seq           bigint,
  p_idempotency_key      text
) returns bigint
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare
  existing_id bigint;
  current_id  bigint;
  ripe        text;
  worker      text;
  task_id     text;
  plan_id     bigint;
  plot_name   text;
begin
  -- exactly-once must not depend on a non-null key (see record_maturation_signal).
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'idempotency_key is required'
      using errcode = 'invalid_parameter_value';
  end if;

  -- exactly-once
  select id into existing_id from pasada_schedule where idempotency_key = p_idempotency_key;
  if existing_id is not null then
    return existing_id;
  end if;

  select name into plot_name from plots where id = p_plot_id;
  if plot_name is null then
    raise exception 'unknown plot %', p_plot_id using errcode = 'foreign_key_violation';
  end if;

  -- SERIALIZE per (plot, pasada) BEFORE the active-plan read below, so concurrent
  -- (re)plans for the same pass queue and each supersedes the prior's committed
  -- active row instead of both reading the same current_id and splitting the active
  -- set (mirrors green_inventory.prevent_oversell; auto-releases at commit).
  perform pg_advisory_xact_lock(hashtext('pasada:' || p_plot_id || ':' || p_pasada_number));

  -- the current ACTIVE plan being superseded (may be none on a first replan).
  select id, predicted_ripe_pct into current_id, ripe
    from pasada_schedule
   where plot_id = p_plot_id and pasada_number = p_pasada_number and status <> 'superseded'
   order by recorded_at desc
   limit 1;
  ripe := coalesce(ripe, 'medium');

  worker := _resolve_pasada_worker(p_plot_id);
  task_id := gen_random_uuid()::text;
  insert into tasks (id, title, category, plot_id, worker_id, due, status, priority)
  values (
    task_id,
    'Pasada ' || p_pasada_number || ' (re-planned) — pick ' || plot_name,
    'Harvest',
    p_plot_id,
    worker,
    p_new_ready_date,
    'todo',
    case ripe when 'high' then 'high'::priority when 'low' then 'low'::priority else 'medium'::priority end
  );

  insert into pasada_schedule (plot_id, season, pasada_number, predicted_ready_date,
                               predicted_ripe_pct, status, reason, fired_task_id,
                               occurred_at, device_id, device_seq, idempotency_key)
  values (p_plot_id, p_season, p_pasada_number, p_new_ready_date,
          ripe, 'planned', p_reason, task_id,
          p_occurred_at, p_device_id, p_device_seq, p_idempotency_key)
  returning id into plan_id;

  -- supersede the prior active plan AFTER the new one exists (history preserved).
  if current_id is not null then
    update pasada_schedule
       set status = 'superseded', superseded_by = plan_id
     where id = current_id;
  end if;

  return plan_id;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 10. RLS — authenticated-only read on the new tables (mirrors auth_required_rls).
--     No write policy: writes go only through the SECURITY DEFINER RPCs above.
-- ──────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['plot_phenology','maturation_signal','pasada_schedule']
  loop
    execute format('alter table %I enable row level security;', t);
    execute format($p$create policy "authenticated read" on %I for select to authenticated using (true);$p$, t);
  end loop;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 11. GRANTS (AD-8) — explicit per-object SELECT on every new table/view; explicit
--     EXECUTE only on the caller-facing RPCs; NO write table grants; NO anon.
-- ──────────────────────────────────────────────────────────────────────────
grant select on plot_phenology     to authenticated;
grant select on maturation_signal  to authenticated;
grant select on pasada_schedule    to authenticated;
grant select on v_harvest_readiness to authenticated;
grant select on v_pasada_calendar   to authenticated;

-- Slam every function's PUBLIC EXECUTE shut, then grant ONLY to authenticated on
-- the caller-facing RPCs. The internal resolver + the trigger/immutability helpers
-- get NO grant (owner-only).
revoke execute on function _resolve_pasada_worker(text)                                                  from public;
revoke execute on function maturation_signal_immutable()                                                 from public;
revoke execute on function pasada_schedule_guard()                                                       from public;
revoke execute on function record_maturation_signal(text, date, numeric, numeric, timestamptz, text, bigint, text) from public;
revoke execute on function schedule_pasada(text, text, integer, date, text, timestamptz, text, bigint, text)        from public;
revoke execute on function replan_pasada(text, text, integer, date, text, timestamptz, text, bigint, text)          from public;

grant execute on function record_maturation_signal(text, date, numeric, numeric, timestamptz, text, bigint, text) to authenticated;
grant execute on function schedule_pasada(text, text, integer, date, text, timestamptz, text, bigint, text)        to authenticated;
grant execute on function replan_pasada(text, text, integer, date, text, timestamptz, text, bigint, text)          to authenticated;

commit;
