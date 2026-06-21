-- P2-S6 — QC & cupping: SCA CVA (2023) + legacy 100-pt sessions, append-only cup
-- scores, a green-grading defect ledger, cupper-drift calibration, and the QC-HOLD
-- quarantine that BLOCKS a held green lot from being reserved or shipped.
--
-- This slice extends the MAKE-QUALITY trunk past Phase-1's `green_lots`. It honors
-- the two Phase-1 facts every Phase-2 migration inherits (verified on disk):
--
--   * grant_hygiene locked default privileges → EVERY new table/view here gets an
--     explicit `grant select … to authenticated` (or it returns zero rows), and
--     EVERY caller-facing SECURITY DEFINER RPC FIRST `revoke execute … from public`
--     (Postgres grants PUBLIC EXECUTE by default — the exact hole that let anon mint
--     in S3) THEN `grant execute … to authenticated`. Nothing is granted to `anon`.
--   * The write door is the command RPC — a `SECURITY DEFINER` txn with
--     `set search_path = public, extensions`, idempotent on its `idempotency_key`.
--     Internal trigger fns are named with a leading underscore so the AD-8 static
--     guard (migration-grants.db.test.ts) treats them as owner-only, not RPCs.
--
-- THE TEETH (the load-bearing P2-S6 invariant): a green lot under an OPEN qc_hold
-- CANNOT be reserved or shipped. Enforced by EXTENDING the Phase-1 prevent_oversell
-- trigger family with a SECOND fail-closed `_prevent_held_lot_commit` BEFORE INSERT
-- trigger on `lot_reservations`/`lot_shipments` (the EUDR `issue_dds` fail-closed
-- precedent). The disabled UI button is courtesy; the gate is in the database.
--
-- APPEND-ONLY EVERYWHERE quality is involved: cup scores, defects, and holds are
-- ledgers — no client UPDATE/DELETE path (no UPDATE/DELETE grant + a block trigger),
-- corrected only by superseding rows / a release event, never by mutating history.
--
-- CUP-TO-CAUSE: every session binds back through `green_lot_code` (→ green_lots →
-- the lot graph), so a score is forever attributable to the ferment/drying/plot that
-- produced it (those stages' data ship in sibling slices; this slice degrades
-- gracefully when they are absent — it only requires the green lot to exist).

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. cupping_sessions — one cupping of a green lot under a protocol by a cupper.
--    `protocol` distinguishes the 2023 SCA CVA affective scale from the legacy
--    100-point scoresheet; `is_calibration` flags a SHARED calibration sample the
--    cupper-drift view measures bias against. cupper_id → workers.id (text PK).
-- ──────────────────────────────────────────────────────────────────────────
create table cupping_sessions (
  id              bigint generated always as identity primary key,
  green_lot_code  text        not null references green_lots(lot_code),
  cupper_id       text        not null references workers(id),
  protocol        text        not null check (protocol in ('sca-cva','legacy-100')),
  is_calibration  boolean     not null default false,
  occurred_at     timestamptz not null,                  -- field wall-clock (D5)
  recorded_at     timestamptz not null default now(),    -- server accept clock (D5)
  device_id       text        not null,
  device_seq      bigint      not null,
  idempotency_key text        unique,                     -- exactly-once (D4)
  unique (device_id, device_seq)
);
create index cupping_sessions_lot_idx    on cupping_sessions(green_lot_code);
create index cupping_sessions_cupper_idx on cupping_sessions(cupper_id);

-- ──────────────────────────────────────────────────────────────────────────
-- 2. cupping_scores — APPEND-ONLY per-attribute score ledger, bound to a session.
--    A score is evidence bound to a lot forever (no UPDATE/DELETE). The 0–100
--    range CHECK covers BOTH protocols (CVA attributes 0–10, legacy attributes
--    0–10, the legacy clean-cup/uniformity/sweetness up to 10) without rejecting a
--    legal value; a stricter per-protocol bound lives in the pure scoring math.
-- ──────────────────────────────────────────────────────────────────────────
create table cupping_scores (
  id              bigint generated always as identity primary key,
  session_id      bigint      not null references cupping_sessions(id),
  attribute       text        not null,
  score           numeric     not null check (score >= 0 and score <= 100),
  recorded_at     timestamptz not null default now(),
  device_id       text        not null,
  device_seq      bigint      not null,
  idempotency_key text        unique,
  unique (device_id, device_seq)
);
create index cupping_scores_session_idx on cupping_scores(session_id);

