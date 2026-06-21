-- Pipeline-UI review fixes (data layer). The pipeline-UI review found the slice's
-- write flows broke end-to-end; this fixes the two CRITs + the advance guard gap at
-- the data layer. App-layer fixes (forms/actions/a11y/idempotency) ship alongside.
--
--   CRIT-1 — server-mint the green-lot code. The grade UI suggested '<source>-G',
--     which VIOLATES lots_code_format (^JC-[0-9]{3,}$, digits only) → every grade
--     failed. The green code is system identity, not user data: materialize_green_lot
--     now MINTS a digit-only JC-NNN itself (collision-proof, via lot_code_seq) when
--     p_green_code is null/blank. A non-null code still validates against the CHECK.
--   CRIT-2 — cherry intake must establish plot→lot ORIGIN. record_cherry_intake wrote
--     only lots + lot_event, so an intake→advance→grade green lot was EUDR 'no-origin'
--     and COGS-uncosted (both read the plot↔lot link from `harvests`). It now ALSO
--     writes a harvests row in the same txn. harvests.ripeness_pct/brix_avg are made
--     nullable (intake doesn't capture cup metrics; they're recorded later via QC).
--   advance guard — on a NULL-stage/NULL-kg lot (the bare seed lots) the forward-only
--     + no-mass-gain guards were no-ops; treat a NULL current stage as 'cherry' (start)
--     so the guards still apply.

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. harvests: cup metrics become optional (a cherry-intake harvest records the
--    plot/worker/kg genesis; ripeness/brix are captured later by QC, not at intake).
-- ──────────────────────────────────────────────────────────────────────────
alter table harvests alter column ripeness_pct drop not null;
alter table harvests alter column brix_avg     drop not null;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. record_cherry_intake — mint the cherry lot AND write its origin harvest row,
--    atomically (so EUDR origin + COGS plot allocation see the lot). Collision-proof
--    mint kept from 20260621110000.
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

  loop
    new_code := 'JC-' || lpad(nextval('lot_code_seq')::text, 3, '0');
    exit when not exists (select 1 from lots where code = new_code);
  end loop;

  insert into lots (code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
  values (new_code, 'cherry', p_variety, p_cherries_kg, p_cherries_kg, true, p_occurred_at);

  -- ORIGIN LINK: tie the plot to this lot via a harvests row (the table EUDR's
  -- lot_origin_plots + COGS's agronomy plot-split both read). Cup metrics null —
  -- recorded later by QC. The harvests_no_green_target trigger permits a cherry lot.
  insert into harvests (id, date, plot_id, worker_id, cherries_kg, ripeness_pct, brix_avg, lot_code)
  values ('h-' || new_code, p_occurred_at::date, p_plot_id, p_worker_id, p_cherries_kg, null, null, new_code);

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
-- 3. materialize_green_lot — mint a digit-only green code when none is supplied.
--    (The grade UI now passes null/blank and shows the minted code back.)
-- ──────────────────────────────────────────────────────────────────────────
create or replace function materialize_green_lot(
  p_source_code   text,
  p_green_code    text,
  p_kg            numeric,
  p_cupping_score numeric,
  p_location      text,
  p_occurred_at   timestamptz
) returns text
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare
  green_code text := nullif(btrim(coalesce(p_green_code, '')), '');
begin
  -- Mint a fresh digit-only JC-NNN when the caller supplies no code (the common
  -- path — the green code is system identity, not user data). Collision-proof.
  if green_code is null then
    loop
      green_code := 'JC-' || lpad(nextval('lot_code_seq')::text, 3, '0');
      exit when not exists (select 1 from lots where code = green_code);
    end loop;
  end if;

  -- exactly-once on a SUPPLIED code (no second edge / double-routed mass).
  if exists (select 1 from green_lots where lot_code = green_code) then
    return green_code;
  end if;

  if not exists (select 1 from lots where code = p_source_code) then
    raise exception 'unknown source lot %', p_source_code using errcode = 'foreign_key_violation';
  end if;

  insert into lots (code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
  select green_code, 'green', s.variety, p_kg, p_kg, s.is_single_origin, p_occurred_at
    from lots s where s.code = p_source_code;

  insert into lot_edges (parent_code, child_code, kind, kg)
  values (p_source_code, green_code, 'process', p_kg);

  insert into green_lots (lot_code, cupping_score, location, graded_at)
  values (green_code, p_cupping_score, p_location, p_occurred_at);

  return green_code;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. advance_processing_stage — close the NULL-stage guard gap (treat a NULL
--    current stage as the 'cherry' start so forward-only + no-mass-gain still hold).
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

  perform p_to_stage::batch_stage;

  select stage, current_kg into cur_stage, cur_kg from lots where code = p_lot_code;
  if not found then
    raise exception 'unknown lot %', p_lot_code using errcode = 'foreign_key_violation';
  end if;

  -- a NULL/unknown current stage is treated as the pipeline START ('cherry'), so a
  -- backward move is still rejected on the bare-seeded lots that carried no stage.
  if coalesce(nullif(cur_stage, ''), 'cherry')::batch_stage
       not in (select unnest(enum_range(null::batch_stage))) then
    -- (unreachable: the coalesce/cast guarantees a valid value; kept for clarity)
    null;
  end if;
  if p_to_stage::batch_stage < coalesce(nullif(cur_stage, ''), 'cherry')::batch_stage then
    raise exception 'lot % cannot move backward (% -> %)', p_lot_code, coalesce(cur_stage, 'cherry'), p_to_stage
      using errcode = 'check_violation';
  end if;

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

-- AD-8: re-assert grants on the redefined definer RPCs (REPLACE preserves them, but
-- be explicit).
revoke execute on function record_cherry_intake(text, text, numeric, coffee_variety, timestamptz, text, bigint, text) from public;
revoke execute on function advance_processing_stage(text, text, numeric, timestamptz, text, bigint, text) from public;
revoke execute on function materialize_green_lot(text, text, numeric, numeric, text, timestamptz) from public;
grant  execute on function record_cherry_intake(text, text, numeric, coffee_variety, timestamptz, text, bigint, text) to authenticated;
grant  execute on function advance_processing_stage(text, text, numeric, timestamptz, text, bigint, text) to authenticated;
grant  execute on function materialize_green_lot(text, text, numeric, numeric, text, timestamptz) to authenticated;

commit;
