-- P2-S2 — Offline-first per-picker weigh capture (THE GENESIS FIELD EVENT).
--
-- The single most-used screen on the farm writes through ONE command RPC,
-- `record_weigh_in`, which produces the row that splits FOUR ways downstream:
--   1. PAY          — weigh_event.kg × the v_active_por_obra rate (S1) per day.
--   2. ATTENDANCE   — the weigh-in stamps a presence proof (a clock-in
--                     attendance_event when the picker has none yet today).
--   3. TRACEABILITY — it chains into record_cherry_intake (the Phase-1 JC-NNN
--                     minter) so a plot/day lot auto-mints + a harvests row lands,
--                     binding the kg into lot genealogy.
--   4. MILL-INTAKE  — Σ weigh_event.kg per lot is the lot's cherry mass (the
--                     v_lot_weigh_reconciliation view payroll + the mill read).
--
-- ORDERING: this migration is assigned timestamp 20260622102000 — it sorts strictly
-- above the Phase-2 head on disk (20260622100000_harvest_planning) AND above the live
-- Phase-1 head (20260621110000_phase1_review_fixes), as the schema lane requires.
--
-- SUBSTRATE REUSE (no retrofit): weigh_event reuses the EXACT lot_event hash-chain
-- idiom — a BEFORE INSERT trigger that sets prev_hash from the stream head and
-- computes extensions.digest(prev || lot_event_canonical_bytes(...), 'sha256'),
-- immutability via a no-UPDATE/DELETE block trigger + force-RLS, dual clocks
-- occurred_at/recorded_at, and device_id/device_seq/idempotency_key for causal
-- ordering + exactly-once replay through S0's offline outbox.
--
-- GEOFENCE AS A SIGNAL, NEVER A GATE: the spine stores plot geometry as GeoJSON
-- jsonb (NO PostGIS on the free tier — area/centroid are computed in TS with turf).
-- So geofence_ok is computed by a pure-SQL haversine to the plot centroid against a
-- generous radius, and it FLAGS but never rejects (signal-dead reality means GPS can
-- be stale; the Phase-1 geom_area_ha reconciliation precedent — flag, don't reject).
--
-- GRANTS (AD-8 — grant_hygiene locked default privileges): every new table/view gets
-- an explicit `grant select ... to authenticated`; the caller-facing RPC
-- `revoke execute ... from public` then `grant execute ... to authenticated`. NOTHING
-- to anon. Writes flow ONLY through record_weigh_in (no write table grant).
--
-- RLS / FARM SCOPING (flag): matches the live spine's authenticated-only posture
-- exactly — no farm_id column, no multi-tenant scoping (that lands later as P4-S0 in
-- one pass). Single-owner posture, consistent with S0/S1.

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 0a. ripeness enum — SCHEMA-TRUTH: the init migration declared a `ripeness` enum
--     but 20260620160000_write_foundation DROPPED it as "unused (no column
--     references it)". P2-S2 is the FIRST consumer — the weigh-in's one-tap ripeness
--     (underripe / ripe / overripe). So this slice (re)creates the enum it now owns,
--     guarded so a re-run is a no-op. (Matching the on-disk reality, not the DESIGN's
--     assumption that the enum still existed.)
-- ──────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'ripeness') then
    create type ripeness as enum ('underripe', 'ripe', 'overripe');
  end if;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 0. _haversine_m — great-circle metres between two lon/lat points. Pure SQL,
--    PostGIS-free (the spine has no geometry type). Used to derive geofence_ok
--    from the captured GPS fix vs the plot centroid. IMMUTABLE so it can back a
--    generated column.
-- ──────────────────────────────────────────────────────────────────────────
create or replace function _haversine_m(
  p_lat1 double precision, p_lng1 double precision,
  p_lat2 double precision, p_lng2 double precision
) returns double precision
  language sql
  immutable