-- ──────────────────────────────────────────────────────────────────────────
-- 3. green_defects — APPEND-ONLY green-grading defect ledger keyed to a green lot,
--    banded primary/secondary. Feeds the Phase-1 generated `green_lots.sca_grade`
--    indirectly (QC supplies the real defect input the family reads alongside it).
-- ──────────────────────────────────────────────────────────────────────────
create table green_defects (
  id              bigint generated always as identity primary key,
  green_lot_code  text        not null references green_lots(lot_code),
  defect_kind     text        not null,
  count           integer     not null check (count >= 0),
  category        text        not null check (category in ('primary','secondary')),
  occurred_at     timestamptz not null default now(),
  recorded_at     timestamptz not null default now(),
  device_id       text        not null,
  device_seq      bigint      not null,
  idempotency_key text        unique,
  unique (device_id, device_seq)
);
create index green_defects_lot_idx on green_defects(green_lot_code);

-- ──────────────────────────────────────────────────────────────────────────
-- 4. qc_holds — APPEND-ONLY quarantine ledger. A row with released_at IS NULL is
--    an OPEN hold; releasing stamps released_at via the release RPC (never a
--    client UPDATE). The open-hold predicate is what blocks commerce.
-- ──────────────────────────────────────────────────────────────────────────
create table qc_holds (
  id              bigint generated always as identity primary key,
  green_lot_code  text        not null references green_lots(lot_code),
  reason          text        not null,
  placed_at       timestamptz not null default now(),
  placed_by       text        not null,                  -- device/actor that placed it
  released_at     timestamptz,                           -- null => OPEN (blocks commerce)
  released_by     text,
  device_id       text        not null,
  device_seq      bigint      not null,
  idempotency_key text        unique,
  unique (device_id, device_seq),
  -- a released hold must carry its release clock (and vice-versa) — no half states.
  check ((released_at is null) = (released_by is null))
);
create index qc_holds_lot_idx       on qc_holds(green_lot_code);
-- the hot predicate the commerce gate runs: open holds per lot.
create index qc_holds_open_idx      on qc_holds(green_lot_code) where released_at is null;

-- ──────────────────────────────────────────────────────────────────────────
-- 5. Append-only immutability — a single shared block trigger fn (owner-only;
--    leading underscore => the AD-8 static guard skips it as an internal helper)
--    rejects every UPDATE/DELETE on the score/defect/hold ledgers. The release
--    RPC mutates qc_holds as the DEFINER owner, so it must run while this guard is
--    OFF for that one statement → instead, the release RPC INSERTs the released
--    state by stamping the row through a guarded owner path: we keep holds truly
--    append-only by recording the release as a *column stamp performed by the RPC*
--    BEFORE the block trigger is installed for client paths. To keep it simple and
--    bullet-proof, the block trigger fires for EVERYONE (even the owner) and the
--    release RPC sidesteps it by toggling session_replication_role — but that is
--    fragile. We instead allow the DEFINER release to UPDATE released_at ONLY, via
--    a WHEN clause that blocks any change OTHER than setting a NULL released_at.
-- ──────────────────────────────────────────────────────────────────────────

-- Block ALL update/delete on the pure-evidence ledgers (scores, defects).
create or replace function _qc_block_mutation() returns trigger
  language plpgsql
as $$
begin
  raise exception '% is append-only and immutable (% blocked)', tg_table_name, tg_op
    using errcode = 'restrict_violation';
end $$;

create trigger cupping_scores_block_mutation
  before update or delete on cupping_scores
  for each row execute function _qc_block_mutation();

create trigger green_defects_block_mutation
  before update or delete on green_defects
  for each row execute function _qc_block_mutation();

