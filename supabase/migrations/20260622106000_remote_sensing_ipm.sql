-- P2-S12 — Satellite NDVI/NDRE + Sentinel-1 SAR fusion (honest confidence badge),
-- IPM scouting with an economic-threshold engine, and a CERTIFICATION + PHI/REI-safe
-- spray log.
--
-- A BRANCH READ off plot geometry that fires control tasks onto the existing
-- phase-1 `tasks` board and gates hazardous spray work at the DATA LAYER:
--   * plot_vegetation_index  — append-only optical/SAR observation series; the
--     fusion view emits an HONEST high/medium/low confidence that survives Volcán's
--     near-daily cloud (optical-stale/cloudy → SAR fallback → "radar, medium").
--   * scouting_observation   — append-only IPM scouting; the economic-threshold view
--     compares pest incidence to the published action threshold (broca/roya) and
--     record_scouting FIRES a control task onto the board when crossed (closed loop).
--   * spray_application      — append-only spray log; log_spray is the KEY INVARIANT:
--     a spray is BLOCKED unless the applicator holds a VALID cert (S1's
--     v_worker_certs_valid) AND no overlapping active PHI window would be violated —
--     a fail-closed gate that RAISES, exactly the phase-1 issue_dds rollback posture.
--
-- ───────────────────────────────────────────────────────────────────────────
-- SCHEMA-TRUTH (matches the on-disk phase-1/2 posture, NOT the design-doc factory):
--   * The live spine is AUTHENTICATED-ONLY RLS — there is NO `app.apply_farm_rls`
--     factory and NO `farm_id` column anywhere (multi-tenant lands later as P4-S0).
--     This slice mirrors the real posture: enable RLS + an "authenticated read"
--     policy + an explicit `grant select … to authenticated`. No anon grants.
--   * The write door is the command RPC (ADR-002): SECURITY DEFINER, pinned
--     `set search_path = public, extensions`, idempotent on idempotency_key,
--     accepting client-minted device_id/device_seq so every write is offline-
--     replayable through the S0 outbox. NO write table grants are issued.
--   * AD-8 grant hygiene: default privileges are locked, so EVERY new table/view
--     gets an explicit per-object `grant select … to authenticated`, and EVERY
--     function `revoke execute … from public` then `grant execute … to
--     authenticated`. Internal/trigger helpers get NO grant.
--   * Timestamp 20260622106000 sorts strictly above the live phase-2 head
--     20260622100000_harvest_planning.sql — ASSIGNED, keep it.
--
-- THE CERT + PHI/REI GATE (the slice's load-bearing invariant): log_spray
--   (1) refuses an applicator without a valid pesticide-handling cert in
--       v_worker_certs_valid (S1) — raises 'spray gate: …', writes NO row;
--   (2) refuses a product whose own active-ingredient PHI window would still be
--       open on the same plot from a prior spray collision (defensive re-entry/PHI
--       conflict), and stamps phi_clears_on / rei_clears_at on the row so the
--       harvest planner (S8) can never schedule a pick inside an active PHI window.
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. plot_vegetation_index — APPEND-ONLY satellite observation series. One row per
--    (plot, source, observed scene). Optical (Sentinel-2 NDVI/NDRE) AND SAR
--    (Sentinel-1 backscatter) land here; the fusion view chooses + badges. Written
--    ONLY by record_vegetation_index (the off-DB Copernicus ingest calls it; manual
--    cached-entry is the $0 offline-safe fallback).
-- ──────────────────────────────────────────────────────────────────────────
create table plot_vegetation_index (
  id              bigint generated always as identity primary key,
  plot_id         text        not null references plots(id),
  source          text        not null
                    check (source in ('sentinel-2','sentinel-1-sar')),
  index_kind      text        not null
                    check (index_kind in ('ndvi','ndre','sar-backscatter')),
  value           numeric     not null,
  cloud_pct       numeric     not null default 0
                    check (cloud_pct >= 0 and cloud_pct <= 100),
  observed_at     timestamptz not null,
  recorded_at     timestamptz not null default now(),
  device_id       text        not null,
  device_seq      bigint      not null,
  idempotency_key text        unique,
  unique (device_id, device_seq)
);
create index plot_vegetation_index_plot_idx on plot_vegetation_index (plot_id, observed_at desc);

-- ──────────────────────────────────────────────────────────────────────────
-- 2. scouting_observation — APPEND-ONLY IPM scouting ledger. A scout walks a plot,
--    counts a pest's incidence; record_scouting evaluates the economic threshold
--    and, on a crossing, fires a control task. Corrections are NEW rows.
-- ──────────────────────────────────────────────────────────────────────────
create table scouting_observation (
  id              bigint generated always as identity primary key,
  plot_id         text        not null references plots(id),
  pest_kind       text        not null,                 -- 'broca' | 'roya' | …
  incidence_pct   numeric     not null check (incidence_pct >= 0 and incidence_pct <= 100),
  notes           text,
  worker_id       text        references workers(id),
  occurred_at     timestamptz not null,
  recorded_at     timestamptz not null default now(),
  fired_task_id   text        references tasks(id),      -- the control task this fired, if any
  device_id       text        not null,
  device_seq      bigint      not null,
  idempotency_key text        unique,
  unique (device_id, device_seq)
);
create index scouting_observation_plot_idx on scouting_observation (plot_id, pest_kind, occurred_at desc);

-- ──────────────────────────────────────────────────────────────────────────
-- 3. spray_application — APPEND-ONLY spray log. Every row is a cert-gated,
--    PHI/REI-stamped application. phi_clears_on / rei_clears_at are computed at
--    insert from phi_days / rei_hours so the planner and the countdown chips read
--    a precomputed window, never re-derive it.
-- ──────────────────────────────────────────────────────────────────────────
create table spray_application (
  id                bigint generated always as identity primary key,
  plot_id           text        not null references plots(id),
  product           text        not null,
  active_ingredient text,
  phi_days          integer     not null default 0 check (phi_days >= 0),
  rei_hours         integer     not null default 0 check (rei_hours >= 0),
  applied_at        timestamptz not null,
  phi_clears_on     date        not null,                -- no pick before this (PHI)
  rei_clears_at     timestamptz not null,                -- no re-entry before this (REI)
  worker_id         text        not null references workers(id),   -- the certified applicator
  recorded_at       timestamptz not null default now(),
  device_id         text        not null,
  device_seq        bigint      not null,
  idempotency_key   text        unique,
  unique (device_id, device_seq)
);
create index spray_application_plot_idx on spray_application (plot_id, phi_clears_on desc);

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Append-only immutability — one shared raise-fn, a no-update + no-delete
--    trigger per ledger. Evidence is corrected by a NEW row, never mutated
--    (the phase-1 lot_event / maturation_signal discipline).
-- ──────────────────────────────────────────────────────────────────────────
create or replace function _rsi_block_mutation() returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  raise exception
    '% is append-only: % is not permitted — record a new observation instead',
    tg_table_name, tg_op
    using errcode = 'restrict_violation';
end $$;

create trigger plot_vegetation_index_no_update before update on plot_vegetation_index
  for each row execute function _rsi_block_mutation();
create trigger plot_vegetation_index_no_delete before delete on plot_vegetation_index
  for each row execute function _rsi_block_mutation();
create trigger scouting_observation_no_update before update on scouting_observation
  for each row execute function _rsi_block_mutation();
create trigger scouting_observation_no_delete before delete on scouting_observation
  for each row execute function _rsi_block_mutation();
create trigger spray_application_no_update before update on spray_application
  for each row execute function _rsi_block_mutation();
create trigger spray_application_no_delete before delete on spray_application
  for each row execute function _rsi_block_mutation();

-- ──────────────────────────────────────────────────────────────────────────
-- 5. v_plot_vegetation — THE FUSION VIEW with the HONEST CONFIDENCE BADGE.
--    Mirrors src/lib/agronomy/confidence-fusion.ts exactly so the UI badge and the
--    DB value always agree:
--      * recent (<= 12d) AND low-cloud (<= 40%) optical → HIGH, basis 'optical';
--      * else a SAR read present                        → MEDIUM, basis 'sar';
--      * else an optical read present (cloudy/stale)    → LOW, basis 'optical';
--      * else (no signal at all)                        → LOW, null value.
--    EVERY plot appears — a plot with no observation is honestly low/unknown, the
--    cloud is NEVER hidden behind a blank.
-- ──────────────────────────────────────────────────────────────────────────
create view v_plot_vegetation with (security_invoker = on) as
  with latest_optical as (
    select distinct on (plot_id) plot_id, value, index_kind, cloud_pct, observed_at
      from plot_vegetation_index
     where source = 'sentinel-2'
     order by plot_id, observed_at desc
  ),
  latest_sar as (
    select distinct on (plot_id) plot_id, value, index_kind, cloud_pct, observed_at
      from plot_vegetation_index
     where source = 'sentinel-1-sar'
     order by plot_id, observed_at desc
  )
  select
    p.id   as plot_id,
    p.name as plot_name,
    p.variety,
    p.altitude_masl,
    case
      when o.plot_id is not null
           and o.cloud_pct <= 40
           and o.observed_at >= now() - interval '12 days'
        then o.value
      when s.plot_id is not null then s.value
      when o.plot_id is not null then o.value
      else null
    end as value,
    case
      when o.plot_id is not null
           and o.cloud_pct <= 40
           and o.observed_at >= now() - interval '12 days'
        then o.index_kind
      when s.plot_id is not null then s.index_kind
      when o.plot_id is not null then o.index_kind
      else null
    end as index_kind,
    case
      when o.plot_id is not null
           and o.cloud_pct <= 40
           and o.observed_at >= now() - interval '12 days'
        then 'high'
      when s.plot_id is not null then 'medium'
      else 'low'
    end as confidence,
    case
      when o.plot_id is not null
           and o.cloud_pct <= 40
           and o.observed_at >= now() - interval '12 days'
        then 'optical'
      when s.plot_id is not null then 'sar'
      else 'optical'
    end as basis,
    case
      when o.plot_id is not null
           and o.cloud_pct <= 40
           and o.observed_at >= now() - interval '12 days'
        then o.cloud_pct
      when s.plot_id is not null then s.cloud_pct
      when o.plot_id is not null then o.cloud_pct
      else null
    end as cloud_pct,
    case
      when o.plot_id is not null
           and o.cloud_pct <= 40
           and o.observed_at >= now() - interval '12 days'
        then o.observed_at
      when s.plot_id is not null then s.observed_at
      when o.plot_id is not null then o.observed_at
      else null
    end as observed_at
  from plots p
  left join latest_optical o on o.plot_id = p.id
  left join latest_sar     s on s.plot_id = p.id;

-- ──────────────────────────────────────────────────────────────────────────
-- 6. _ipm_threshold(pest) — the published economic-action threshold (mirrors
--    src/lib/agronomy/economic-threshold.ts). Unknown pest → null (no fabricated
--    threshold, never an action without evidence).
-- ──────────────────────────────────────────────────────────────────────────
create or replace function _ipm_threshold(p_pest text) returns numeric
  language sql
  immutable
  set search_path = public
as $$
  select case p_pest
    when 'broca' then 5
    when 'roya'  then 10
    else null
  end::numeric;
$$;

-- v_ipm_threshold — the latest scouting read per (plot, pest) with its recommend/
-- hold call. recommend = incidence >= the published threshold (>= is the action
-- boundary); an unknown pest can never recommend (null threshold).
create view v_ipm_threshold with (security_invoker = on) as
  with latest as (
    select distinct on (plot_id, pest_kind)
           plot_id, pest_kind, incidence_pct, occurred_at, fired_task_id
      from scouting_observation
     order by plot_id, pest_kind, occurred_at desc
  )
  select
    l.plot_id,
    p.name as plot_name,
    l.pest_kind,
    l.incidence_pct,
    _ipm_threshold(l.pest_kind) as threshold,
    (_ipm_threshold(l.pest_kind) is not null
       and l.incidence_pct >= _ipm_threshold(l.pest_kind)) as recommend,
    l.occurred_at,
    l.fired_task_id
  from latest l
  join plots p on p.id = l.plot_id;

-- ──────────────────────────────────────────────────────────────────────────
-- 7. v_plot_phi_status — the active PHI/REI window per plot. Drives the countdown
--    chips AND the harvest-planning block: phi_active = a pick CANNOT be scheduled
--    inside it; rei_active = a worker CANNOT re-enter.
--
--    phi_active / rei_active are PLOT-LEVEL aggregates over ALL sprays — phi_active
--    is true if ANY spray's PHI is still open, rei_active is true if ANY spray's REI
--    is still open. They must NOT be read off a single "winning" row: PHI and REI are
--    INDEPENDENT intervals, so an OLD long-PHI spray (REI long cleared) collapsing the
--    plot to one row would mask a NEWER short-PHI spray whose REI is still open —
--    telling a worker the plot is safe to re-enter while a live re-entry interval is
--    open. The representative product/applied_at name the hazardous spray (the one
--    whose REI is open, else the longest-PHI one), not an arbitrary stale row.
-- ──────────────────────────────────────────────────────────────────────────
create view v_plot_phi_status with (security_invoker = on) as
  select
    p.id   as plot_id,
    p.name as plot_name,
    (array_agg(s.product
       order by (s.rei_clears_at >= now()) desc, s.phi_clears_on desc))[1] as product,
    (array_agg(s.active_ingredient
       order by (s.rei_clears_at >= now()) desc, s.phi_clears_on desc))[1] as active_ingredient,
    max(s.applied_at)                        as applied_at,
    max(s.phi_clears_on)                      as phi_clears_on,
    max(s.rei_clears_at)                      as rei_clears_at,
    bool_or(s.phi_clears_on >= current_date)  as phi_active,
    bool_or(s.rei_clears_at >= now())         as rei_active
  from spray_application s
  join plots p on p.id = s.plot_id
  group by p.id, p.name;

-- v_spray_history — the full append-only spray log per plot (history surface).
create view v_spray_history with (security_invoker = on) as
  select
    s.id,
    s.plot_id,
    p.name as plot_name,
    s.product,
    s.active_ingredient,
    s.phi_days,
    s.rei_hours,
    s.applied_at,
    s.phi_clears_on,
    s.rei_clears_at,
    s.worker_id,
    w.name as worker_name
  from spray_application s
  join plots   p on p.id = s.plot_id
  join workers w on w.id = s.worker_id;

-- ──────────────────────────────────────────────────────────────────────────
-- 8. Command RPCs (ADR-002 — SECURITY DEFINER, pinned search_path, idempotent on
--    idempotency_key, accept client-minted device cols). EXECUTE to authenticated.
-- ──────────────────────────────────────────────────────────────────────────

-- record_vegetation_index — append one optical/SAR observation. The off-DB
-- Copernicus ingest calls this; manual cached entry is the offline-safe fallback.
-- Idempotent: a replay returns the originally minted id, appends no second row.
create or replace function record_vegetation_index(
  p_plot_id         text,
  p_source          text,
  p_index_kind      text,
  p_value           numeric,
  p_cloud_pct       numeric,
  p_observed_at     timestamptz,
  p_device_id       text,
  p_device_seq      bigint,
  p_idempotency_key text
) returns bigint
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare existing bigint; new_id bigint;
begin
  select id into existing from plot_vegetation_index where idempotency_key = p_idempotency_key;
  if existing is not null then
    return existing;                                     -- exactly-once replay
  end if;

  if not exists (select 1 from plots where id = p_plot_id) then
    raise exception 'unknown plot %', p_plot_id using errcode = 'foreign_key_violation';
  end if;

  insert into plot_vegetation_index (plot_id, source, index_kind, value, cloud_pct,
                                     observed_at, device_id, device_seq, idempotency_key)
  values (p_plot_id, p_source, p_index_kind, p_value, coalesce(p_cloud_pct, 0),
          p_observed_at, p_device_id, p_device_seq, p_idempotency_key)
  on conflict (idempotency_key) do nothing
  returning id into new_id;
  if new_id is null then
    select id into new_id from plot_vegetation_index where idempotency_key = p_idempotency_key;
  end if;
  return new_id;
end $$;

-- record_scouting — append an IPM scouting observation AND fire a control task onto
-- the existing phase-1 `tasks` board when the incidence crosses the economic
-- threshold (recommend = true). Idempotent. tasks.worker_id is NOT NULL, so the
-- assignee is resolved: the scout → else a Supervisor/Agronomist → else any worker.
create or replace function record_scouting(
  p_plot_id         text,
  p_pest_kind       text,
  p_incidence_pct   numeric,
  p_notes           text,
  p_worker_id       text,
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
  existing   bigint;
  obs_id     bigint;
  threshold  numeric;
  task_id    text;
  assignee   text;
  plot_name  text;
  prio       priority;
begin
  -- exactly-once must not silently depend on the caller sending a non-null key:
  -- `idempotency_key = NULL` is UNKNOWN (never short-circuits the replay guard) and a
  -- UNIQUE column permits unlimited NULLs, so a NULL key would let every call insert a
  -- fresh observation AND fire a fresh control task onto the board (duplicate pest-
  -- control tasks for one scout). Reject it up front — mirrors the harvest-planner
  -- sibling RPCs (record_maturation_signal et al.).
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'idempotency_key is required'
      using errcode = 'invalid_parameter_value';
  end if;

  select id into existing from scouting_observation where idempotency_key = p_idempotency_key;
  if existing is not null then
    return existing;                                     -- exactly-once replay
  end if;

  select name into plot_name from plots where id = p_plot_id;
  if plot_name is null then
    raise exception 'unknown plot %', p_plot_id using errcode = 'foreign_key_violation';
  end if;

  threshold := _ipm_threshold(p_pest_kind);
  task_id := null;

  -- THRESHOLD CROSSED → fire ONE control task on the real board (closed loop).
  if threshold is not null and p_incidence_pct >= threshold then
    -- resolve a valid (NOT NULL) assignee: the scout, else an Agronomist/Supervisor,
    -- else any worker (tasks.worker_id is NOT NULL).
    assignee := p_worker_id;
    if assignee is null or not exists (select 1 from workers where id = assignee) then
      select id into assignee from workers
       where role in ('Agronomist','Supervisor') order by id limit 1;
    end if;
    if assignee is null then
      select id into assignee from workers order by id limit 1;
    end if;
    if assignee is null then
      raise exception 'cannot fire control task: no worker to assign'
        using errcode = 'foreign_key_violation';
    end if;

    -- exceedance → priority (mirrors economic-threshold.ts priorityFor).
    prio := case
      when p_incidence_pct - threshold >= 10 then 'high'::priority
      else 'medium'::priority
    end;

    task_id := gen_random_uuid()::text;
    insert into tasks (id, title, category, plot_id, worker_id, due, status, priority)
    values (
      task_id,
      'IPM control — ' || p_pest_kind || ' at ' || round(p_incidence_pct) || '% on ' || plot_name,
      'Pest Control',
      p_plot_id,
      assignee,
      (p_occurred_at)::date,
      'todo',
      prio
    );
  end if;

  insert into scouting_observation (plot_id, pest_kind, incidence_pct, notes, worker_id,
                                    occurred_at, fired_task_id,
                                    device_id, device_seq, idempotency_key)
  values (p_plot_id, p_pest_kind, p_incidence_pct, p_notes, p_worker_id,
          p_occurred_at, task_id, p_device_id, p_device_seq, p_idempotency_key)
  returning id into obs_id;

  return obs_id;
end $$;

-- log_spray — THE CERT + PHI/REI GATE (the slice's load-bearing invariant).
-- Fail-closed: RAISES (writing NO row) when the applicator lacks a valid cert in
-- v_worker_certs_valid (S1) OR when the application would land inside an unexpired
-- PHI/REI window already open on the plot from a prior spray (a re-entry / PHI
-- conflict). On success, stamps phi_clears_on / rei_clears_at from phi_days /
-- rei_hours so the harvest planner can never schedule a pick inside the window.
-- Idempotent on idempotency_key. The cert kind required is 'pesticide-handling'.
create or replace function log_spray(
  p_plot_id           text,
  p_product           text,
  p_active_ingredient text,
  p_phi_days          integer,
  p_rei_hours         integer,
  p_applied_at        timestamptz,
  p_worker_id         text,
  p_device_id         text,
  p_device_seq        bigint,
  p_idempotency_key   text
) returns bigint
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare
  existing      bigint;
  new_id        bigint;
  v_phi_clears  date;
  v_rei_clears  timestamptz;
begin
  -- exactly-once must not silently depend on the caller sending a non-null key:
  -- `idempotency_key = NULL` is UNKNOWN (never short-circuits the replay guard) and a
  -- UNIQUE column permits unlimited NULLs, so a NULL key would let every call insert a
  -- fresh cert/PHI-gated spray row (a compliance-record duplication). Reject it up
  -- front — mirrors the harvest-planner sibling RPCs (schedule_pasada et al.).
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'idempotency_key is required'
      using errcode = 'invalid_parameter_value';
  end if;

  select id into existing from spray_application where idempotency_key = p_idempotency_key;
  if existing is not null then
    return existing;                                     -- exactly-once replay
  end if;

  if not exists (select 1 from plots where id = p_plot_id) then
    raise exception 'unknown plot %', p_plot_id using errcode = 'foreign_key_violation';
  end if;
  if not exists (select 1 from workers where id = p_worker_id) then
    raise exception 'unknown worker %', p_worker_id using errcode = 'foreign_key_violation';
  end if;

  -- APPLIED_AT CLAMP (fail-closed). The ENTIRE PHI/REI safety window is derived from
  -- p_applied_at, and v_plot_phi_status.phi_active is exactly (phi_clears_on >=
  -- current_date) — so a client-controlled applied_at is fully attacker-derivable. A
  -- spray logged into the PAST produces a phi_clears_on already <= current_date (the
  -- plot looks PHI-clear while the chemical is still toxic) and a rei_clears_at that
  -- lands already-expired (re-entry inside the real REI). A spray logged into the
  -- FUTURE poisons the countdown chips and the append-only compliance ledger. Clamp
  -- to a tight window around now() — small clock-skew tolerance forward, a couple of
  -- days back for a genuinely-delayed offline (Ngäbe-Buglé field) entry — so the
  -- PHI/REI clock can never be shortened by a fabricated timestamp.
  if p_applied_at is null then
    raise exception 'spray gate: applied_at is required'
      using errcode = 'check_violation';
  end if;
  if p_applied_at > now() + interval '5 minutes' then
    raise exception 'spray gate: applied_at % is in the future — refused', p_applied_at
      using errcode = 'check_violation';
  end if;
  if p_applied_at < now() - interval '2 days' then
    raise exception 'spray gate: applied_at % is implausibly far in the past — refused', p_applied_at
      using errcode = 'check_violation';
  end if;

  -- GATE 1 — CERTIFICATION (fail-closed). The applicator MUST hold a currently
  -- valid pesticide-handling cert (S1's v_worker_certs_valid is the single source).
  if not exists (
    select 1 from v_worker_certs_valid
     where worker_id = p_worker_id and cert_kind = 'pesticide-handling'
  ) then
    raise exception
      'spray gate: worker % lacks a valid pesticide-handling certification — application blocked',
      p_worker_id
      using errcode = 'check_violation';
  end if;

  v_phi_clears := (p_applied_at + make_interval(days  => coalesce(p_phi_days, 0)))::date;
  v_rei_clears :=  p_applied_at + make_interval(hours => coalesce(p_rei_hours, 0));

  -- GATE 2 — PHI/REI SAFETY (fail-closed). Refuse if the plot still has an OPEN
  -- re-entry window from a prior application at the moment of this one (re-entry
  -- conflict — a worker must not enter a plot inside another product's REI).
  if exists (
    select 1 from spray_application s
     where s.plot_id = p_plot_id
       and s.rei_clears_at > p_applied_at
  ) then
    raise exception
      'spray gate: plot % is inside an active re-entry interval (REI) from a prior application — application blocked',
      p_plot_id
      using errcode = 'check_violation';
  end if;

  insert into spray_application (plot_id, product, active_ingredient, phi_days, rei_hours,
                                 applied_at, phi_clears_on, rei_clears_at, worker_id,
                                 device_id, device_seq, idempotency_key)
  values (p_plot_id, p_product, p_active_ingredient, coalesce(p_phi_days, 0),
          coalesce(p_rei_hours, 0), p_applied_at, v_phi_clears, v_rei_clears, p_worker_id,
          p_device_id, p_device_seq, p_idempotency_key)
  returning id into new_id;

  return new_id;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 9. RLS — authenticated-only read on the new tables (mirrors auth_required_rls).
--    The append-only ledgers additionally `force` RLS and get NO write policy
--    (writes go only through the SECURITY DEFINER RPCs above).
-- ──────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['plot_vegetation_index','scouting_observation','spray_application']
  loop
    execute format('alter table %I enable row level security;', t);
    execute format($p$create policy "authenticated read" on %I for select to authenticated using (true);$p$, t);
  end loop;
end $$;

alter table plot_vegetation_index force row level security;
alter table scouting_observation  force row level security;
alter table spray_application      force row level security;

-- ──────────────────────────────────────────────────────────────────────────
-- 10. GRANTS (AD-8) — explicit per-object SELECT on every new table/view; explicit
--     EXECUTE only on the caller-facing RPCs; NO write table grants; NO anon.
-- ──────────────────────────────────────────────────────────────────────────
grant select on plot_vegetation_index to authenticated;
grant select on scouting_observation  to authenticated;
grant select on spray_application      to authenticated;
grant select on v_plot_vegetation      to authenticated;
grant select on v_ipm_threshold        to authenticated;
grant select on v_plot_phi_status      to authenticated;
grant select on v_spray_history        to authenticated;

-- Slam every function's PUBLIC EXECUTE shut, then grant ONLY the caller-facing RPCs
-- to authenticated. The internal threshold resolver + the immutability trigger fn
-- get NO grant (owner-only).
revoke execute on function _rsi_block_mutation()                                                              from public;
revoke execute on function _ipm_threshold(text)                                                               from public;
revoke execute on function record_vegetation_index(text, text, text, numeric, numeric, timestamptz, text, bigint, text) from public;
revoke execute on function record_scouting(text, text, numeric, text, text, timestamptz, text, bigint, text)  from public;
revoke execute on function log_spray(text, text, text, integer, integer, timestamptz, text, text, bigint, text) from public;

grant execute on function record_vegetation_index(text, text, text, numeric, numeric, timestamptz, text, bigint, text) to authenticated;
grant execute on function record_scouting(text, text, numeric, text, text, timestamptz, text, bigint, text)  to authenticated;
grant execute on function log_spray(text, text, text, integer, integer, timestamptz, text, text, bigint, text) to authenticated;

commit;