as $$
  select 2 * 6371000 * asin(
    sqrt(
      power(sin(radians(p_lat2 - p_lat1) / 2), 2) +
      cos(radians(p_lat1)) * cos(radians(p_lat2)) *
      power(sin(radians(p_lng2 - p_lng1) / 2), 2)
    )
  );
$$;

-- The geofence radius (metres): a weigh-in farther than this from the claimed
-- plot's centroid is flagged geofence_ok=false. Generous on purpose — a plot is
-- larger than a point, the centroid is approximate, and GPS at 1,700 masl drifts.
-- This is a data-quality SIGNAL, never a hard limit.
create or replace function _weigh_geofence_radius_m() returns double precision
  language sql immutable as $$ select 500.0::double precision; $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. weigh_event — the append-only, hash-chained GENESIS ledger. One row per lata
--    emptied: worker + crew + geofenced plot + lot + kg + ripeness + device, with
--    the captured GPS fix and a derived geofence_ok signal.
-- ──────────────────────────────────────────────────────────────────────────
create table weigh_event (
  event_uid       uuid        primary key default gen_random_uuid(),
  idempotency_key text        unique,
  stream_key      text        not null,                  -- 'weigh:<lot_code>'
  worker_id       text        not null references workers(id),
  crew_id         text        references crews(id),       -- stamped from the worker's active crew
  plot_id         text        not null references plots(id),
  lot_code        text        not null references lots(code),
  -- kg > 0 invariant: mass conserves, never negative, never zero, never NaN. The
  -- explicit `kg <> 'NaN'` clause is load-bearing — Postgres treats `'NaN'::numeric
  -- > 0` as TRUE, so a plain `> 0` does NOT exclude NaN (which would poison every
  -- Σ-kg aggregate the mill + payroll read). This CHECK is the last-resort data-layer
  -- guard even if a future writer bypasses record_weigh_in's own guard.
  kg              numeric     not null check (kg > 0 and kg <> 'NaN'::numeric),
  ripeness        ripeness    not null,                   -- the Phase-1 enum (underripe/ripe/overripe)
  brix            numeric,                                 -- nullable (BLE/manual brix probe later)
  scale_source    text        not null default 'manual'
                    check (scale_source in ('ble','manual')),
  captured_lat    double precision,                        -- the geofence GPS fix (nullable: signal-dead)
  captured_lng    double precision,
  -- geofence_ok: a SIGNAL, not a gate. true when within radius of the plot centroid;
  -- NULL when we can't tell (no GPS fix or no plot centroid). Computed in the RPC and
  -- stored, so a read never re-derives it.
  geofence_ok     boolean,
  payload         jsonb       not null default '{}'::jsonb
                    check (octet_length(payload::text) < 4096),
  occurred_at     timestamptz not null,                    -- field wall-clock
  recorded_at     timestamptz not null default now(),      -- server accept clock
  device_id       text        not null,
  device_seq      bigint      not null,
  prev_hash       bytea,
  hash            bytea,
  unique (device_id, device_seq)                           -- replay safety
);
create index weigh_event_worker_idx on weigh_event (worker_id, occurred_at);
create index weigh_event_lot_idx    on weigh_event (lot_code);
create index weigh_event_plot_idx   on weigh_event (plot_id, occurred_at);
create index weigh_event_stream_idx on weigh_event (stream_key, device_seq);

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Hash chain — reuse lot_event_canonical_bytes (on disk, immutable). The chain
--    head is per-stream (weigh:<lot_code>) so each lot's weigh stream is its own
--    tamper-evident chain.
-- ──────────────────────────────────────────────────────────────────────────
create or replace function weigh_event_set_hash() returns trigger
  language plpgsql
  set search_path = public, extensions
as $$
declare head bytea;
begin
  select e.hash into head
    from weigh_event e
   where e.stream_key = new.stream_key
   order by e.device_seq desc
   limit 1;
  new.prev_hash := head;
  new.hash := extensions.digest(
    coalesce(new.prev_hash, ''::bytea)
      || lot_event_canonical_bytes(new.stream_key, 'weigh', new.payload,
                                   new.occurred_at, new.device_id, new.device_seq),
    'sha256'
  );
  return new;