-- qc_holds: DELETE is always blocked; UPDATE is allowed ONLY to stamp a release on
-- an open hold (released_at NULL→non-null, released_by NULL→non-null), never to
-- re-open, re-key, or alter any other column. This keeps the ledger append-only in
-- spirit (a hold is placed once and released once; history is preserved) while the
-- release RPC can close it. Any client without an UPDATE grant still cannot reach
-- this path — the grant posture (INSERT-only) is the outer wall; this is the inner.
create or replace function _qc_holds_guard_mutation() returns trigger
  language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'qc_holds is append-only (DELETE blocked)'
      using errcode = 'restrict_violation';
  end if;
  -- UPDATE: only a one-way release stamp is legal.
  if old.released_at is not null then
    raise exception 'qc_holds % is already released; re-opening is not allowed', old.id
      using errcode = 'restrict_violation';
  end if;
  if  new.green_lot_code is distinct from old.green_lot_code
   or new.reason         is distinct from old.reason
   or new.placed_at      is distinct from old.placed_at
   or new.placed_by      is distinct from old.placed_by
   or new.device_id      is distinct from old.device_id
   or new.device_seq     is distinct from old.device_seq then
    raise exception 'qc_holds is append-only; only a release stamp may be applied'
      using errcode = 'restrict_violation';
  end if;
  if new.released_at is null then
    raise exception 'a qc_holds update must stamp a release (released_at)'
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

create trigger qc_holds_guard_mutation
  before update or delete on qc_holds
  for each row execute function _qc_holds_guard_mutation();

-- ──────────────────────────────────────────────────────────────────────────
-- 6. THE TEETH — `_prevent_held_lot_commit`: fail-closed BEFORE INSERT on BOTH
--    claim tables (extending the Phase-1 prevent_oversell family). A reservation
--    or shipment against a green lot with ANY open qc_hold is physically rejected.
--    Releasing the hold re-opens commerce. Owner-only trigger fn (leading
--    underscore — not a caller-facing RPC).
-- ──────────────────────────────────────────────────────────────────────────
create or replace function _prevent_held_lot_commit() returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  if exists (
    select 1 from qc_holds
     where green_lot_code = new.green_lot_code
       and released_at is null
  ) then
    raise exception
      'qc-hold: green lot % is under an open QC-HOLD and cannot be reserved or shipped',
      new.green_lot_code
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger lot_reservations_prevent_held_commit
  before insert on lot_reservations
  for each row execute function _prevent_held_lot_commit();

create trigger lot_shipments_prevent_held_commit
  before insert on lot_shipments
  for each row execute function _prevent_held_lot_commit();

-- ──────────────────────────────────────────────────────────────────────────
-- 7. Read views (security_invoker → inherit the caller's RLS on base tables).
-- ──────────────────────────────────────────────────────────────────────────

-- v_cup_final_score — the protocol-correct total per session. BOTH the SCA CVA
-- affective scale and the legacy 100-pt scoresheet are ADDITIVE over their
-- attribute rows, so the final is the sum of the session's scores (the per-protocol
-- attribute set / rounding nuance lives in the pure cva-scoring.ts the UI uses; the
-- DB view is the authoritative additive total over whatever attributes were logged).
create view v_cup_final_score with (security_invoker = on) as
  select
    s.id              as session_id,
    s.green_lot_code,
    s.cupper_id,
    s.protocol,
    s.is_calibration,
    coalesce(sum(c.score), 0)::numeric as final_score,
    count(c.id)::int                   as attribute_count
  from cupping_sessions s
  left join cupping_scores c on c.session_id = s.id
  group by s.id, s.green_lot_code, s.cupper_id, s.protocol, s.is_calibration;

-- v_cupper_drift — each cupper's systematic bias on SHARED calibration samples:
-- their mean score per attribute MINUS the panel mean per attribute, over
-- is_calibration sessions only. A consistent +N surfaces as evidence (never a hard
-- block — you correct for known drift, you don't reject a cupper's score).
create view v_cupper_drift with (security_invoker = on) as
  with cal as (
    select s.cupper_id, c.attribute, c.score
      from cupping_sessions s
      join cupping_scores  c on c.session_id = s.id
     where s.is_calibration = true
  ),
  panel as (
    select attribute, avg(score) as panel_mean
      from cal group by attribute
  )
  select
    cal.cupper_id,
    cal.attribute,
    avg(cal.score)::numeric                         as cupper_mean,
    panel.panel_mean::numeric                       as panel_mean,
    (avg(cal.score) - panel.panel_mean)::numeric    as drift,
    count(*)::int                                   as sample_n
  from cal
  join panel on panel.attribute = cal.attribute
  group by cal.cupper_id, cal.attribute, panel.panel_mean;

