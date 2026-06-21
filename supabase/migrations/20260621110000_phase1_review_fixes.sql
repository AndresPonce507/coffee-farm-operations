-- Phase-1 full-review fixes (data layer). Closes the reachable + cheap-latent
-- correctness holes the 59-agent phase-1 review confirmed. App-layer + seed fixes
-- ship alongside; this migration is the DB half (one-author lane).
--
--   1. record_cherry_intake minter: COLLISION-PROOF (loop nextval past any code
--      already taken). The seed hard-inserts JC-700/701/710/711 without advancing
--      lot_code_seq (start 700), so the first real intake would mint 'JC-700' and
--      collide on lots_pkey. (Belt-and-braces with the seed's setval.)
--   2. advance_processing_stage: validate the stage is a real batch_stage, forbid
--      a backward move, and forbid an unbounded mass GAIN (only lowering was
--      guarded). Defense-in-depth — the RPC isn't UI-wired yet, but the pipeline
--      slice will wire it.
--   3. harvests: a BEFORE INSERT/UPDATE trigger rejecting a harvest whose lot is a
--      GREEN export lot — logging cherries against a sold green lot is nonsensical
--      and silently rewrites that lot's EUDR origin set + flips its verdict (a
--      cross-slice S3-write→S8-read corruption the review reproduced). A trigger
--      (not a CHECK) is required because it must read lots.stage; it covers a
--      direct REST write too, which the authenticated grant otherwise allows.
--      (Milled is intentionally still allowed so the S8 EUDR-linkage seed harvests
--      survive; the deeper "harvests only on cherry-stage lots + a real cherry→
--      green seed lineage" model is flagged for the pipeline-UI slice.)
--   4. green_reachable_lots / green_reachable_plots: the set of cost targets whose
--      money actually reaches cost-per-kg-green. A cost booked on a lot/plot that
--      reaches no green terminal is silently dropped from COGS today; the costing
--      write UI restricts its pickers to these views and the action rejects a
--      non-reaching target.
--
-- AD-8: every redefined/new function re-asserts revoke-public + grant-authenticated;
-- the new views get explicit SELECT to authenticated; nothing to anon.

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. record_cherry_intake — collision-proof mint.
-- ──────────────────────────────────────────────────────────────────────────
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
  select (payload->>'lot_code') into existing_code
    from lot_event
   where idempotency_key = p_idempotency_key and kind = 'cherry_intake';
  if existing_code is not null then
    return existing_code;
  end if;

  -- Skip any code already present (the seed inserts JC-7xx without advancing the
  -- sequence). Bounded by the sequence being monotonic — it always terminates.
  loop
    new_code := 'JC-' || lpad(nextval('lot_code_seq')::text, 3, '0');
    exit when not exists (select 1 from lots where code = new_code);
  end loop;

  insert into lots (code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
  values (new_code, 'cherry', p_variety, p_cherries_kg, p_cherries_kg, true, p_occurred_at);

  perform record_lot_event(
    new_code, 'cherry_intake',
    jsonb_build_object(
      'lot_code', new_code, 'plot_id', p_plot_id, 'worker_id', p_worker_id,
      'cherries_kg', p_cherries_kg, 'variety', p_variety
    ),
    p_occurred_at, p_device_id, p_device_seq, p_idempotency_key
  );
  return new_code;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. advance_processing_stage — valid-stage + forward-only + no mass-gain.
-- ──────────────────────────────────────────────────────────────────────────
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
begin
  select (payload->>'lot_code') into already
    from lot_event
   where idempotency_key = p_idempotency_key and kind = 'stage_advance';
  if already is not null then
    return already;
  end if;

  -- the target must be a real pipeline stage (raises on a typo / garbage).
  perform p_to_stage::batch_stage;

  select stage, current_kg into cur_stage, cur_kg from lots where code = p_lot_code;
  if not found then
    raise exception 'unknown lot %', p_lot_code using errcode = 'foreign_key_violation';
  end if;

  -- forward-only: never move a lot BACKWARD through the pipeline (a null/unknown
  -- current stage is treated as the start, so any first advance is allowed).
  if cur_stage is not null
     and (cur_stage = any (enum_range(null::batch_stage)::text[]))
     and p_to_stage::batch_stage < cur_stage::batch_stage then
    raise exception 'lot % cannot move backward (% -> %)', p_lot_code, cur_stage, p_to_stage
      using errcode = 'check_violation';
  end if;

  -- mass is conserved or LOST through processing, never gained: reject a raise.
  if p_current_kg is not null and cur_kg is not null and p_current_kg > cur_kg then
    raise exception 'lot % current_kg cannot increase (% -> %)', p_lot_code, cur_kg, p_current_kg
      using errcode = 'check_violation';
  end if;

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

-- ──────────────────────────────────────────────────────────────────────────
-- 3. harvests_no_green_target — a harvest can never target a GREEN export lot.
-- ──────────────────────────────────────────────────────────────────────────
create or replace function harvests_no_green_target() returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  if (select stage from lots where code = new.lot_code) = 'green' then
    raise exception
      'a harvest cannot be logged against green export lot % — cherries are intake for a cherry/in-pipeline lot, and harvesting into a sold lot would rewrite its EUDR origin',
      new.lot_code
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger harvests_no_green_target_ins before insert on harvests
  for each row execute function harvests_no_green_target();
create trigger harvests_no_green_target_upd before update on harvests
  for each row execute function harvests_no_green_target();

-- ──────────────────────────────────────────────────────────────────────────
-- 4. green-reachable cost targets — the targets whose money actually reaches
--    cost-per-kg-green. (Mirrors the cost_alloc walk: a cost lands in COGS only
--    when its target resolves to a green terminal.)
--    green_reachable_lots: a lot is reachable iff it is itself green OR a descent
--      over lot_edges from it hits a green node.
--    green_reachable_plots: a plot is reachable iff any of its harvested lots is
--      green-reachable.
-- ──────────────────────────────────────────────────────────────────────────
create view green_reachable_lots with (security_invoker = on) as
with recursive descend as (
  -- seed: every lot, walking from itself.
  select l.code as start_code, l.code as cur_code, l.stage as cur_stage
    from lots l
  union
  select d.start_code, e.child_code, c.stage
    from descend d
    join lot_edges e on e.parent_code = d.cur_code
    join lots c on c.code = e.child_code
)
select distinct start_code as code
  from descend
 where cur_stage = 'green';

create view green_reachable_plots with (security_invoker = on) as
  select distinct h.plot_id as id
    from harvests h
    join green_reachable_lots g on g.code = h.lot_code;

-- reaches_green(kind, code) — the scalar the costing action calls to fail closed.
-- 'farm' reaches green iff any green lot exists; lot/plot via the views above.
create or replace function reaches_green(p_target_kind text, p_target_code text)
  returns boolean
  language sql
  security invoker
  stable
  set search_path = public
as $$
  select case p_target_kind
    when 'farm' then exists (select 1 from lots where stage = 'green')
    when 'lot'  then exists (select 1 from green_reachable_lots  where code = p_target_code)
    when 'plot' then exists (select 1 from green_reachable_plots where id   = p_target_code)
    else false
  end;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 5. GRANTS (AD-8). Redefined definer RPCs keep their grants across REPLACE, but
--    re-assert fail-closed for clarity; new views + reaches_green get explicit
--    authenticated-only access; the trigger fn is never granted (owner-run only).
-- ──────────────────────────────────────────────────────────────────────────
revoke execute on function record_cherry_intake(text, text, numeric, coffee_variety, timestamptz, text, bigint, text) from public;
revoke execute on function advance_processing_stage(text, text, numeric, timestamptz, text, bigint, text) from public;
revoke execute on function reaches_green(text, text) from public;
grant  execute on function record_cherry_intake(text, text, numeric, coffee_variety, timestamptz, text, bigint, text) to authenticated;
grant  execute on function advance_processing_stage(text, text, numeric, timestamptz, text, bigint, text) to authenticated;
grant  execute on function reaches_green(text, text) to authenticated;

grant select on green_reachable_lots  to authenticated;
grant select on green_reachable_plots to authenticated;

commit;