end $$;

create trigger weigh_event_set_hash
  before insert on weigh_event
  for each row execute function weigh_event_set_hash();

-- Append-only: block ALL update/delete (correct only with a reversing/superseding
-- event, never by mutating history). Belt-and-braces with force-RLS + no write grant.
create or replace function weigh_event_block_mutation() returns trigger
  language plpgsql
as $$
begin
  raise exception 'weigh_event is append-only and immutable (% blocked)', tg_op
    using errcode = 'restrict_violation';
end $$;

create trigger weigh_event_block_mutation
  before update or delete on weigh_event
  for each row execute function weigh_event_block_mutation();

-- ──────────────────────────────────────────────────────────────────────────
-- 3. record_weigh_in — THE FIELD WRITE DOOR. One SECURITY DEFINER txn, idempotent
--    on idempotency_key, accepting the S0 client-minted device_id/device_seq/key.
--    It:
--      (a) validates the worker is an ACTIVE crew member (S1 crew_memberships);
--      (b) find-or-mints the plot/day lot via record_cherry_intake (TRACEABILITY) —
--          the first weigh-in of a plot+day mints a JC-NNN lot; later weigh-ins of
--          the same plot+day reuse it, so a lot is a plot-day's cherry intake;
--      (c) appends a harvests row (the Phase-1 harvest spine sees the kg);
--      (d) stamps a presence proof (ATTENDANCE: a clock-in attendance_event when the
--          worker has none today);
--      (e) appends the weigh_event (the genesis row — PAY + MILL-INTAKE read it),
--          computing geofence_ok as a signal.
--    Returns the minted/lookup lot_code.
-- ──────────────────────────────────────────────────────────────────────────
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
  existing_lot text;
  v_lot        text;
  v_crew       text;
  v_variety    coffee_variety;
  v_centroid   jsonb;
  v_geofence   boolean;
  v_day        date := (p_occurred_at at time zone 'UTC')::date;
  v_intake_seq bigint;
  v_dist       double precision;
  v_inserted   text;       -- the idempotency_key the weigh_event INSERT actually landed