-- v_qc_status — the per-lot QC roll-up the UI banner + table read: is the lot held,
-- the open hold's reason, its latest cup final, and its defect tallies. One row per
-- green lot that has any QC activity OR an existing green_lots row.
create view v_qc_status with (security_invoker = on) as
  select
    g.lot_code                                          as green_lot_code,
    exists (
      select 1 from qc_holds h
       where h.green_lot_code = g.lot_code and h.released_at is null
    )                                                   as held,
    (
      select h.reason from qc_holds h
       where h.green_lot_code = g.lot_code and h.released_at is null
       order by h.placed_at desc limit 1
    )                                                   as hold_reason,
    (
      select f.final_score from v_cup_final_score f
       join cupping_sessions s2 on s2.id = f.session_id
       where f.green_lot_code = g.lot_code
       order by s2.occurred_at desc limit 1
    )                                                   as latest_cup_score,
    coalesce((
      select sum(d.count) from green_defects d
       where d.green_lot_code = g.lot_code and d.category = 'primary'
    ), 0)::int                                          as primary_defects,
    coalesce((
      select sum(d.count) from green_defects d
       where d.green_lot_code = g.lot_code and d.category = 'secondary'
    ), 0)::int                                          as secondary_defects
  from green_lots g;

-- ──────────────────────────────────────────────────────────────────────────
-- 8. Command RPCs (ADR-002) — SECURITY DEFINER, pinned search_path, idempotent on
--    idempotency_key, EXECUTE to authenticated only.
-- ──────────────────────────────────────────────────────────────────────────

