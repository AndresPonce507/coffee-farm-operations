-- P2-S12-B — Cross-slice PHI gate: the harvest planner can NEVER schedule a pick
-- inside an active pre-harvest interval (PHI).
--
-- ───────────────────────────────────────────────────────────────────────────
-- WHY A NEW FORWARD MIGRATION (not an in-place edit of 20260622100000):
--   The S12 slice (20260622106000_remote_sensing_ipm.sql) stamps phi_clears_on on
--   every cert-gated spray and exposes the active window per plot via
--   v_plot_phi_status, promising in its own header that the stamp exists "so the
--   harvest planner can never schedule a pick inside an active PHI window". But the
--   planner RPCs (schedule_pasada / replan_pasada) were authored in the EARLIER
--   migration 20260622100000_harvest_planning.sql — before v_plot_phi_status existed —
--   and never consulted it. Both fired a 'Harvest' pick task with due = the predicted
--   ready date with ZERO PHI consult, so a pick could land squarely inside a live
--   pre-harvest residue window (a pesticide-residue food-safety / Best-of-Panama /
--   EUDR-traceability hole for a ~90% Ngäbe-Buglé migrant picking crew).
--
--   v_plot_phi_status is created in 20260622106000 (LATER than the planner's 100000),
--   so an in-place edit of 100000 cannot reference it in a fresh replay. This migration
--   sorts strictly after both (and after the current head 20260623100000_owner_scoped_rls)
--   and `create or replace`s BOTH RPCs with their ORIGINAL bodies verbatim PLUS a
--   fail-closed PHI gate. The PGlite db-test harness replays from scratch, so by the
--   time this runs, v_plot_phi_status is already defined.
--
-- THE GATE (pick-date-relative, NOT today-relative):
--   v_plot_phi_status.phi_clears_on (= max(phi_clears_on) across the plot's sprays) is
--   the FIRST day a pick is allowed. Block when the proposed pick date is STRICTLY
--   before it — so a far-future pick that is still inside the window is refused, while
--   a pick ON or AFTER the clear date succeeds. A plot with no spray has no row in the
--   view (the view INNER-joins spray_application), so it never over-blocks. The gate
--   sits AFTER the exactly-once short-circuit and the plot-existence check, but BEFORE
--   any task/plan write, so a refusal writes nothing (fail-closed) and a replay still
--   returns the original id. Uses errcode 'check_violation' so the /plan UI's
--   friendlyError can map it to a human sentence.
--
--   Everything else — args, advisory locks, single-active invariant, append-only/
--   supersede semantics, worker resolution, exactly-once — is preserved byte-for-byte
--   from 20260622100000_harvest_planning.sql.
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- ── schedule_pasada — original body + fail-closed PHI gate ───────────────────
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

  -- PHI GATE (fail-closed) — the cross-slice S12 invariant. A pick can NEVER be
  -- scheduled before the plot's pre-harvest interval clears. phi_clears_on is the
  -- first allowed pick day, so block a strictly-earlier pick date. Placed BEFORE any
  -- write so a refusal fires no task and writes no plan.
  if exists (
    select 1 from v_plot_phi_status
     where plot_id = p_plot_id
       and p_predicted_ready_date < phi_clears_on
  ) then
    raise exception
      'pasada gate: plot % has an active PHI window clearing % — cannot schedule a pick on %; re-plan once the pre-harvest interval clears',
      p_plot_id,
      (select phi_clears_on from v_plot_phi_status where plot_id = p_plot_id),
      p_predicted_ready_date
      using errcode = 'check_violation';
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

-- ── replan_pasada — original body + fail-closed PHI gate ─────────────────────
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

  -- PHI GATE (fail-closed) — the rain-front re-plan path is the MOST likely to move a
  -- pick date, so it must re-check PHI against the NEW ready date. Same semantics as
  -- schedule_pasada: block a pick strictly before the plot's pre-harvest interval
  -- clears. Placed BEFORE the supersede/new-plan write so a refusal leaves the prior
  -- active plan untouched and fires no new task.
  if exists (
    select 1 from v_plot_phi_status
     where plot_id = p_plot_id
       and p_new_ready_date < phi_clears_on
  ) then
    raise exception
      'pasada gate: plot % has an active PHI window clearing % — cannot re-plan a pick on %; choose a date once the pre-harvest interval clears',
      p_plot_id,
      (select phi_clears_on from v_plot_phi_status where plot_id = p_plot_id),
      p_new_ready_date
      using errcode = 'check_violation';
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

-- ── GRANTS (AD-8) — re-assert the caller-facing posture on the replaced fns.
-- `create or replace function` PRESERVES existing grants, but the PUBLIC-execute
-- default can re-appear if the prior revoke is ever rolled back, so re-slam PUBLIC
-- and re-grant authenticated to keep the door explicitly closed-then-opened.
revoke execute on function schedule_pasada(text, text, integer, date, text, timestamptz, text, bigint, text) from public;
revoke execute on function replan_pasada(text, text, integer, date, text, timestamptz, text, bigint, text)   from public;
grant  execute on function schedule_pasada(text, text, integer, date, text, timestamptz, text, bigint, text) to authenticated;
grant  execute on function replan_pasada(text, text, integer, date, text, timestamptz, text, bigint, text)   to authenticated;

commit;