begin
  -- CONCURRENCY: this whole RPC is a non-atomic check-then-act (dedup SELECT, then
  -- find-or-mint, then unconditional side-effects). Under the READ COMMITTED isolation
  -- PostgREST/Supabase uses, two concurrent same-key calls (an offline-outbox replay
  -- racing the original on two serverless instances) could BOTH pass the dedup SELECT
  -- and BOTH apply the mass/today_kg deltas while only ONE weigh_event lands —
  -- doubling lots.origin_kg/current_kg (the MILL-INTAKE + COGS + oversell-cap number)
  -- and workers.today_kg. A transaction-scoped advisory lock keyed on the idempotency
  -- key serializes same-key callers: the loser BLOCKS until the winner commits, then
  -- its dedup SELECT below SEES the committed weigh_event and returns early before any
  -- write. Core PostgreSQL, no extension, auto-released at txn end ($0/free-tier safe).
  -- (hashtext returns int4 → cast to bigint for the one-arg lock form.)
  perform pg_advisory_xact_lock(hashtext('weigh:' || p_idempotency_key)::bigint);

  -- exactly-once: a replay (queued retry or double-tap) returns the lot it bound to
  -- and writes NOTHING a second time.
  select lot_code into existing_lot from weigh_event where idempotency_key = p_idempotency_key;
  if existing_lot is not null then
    return existing_lot;
  end if;

  -- kg > 0 invariant (no negative / zero / NaN / Inf). The RPC is the SSOT write door
  -- (granted to authenticated), so it rejects bad kg ITSELF with a friendly message —
  -- not by leaking the deep harvests_cherries_pos constraint name to the field. The
  -- explicit `= 'NaN'` test is load-bearing: `'NaN'::numeric > 0` is TRUE in Postgres,
  -- so `not (p_cherries_kg > 0)` alone would NOT catch NaN.
  if p_cherries_kg is null
     or p_cherries_kg = 'NaN'::numeric
     or not (p_cherries_kg > 0)
     or p_cherries_kg = 'Infinity'::numeric then
    raise exception 'cherries_kg must be > 0' using errcode = 'check_violation';
  end if;

  -- (a) the worker must be an ACTIVE crew member — you weigh against a real picker on
  -- a real crew. crew_id stamps the event for the per-crew tally.
  select m.crew_id into v_crew
    from crew_memberships m
   where m.worker_id = p_worker_id and m.left_at is null
   limit 1;
  if v_crew is null then
    raise exception 'worker % is not an active crew member', p_worker_id
      using errcode = 'check_violation';
  end if;

  -- the plot must exist (FK would catch it, but a clear message helps the field).
  select variety, centroid into v_variety, v_centroid from plots where id = p_plot_id;
  if v_variety is null then
    raise exception 'unknown plot %', p_plot_id using errcode = 'foreign_key_violation';
  end if;

  -- (b) find-or-mint the plot/day lot (TRACEABILITY). The day's first weigh-in of a
  -- plot mints a JC-NNN cherry lot via the Phase-1 minter; subsequent weigh-ins reuse
  -- it. The intake carries its OWN idempotency_key + a server-minted device_seq so it
  -- never collides with the weigh_event's own (device_id, device_seq) on lot_event.
  --
  -- CONCURRENCY (orphan-lot race): the find-or-mint is itself a non-atomic
  -- check-then-act with no UNIQUE(plot_id, day) on lots. Two concurrent FIRST-weighs of
  -- the SAME plot+day (different idempotency keys, so the dedup lock above doesn't
  -- serialize them) would both see no committed weigh_event and both enter the mint
  -- branch — minting TWO lots via distinct lot_code_seq values, the second an orphan
  -- with no genesis lot_event (record_lot_event's ON CONFLICT DO NOTHING swallows the
  -- shared intake key). A plot+day advisory lock serializes the minters: the loser
  -- blocks, then sees the winner's committed weigh_event and reuses its lot.
  perform pg_advisory_xact_lock(hashtext('weigh-intake:' || p_plot_id || ':' || v_day::text)::bigint);

  -- Reuse the plot+day lot ONLY while it is still 'cherry'. If the morning lot was
  -- advanced (e.g. to fermentation/drying) mid-day, a late weigh must NOT grow that
  -- now-processing lot (current_kg is monotonically non-increasing through processing)
  -- nor append a harvest to a non-cherry lot — it falls through to mint a FRESH cherry
  -- lot for the late intake, which is the correct traceability node.
  select we.lot_code into v_lot
    from weigh_event we
    join lots l on l.code = we.lot_code
   where we.plot_id = p_plot_id
     and (we.occurred_at at time zone 'UTC')::date = v_day
     and l.stage = 'cherry'
   order by we.recorded_at asc
   limit 1;

  if v_lot is null then
    -- FIRST (or late, post-advance) weigh-in that has no ACTIVE cherry lot for this
    -- plot+day: mint a fresh cherry lot via the Phase-1 minter, which ALSO writes the
    -- origin harvests row ('h-<lot>') for these kg (pipeline_fixes CRIT-2). So we do
    -- NOT add a second harvest here — the intake covered it.
    --
    -- The intake idempotency key is derived from THIS weigh-in's own exactly-once
    -- anchor (p_idempotency_key), NOT the plot+day. A plot+day key would resolve a late
    -- weigh's mint back to an already-advanced morning lot (the minter's own idempotency
    -- check returns the existing lot for a repeated key), re-inflating a processing lot.
    -- The weigh key is stable across replays (the dedup SELECT above already returns
    -- before this branch on a replay), so first-weigh mint stays idempotent.
    v_intake_seq := nextval('worker_server_seq');
    v_lot := record_cherry_intake(
      p_plot_id, p_worker_id, p_cherries_kg, v_variety,
      p_occurred_at, 'server', v_intake_seq,
      'weigh-intake:' || p_idempotency_key
    );
  else
    -- SUBSEQUENT weigh-in: grow the existing plot/day lot's cherry mass so Σ kg
    -- reconciles to the lot's origin/current kg (MILL-INTAKE conservation), AND add a
    -- per-picker harvests row so this picker's contribution is its own traceable node
    -- (the minter only wrote the FIRST picker's origin harvest).
    update lots
       set origin_kg  = coalesce(origin_kg, 0)  + p_cherries_kg,
           current_kg = coalesce(current_kg, 0) + p_cherries_kg
     where code = v_lot;

    -- (c) the per-picker harvests row — the Phase-1 traceability spine. ripeness_pct
    -- is a coarse numeric projection of the ripeness tap (underripe~40 / ripe~95 /
    -- overripe~70); the precise ripeness lives on weigh_event.
    insert into harvests (id, date, plot_id, worker_id, cherries_kg, ripeness_pct, brix_avg, lot_code)
    values (
      'wh-' || p_idempotency_key, v_day, p_plot_id, p_worker_id, p_cherries_kg,
      case p_ripeness when 'underripe' then 40 when 'overripe' then 70 else 95 end,
      coalesce(p_brix, 0), v_lot
    )
    on conflict (id) do nothing;
  end if;

  -- (d) ATTENDANCE presence proof — a weigh-in proves the picker was here. Stamp a
  -- clock-in attendance_event if they have none today (idempotent; a later weigh-in
  -- the same day is a no-op presence-wise). Reuses the S1 attendance ledger so the
  -- presence is one append-only chain, not a parallel record.
  if not exists (
    select 1 from attendance_event
     where worker_id = p_worker_id and event_kind = 'clock-in'
       and (occurred_at at time zone 'UTC')::date = v_day
  ) then
    insert into attendance_event (idempotency_key, stream_key, worker_id, crew_id,
                                  event_kind, plot_id, occurred_at, device_id, device_seq)
    values ('weigh-clockin:' || p_worker_id || ':' || v_day::text,
            'attendance:' || p_worker_id, p_worker_id, v_crew,
            'clock-in', p_plot_id, p_occurred_at, 'server', nextval('worker_server_seq'))
    on conflict (idempotency_key) do nothing;
    perform _resync_worker_attendance(p_worker_id);
  end if;

  -- geofence_ok SIGNAL — distance from the captured fix to the plot centroid. NULL
  -- when we can't tell (no GPS fix, or the plot has no centroid). NEVER a gate.
  if p_captured_lat is not null and p_captured_lng is not null
     and v_centroid is not null and v_centroid ? 'coordinates' then
    v_dist := _haversine_m(
      p_captured_lat, p_captured_lng,
      (v_centroid -> 'coordinates' ->> 1)::double precision,   -- centroid lat (GeoJSON [lng,lat])
      (v_centroid -> 'coordinates' ->> 0)::double precision    -- centroid lng
    );
    v_geofence := v_dist <= _weigh_geofence_radius_m();
  else
    v_geofence := null;
  end if;

  -- (e) the genesis weigh_event (PAY + MILL-INTAKE read it). Append-only, hash-chained.
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

  -- keep the picker's denormalized today_kg in step (Phase-1 read; derived). GATED on
  -- the weigh_event INSERT actually landing THIS txn (v_inserted not null): if a
  -- concurrent same-key call slipped past the dedup SELECT and this INSERT no-op'd on
  -- conflict, today_kg must NOT be incremented a second time (defense-in-depth with the
  -- advisory lock above, which already serializes same-key callers).
  if v_inserted is not null then
    update workers set today_kg = coalesce(today_kg, 0) + p_cherries_kg where id = p_worker_id;
  end if;

  return v_lot;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Read views (security_invoker so base-table RLS governs the caller).
-- ──────────────────────────────────────────────────────────────────────────

-- v_weigh_today_by_picker — today's running tally per picker (the <3s screen's
-- per-picker total + lata count). Drives the on-screen confirmation tally.
create view v_weigh_today_by_picker with (security_invoker = on) as
  select w.worker_id,
         wk.name,
         w.crew_id,
         count(*)::int                          as lata_count,
         sum(w.kg)::numeric                      as kg_today,
         max(w.occurred_at)                      as last_weigh_at
    from weigh_event w
    join workers wk on wk.id = w.worker_id
   where (w.occurred_at at time zone 'UTC')::date = (now() at time zone 'UTC')::date
   group by w.worker_id, wk.name, w.crew_id;