-- record_cupping_session — open a cupping session; returns its id (idempotent).
create or replace function record_cupping_session(
  p_green_lot_code  text,
  p_cupper_id       text,
  p_protocol        text,
  p_is_calibration  boolean,
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
  existing bigint;
  new_id   bigint;
begin
  select id into existing from cupping_sessions where idempotency_key = p_idempotency_key;
  if existing is not null then
    return existing;                          -- exactly-once replay
  end if;
  insert into cupping_sessions
    (green_lot_code, cupper_id, protocol, is_calibration,
     occurred_at, device_id, device_seq, idempotency_key)
  values
    (p_green_lot_code, p_cupper_id, p_protocol, coalesce(p_is_calibration, false),
     p_occurred_at, p_device_id, p_device_seq, p_idempotency_key)
  on conflict (idempotency_key) do nothing
  returning id into new_id;
  if new_id is null then
    select id into new_id from cupping_sessions where idempotency_key = p_idempotency_key;
  end if;
  return new_id;
end $$;

-- record_cup_score — append one attribute score to a session (idempotent).
create or replace function record_cup_score(
  p_session_id      bigint,
  p_attribute       text,
  p_score           numeric,
  p_device_id       text,
  p_device_seq      bigint,
  p_idempotency_key text
) returns bigint
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare
  existing bigint;
  new_id   bigint;
begin
  select id into existing from cupping_scores where idempotency_key = p_idempotency_key;
  if existing is not null then
    return existing;
  end if;
  insert into cupping_scores (session_id, attribute, score, device_id, device_seq, idempotency_key)
  values (p_session_id, p_attribute, p_score, p_device_id, p_device_seq, p_idempotency_key)
  on conflict (idempotency_key) do nothing
  returning id into new_id;
  if new_id is null then
    select id into new_id from cupping_scores where idempotency_key = p_idempotency_key;
  end if;
  return new_id;
end $$;

-- record_defect — append one defect tally to a green lot (idempotent).
create or replace function record_defect(
  p_green_lot_code  text,
  p_defect_kind     text,
  p_count           integer,
  p_category        text,
  p_device_id       text,
  p_device_seq      bigint,
  p_idempotency_key text
) returns bigint
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare
  existing bigint;
  new_id   bigint;
begin
  select id into existing from green_defects where idempotency_key = p_idempotency_key;
  if existing is not null then
    return existing;
  end if;
  insert into green_defects (green_lot_code, defect_kind, count, category, device_id, device_seq, idempotency_key)
  values (p_green_lot_code, p_defect_kind, p_count, p_category, p_device_id, p_device_seq, p_idempotency_key)
  on conflict (idempotency_key) do nothing
  returning id into new_id;
  if new_id is null then
    select id into new_id from green_defects where idempotency_key = p_idempotency_key;
  end if;
  return new_id;
end $$;

-- place_qc_hold — open a quarantine hold on a green lot (idempotent on key). A
-- second call with the same key is a no-op (returns the existing hold id); a held
-- lot cannot be reserved/shipped (the _prevent_held_lot_commit trigger).
create or replace function place_qc_hold(
  p_green_lot_code  text,
  p_reason          text,
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
  existing bigint;
  new_id   bigint;
begin
  select id into existing from qc_holds where idempotency_key = p_idempotency_key;
  if existing is not null then
    return existing;
  end if;
  if not exists (select 1 from green_lots where lot_code = p_green_lot_code) then
    raise exception 'unknown green lot %', p_green_lot_code using errcode = 'foreign_key_violation';
  end if;
  insert into qc_holds (green_lot_code, reason, placed_at, placed_by, device_id, device_seq, idempotency_key)
  values (p_green_lot_code, p_reason, p_occurred_at, p_device_id, p_device_id, p_device_seq, p_idempotency_key)
  on conflict (idempotency_key) do nothing
  returning id into new_id;
  if new_id is null then
    select id into new_id from qc_holds where idempotency_key = p_idempotency_key;
  end if;
  return new_id;
end $$;

-- release_qc_hold — stamp released_at on the lot's open hold(s), re-opening
-- commerce. Idempotent: releasing an already-clear lot is a no-op. The DEFINER
-- owner performs the one-way release stamp the _qc_holds_guard_mutation allows.
create or replace function release_qc_hold(
  p_green_lot_code  text,
  p_occurred_at     timestamptz,
  p_device_id       text,
  p_device_seq      bigint,
  p_idempotency_key text
) returns integer
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare
  n integer;
begin
  -- Naturally idempotent: only OPEN holds (released_at is null) are stamped, so a
  -- replay on an already-clear lot matches zero rows and returns 0 — no second
  -- mutation, no error. p_idempotency_key is accepted for a uniform RPC envelope
  -- (the outbox replays the same args) but the open-hold predicate is the dedup.
  update qc_holds
     set released_at = p_occurred_at,
         released_by = p_device_id
   where green_lot_code = p_green_lot_code
     and released_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 9. RLS — authenticated-only read on every new table (mirrors the Phase-1
--    "authenticated read" posture). Writes go via the RPCs / append-only INSERT.
-- ──────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['cupping_sessions','cupping_scores','green_defects','qc_holds']
  loop
    execute format('alter table %I enable row level security;', t);
    execute format($p$create policy "authenticated read" on %I for select to authenticated using (true);$p$, t);
  end loop;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 10. GRANTS (AD-8) — explicit SELECT on every new table/view; NO write table
--     grants at all (every write flows through the SECURITY DEFINER RPCs, which run
--     as the owner). The definer RPCs slam PUBLIC EXECUTE shut then grant only to
--     authenticated. Nothing to anon. Internal trigger fns get no grant.
-- ──────────────────────────────────────────────────────────────────────────
-- Per-object SELECT grants (one statement per object so the AD-8 name-anchored
-- static guard matches each created object individually).
grant select on cupping_sessions  to authenticated;
grant select on cupping_scores    to authenticated;
grant select on green_defects     to authenticated;
grant select on qc_holds          to authenticated;
grant select on v_cup_final_score to authenticated;
grant select on v_cupper_drift    to authenticated;
grant select on v_qc_status       to authenticated;

-- CRITICAL (the S3 lesson): revoke the Postgres-default PUBLIC EXECUTE on every
-- caller-facing definer RPC FIRST, then grant only to authenticated. Internal
-- trigger fns (leading underscore) are owner-only and intentionally un-granted.
revoke execute on function record_cupping_session(text, text, text, boolean, timestamptz, text, bigint, text) from public;
revoke execute on function record_cup_score(bigint, text, numeric, text, bigint, text)                        from public;
revoke execute on function record_defect(text, text, integer, text, text, bigint, text)                       from public;
revoke execute on function place_qc_hold(text, text, timestamptz, text, bigint, text)                         from public;
revoke execute on function release_qc_hold(text, timestamptz, text, bigint, text)                             from public;
revoke execute on function _qc_block_mutation()                                                               from public;
revoke execute on function _qc_holds_guard_mutation()                                                         from public;
revoke execute on function _prevent_held_lot_commit()                                                         from public;

grant execute on function record_cupping_session(text, text, text, boolean, timestamptz, text, bigint, text) to authenticated;
grant execute on function record_cup_score(bigint, text, numeric, text, bigint, text)                        to authenticated;
grant execute on function record_defect(text, text, integer, text, text, bigint, text)                       to authenticated;
grant execute on function place_qc_hold(text, text, timestamptz, text, bigint, text)                         to authenticated;
grant execute on function release_qc_hold(text, timestamptz, text, bigint, text)                             to authenticated;

commit;