-- v_weigh_today_by_plot — today's totals per plot (which plots are being picked,
-- how much). Reads straight off the genesis ledger.
create view v_weigh_today_by_plot with (security_invoker = on) as
  select w.plot_id,
         p.name                                 as plot_name,
         count(*)::int                          as lata_count,
         sum(w.kg)::numeric                      as kg_today,
         bool_and(coalesce(w.geofence_ok, true)) as all_geofence_ok
    from weigh_event w
    join plots p on p.id = w.plot_id
   where (w.occurred_at at time zone 'UTC')::date = (now() at time zone 'UTC')::date
   group by w.plot_id, p.name;

-- v_weigh_by_lot — Σ kg per lot from the genesis ledger (MILL-INTAKE). The number the
-- mill + payroll read; reconciles to lots.origin_kg (the conservation invariant).
create view v_weigh_by_lot with (security_invoker = on) as
  select w.lot_code,
         count(*)::int     as lata_count,
         sum(w.kg)::numeric as weigh_kg,
         l.origin_kg
    from weigh_event w
    join lots l on l.code = w.lot_code
   group by w.lot_code, l.origin_kg;

-- v_lot_weigh_reconciliation — proves kg conserves: Σ weigh_event.kg for a lot equals
-- its lots.origin_kg. `reconciles` is the SIGNAL the UI surfaces.
create view v_lot_weigh_reconciliation with (security_invoker = on) as
  select w.lot_code,
         sum(w.kg)::numeric                              as weigh_kg,
         l.origin_kg,
         (abs(coalesce(sum(w.kg),0) - coalesce(l.origin_kg,0)) < 0.0001) as reconciles
    from weigh_event w
    join lots l on l.code = w.lot_code
   group by w.lot_code, l.origin_kg;

-- ──────────────────────────────────────────────────────────────────────────
-- 5. RLS — authenticated-only read; the genesis ledger forces RLS and gets NO write
--    policy (immutability at the policy layer too, mirroring lot_event).
-- ──────────────────────────────────────────────────────────────────────────
alter table weigh_event enable row level security;
create policy "authenticated read" on weigh_event for select to authenticated using (true);
alter table weigh_event force row level security;

-- ──────────────────────────────────────────────────────────────────────────
-- 6. GRANTS (AD-8). SELECT to authenticated on the table + views; EXECUTE on the
--    caller-facing RPC (revoke public first). NOTHING to anon; the haversine/radius
--    helpers and the trigger fns get NO grant (internal).
-- ──────────────────────────────────────────────────────────────────────────
grant select on weigh_event                    to authenticated;
grant select on v_weigh_today_by_picker        to authenticated;
grant select on v_weigh_today_by_plot          to authenticated;
grant select on v_weigh_by_lot                 to authenticated;
grant select on v_lot_weigh_reconciliation     to authenticated;

revoke execute on function record_weigh_in(text, text, numeric, ripeness, numeric, text, double precision, double precision, timestamptz, text, bigint, text) from public;
revoke execute on function _haversine_m(double precision, double precision, double precision, double precision) from public;
revoke execute on function _weigh_geofence_radius_m()    from public;
revoke execute on function weigh_event_set_hash()        from public;
revoke execute on function weigh_event_block_mutation()  from public;

grant execute on function record_weigh_in(text, text, numeric, ripeness, numeric, text, double precision, double precision, timestamptz, text, bigint, text) to authenticated;

commit;
