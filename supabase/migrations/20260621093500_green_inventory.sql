-- S5 — GreenLot inventory + ATP: the first money-shaped slice.
--
-- A GreenLot is the SAME `lots` node at stage='green' (ADR / D-LOT-1) plus a
-- green-specific detail row in `green_lots` (grade inputs, location, a GENERATED
-- `sca_grade` band — D-INV-3). Inventory commitments live in two APPEND-ONLY claim
-- tables (`lot_reservations`, `lot_shipments`); there is no destructive client
-- update/delete path. Available-to-promise is DERIVED, never a stored counter:
--   atp = lots.current_kg − Σ(reservations) − Σ(shipments).
--
-- INVARIANT (the money guarantee): `prevent_oversell` is a BEFORE INSERT/UPDATE
-- trigger that FAILS CLOSED — a reservation or shipment whose committed total would
-- exceed the green lot's current_kg is physically rejected at the data layer. The UI
-- *cannot* create a double-sell of a scarce micro-lot.
--
-- WRITER: `materialize_green_lot()` is the ONLY GreenLot writer (ADR-002 command
-- RPC) — it promotes/creates the green node, routes mass from the source node via a
-- single CONSERVED 'process' lot_edge (S3 conservation trigger enforces ≤ source kg),
-- and writes the green_lots detail row, all in one txn.
--
-- GRANTS (AD-8 + the S3 SECURITY-DEFINER lesson): grant_hygiene locked default
-- privileges, so EVERY new table/view gets an explicit `grant select ... to
-- authenticated`; the definer RPC FIRST `revoke execute ... from public` (Postgres
-- grants PUBLIC EXECUTE by default — that exact default let anon mint lots in S3),
-- THEN `grant execute ... to authenticated`. The append-only claim tables grant ONLY
-- INSERT to authenticated (the one legal client write); never UPDATE/DELETE; never to
-- anon. `green_lots` gets no write grant at all (RPC-only).
--
-- EUDR (S8) references `green_lots.lot_code` as a stable identity, intentionally
-- un-FK'd (S8 ships later; the contract is the PK name, not a foreign key).

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. green_lots — the green-specific detail row, keyed by the lot node code.
--    lot_code is the stable PK the EUDR slice (S8) references un-FK'd. The cupping
--    score (a measured grade INPUT) drives a GENERATED `sca_grade` band so the
--    band can never drift from the score (D-INV-3, single source of truth).
-- ──────────────────────────────────────────────────────────────────────────
create table green_lots (
  lot_code      text    primary key references lots(code),
  cupping_score numeric not null check (cupping_score >= 0 and cupping_score <= 100),
  -- D-INV-3: the SCA band is DERIVED from the cupping score, not stored
  -- independently — it can never disagree with the score it bands.
  sca_grade     text    generated always as (
                  case
                    when cupping_score >= 90 then 'Presidential'
                    when cupping_score >= 85 then 'Specialty'
                    when cupping_score >= 80 then 'Premium'
                    else 'Below Specialty'
                  end
                ) stored,
  location      text    not null,            -- warehouse / storage location
  graded_at     timestamptz not null default now()
);

-- ──────────────────────────────────────────────────────────────────────────
-- 2. lot_reservations / lot_shipments — APPEND-ONLY claim rows against a green
--    lot's ATP. kg > 0 enforced; created_at server-stamped. No update/delete path
--    for clients (no UPDATE/DELETE grant; the oversell trigger also guards UPDATE).
-- ──────────────────────────────────────────────────────────────────────────
create table lot_reservations (
  id             bigint generated always as identity primary key,
  green_lot_code text    not null references green_lots(lot_code),
  buyer          text    not null,
  kg             numeric not null check (kg > 0),
  created_at     timestamptz not null default now()
);
create index lot_reservations_lot_idx on lot_reservations(green_lot_code);

create table lot_shipments (
  id             bigint generated always as identity primary key,
  green_lot_code text    not null references green_lots(lot_code),
  destination    text    not null,
  kg             numeric not null check (kg > 0),
  created_at     timestamptz not null default now()
);
create index lot_shipments_lot_idx on lot_shipments(green_lot_code);

-- ──────────────────────────────────────────────────────────────────────────
-- 3. prevent_oversell — FAIL-CLOSED BEFORE INSERT/UPDATE trigger on BOTH claim
--    tables. Rejects any claim whose committed total (Σreservations + Σshipments,
--    counting the incoming row) would exceed the green lot's current_kg. Double-
--    selling a scarce micro-lot is impossible at the data layer.
-- ──────────────────────────────────────────────────────────────────────────
create or replace function prevent_oversell() returns trigger
  language plpgsql
  set search_path = public
as $$
declare
  avail        numeric;       -- the green lot's current_kg (the sellable mass)
  committed    numeric;       -- already-committed kg EXCLUDING the incoming row
begin
  -- SERIALIZE per green lot (finding #1). This is a classic check-then-insert:
  -- PostgREST runs each request in its own READ COMMITTED txn, so without a lock
  -- two concurrent claims against the SAME lot both read the same pre-insert
  -- committed total, both pass the ceiling check, and both commit — a 100 kg lot
  -- sold as 60+60. A transaction-scoped advisory lock keyed on the lot code,
  -- taken BEFORE the committed-total read, makes concurrent claims against one lot
  -- queue (each sees the prior's committed kg); it auto-releases at commit and is
  -- keyed per-lot so unrelated lots never block each other. Tighter than locking
  -- the lots row FOR UPDATE (which would also block unrelated stage updates).
  perform pg_advisory_xact_lock(hashtext('green_lot:' || new.green_lot_code));

  select coalesce(current_kg, origin_kg) into avail
    from lots where code = new.green_lot_code;
  if avail is null then
    -- A green lot with undeclared mass cannot back any commitment — fail closed.
    raise exception
      'oversell guard: green lot % has no declared mass; cannot commit % kg',
      new.green_lot_code, new.kg
      using errcode = 'check_violation';
  end if;

  -- Sum existing commitments across BOTH claim tables, excluding the row being
  -- updated (so an UPDATE doesn't double-count itself).
  select
    coalesce((select sum(kg) from lot_reservations
               where green_lot_code = new.green_lot_code
                 and not (tg_table_name = 'lot_reservations' and tg_op = 'UPDATE' and id = new.id)), 0)
  + coalesce((select sum(kg) from lot_shipments
               where green_lot_code = new.green_lot_code
                 and not (tg_table_name = 'lot_shipments' and tg_op = 'UPDATE' and id = new.id)), 0)
    into committed;

  if committed + new.kg > avail + 1e-9 then
    raise exception
      'oversell guard: committing % kg to green lot % would exceed its % kg available-to-promise (% already committed)',
      new.kg, new.green_lot_code, avail, committed
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger lot_reservations_prevent_oversell
  before insert or update on lot_reservations
  for each row execute function prevent_oversell();

create trigger lot_shipments_prevent_oversell
  before insert or update on lot_shipments
  for each row execute function prevent_oversell();

-- ──────────────────────────────────────────────────────────────────────────
-- 3b. lots_conserve_mass_vs_claims — guard the OTHER side of the invariant
--     (finding #2). prevent_oversell only fires on the CLAIM tables, but a green
--     lot's current_kg can be LOWERED after claims exist (advance_processing_stage,
--     shrinkage/moisture correction, any future mass adjustment). S3's
--     lots_conserve_mass_on_lower only knows about lot_edges — it has NO knowledge
--     of lot_reservations/lot_shipments. So materialize 100 -> reserve 90 -> lower
--     current_kg to 50 would succeed unchecked, double-selling the lot and making
--     green_lots_atp.atp go NEGATIVE (50 - 90 = -40). This BEFORE UPDATE trigger on
--     `lots` rejects lowering a green lot's effective mass below what is already
--     committed against it (Σreservations + Σshipments). You may lower down to the
--     committed total (atp = 0) but never below it.
-- ──────────────────────────────────────────────────────────────────────────
create or replace function lots_conserve_mass_vs_claims() returns trigger
  language plpgsql
  set search_path = public
as $$
declare
  new_kg    numeric;
  committed numeric;
begin
  new_kg := coalesce(new.current_kg, new.origin_kg);
  select
    coalesce((select sum(kg) from lot_reservations where green_lot_code = new.code), 0)
  + coalesce((select sum(kg) from lot_shipments    where green_lot_code = new.code), 0)
    into committed;

  if committed <= 1e-9 then
    return new;                 -- nothing committed against this lot; no constraint
  end if;

  if new_kg is null then
    -- clearing mass back to undeclared while claims exist would orphan them.
    raise exception
      'oversell guard: cannot clear green lot %''s mass while % kg is committed against it',
      new.code, committed
      using errcode = 'check_violation';
  end if;

  if new_kg < committed - 1e-9 then
    raise exception
      'oversell guard: cannot lower green lot %''s mass to % kg — % kg is already committed against it (would oversell)',
      new.code, new_kg, committed
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger lots_conserve_mass_vs_claims
  before update on lots
  for each row
  when (
    coalesce(new.current_kg, new.origin_kg) is distinct from
    coalesce(old.current_kg, old.origin_kg)
  )
  execute function lots_conserve_mass_vs_claims();

-- ──────────────────────────────────────────────────────────────────────────
-- 4. green_lots_atp — the DERIVED available-to-promise view (security_invoker so
--    it inherits the caller's RLS on the base tables). atp is computed, never a
--    stored counter, so it can never disagree with the claim rows it sums.
-- ──────────────────────────────────────────────────────────────────────────
create view green_lots_atp with (security_invoker = on) as
  select
    g.lot_code                                          as green_lot_code,
    g.sca_grade,
    g.location,
    coalesce(l.current_kg, l.origin_kg, 0)::numeric     as current_kg,
    coalesce((select sum(kg) from lot_reservations r
               where r.green_lot_code = g.lot_code), 0)::numeric as reserved_kg,
    coalesce((select sum(kg) from lot_shipments s
               where s.green_lot_code = g.lot_code), 0)::numeric as shipped_kg,
    (coalesce(l.current_kg, l.origin_kg, 0)
       - coalesce((select sum(kg) from lot_reservations r where r.green_lot_code = g.lot_code), 0)
       - coalesce((select sum(kg) from lot_shipments s where s.green_lot_code = g.lot_code), 0)
    )::numeric                                          as atp
  from green_lots g
  join lots l on l.code = g.lot_code;

-- ──────────────────────────────────────────────────────────────────────────
-- 5. materialize_green_lot — the ONLY GreenLot writer (ADR-002). Promotes/creates
--    the green node, routes `p_kg` from the source node via a single CONSERVED
--    'process' lot_edge (the S3 lot_edges_conserve_mass trigger rejects routing
--    more than the source holds), and writes the green_lots detail row. Idempotent
--    on the green code: a second call for an existing green lot is a no-op returning
--    the code (so a retry never double-routes mass).
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
begin
  -- exactly-once: if this green lot already exists, return it (no second edge,
  -- no double-routed mass).
  if exists (select 1 from green_lots where lot_code = p_green_code) then
    return p_green_code;
  end if;

  if not exists (select 1 from lots where code = p_source_code) then
    raise exception 'unknown source lot %', p_source_code using errcode = 'foreign_key_violation';
  end if;

  -- Create the green node (the same lots graph node at stage='green'). Carries the
  -- source's variety/single-origin lineage forward.
  insert into lots (code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
  select p_green_code, 'green', s.variety, p_kg, p_kg, s.is_single_origin, p_occurred_at
    from lots s where s.code = p_source_code;

  -- Link source -> green with a CONSERVED 'process' edge. The S3 conservation
  -- trigger rejects this insert if p_kg exceeds the source's available mass.
  insert into lot_edges (parent_code, child_code, kind, kg)
  values (p_source_code, p_green_code, 'process', p_kg);

  -- The green-specific detail row (grade input + location; sca_grade is generated).
  insert into green_lots (lot_code, cupping_score, location, graded_at)
  values (p_green_code, p_cupping_score, p_location, p_occurred_at);

  return p_green_code;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 6. RLS — authenticated-only read on the new claim/detail tables (mirrors the S3
--    "authenticated read" posture). Writes go via the RPC (green_lots) or the
--    append-only INSERT grant (claim tables) — never UPDATE/DELETE.
-- ──────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['green_lots','lot_reservations','lot_shipments']
  loop
    execute format('alter table %I enable row level security;', t);
    execute format($p$create policy "authenticated read" on %I for select to authenticated using (true);$p$, t);
  end loop;
end $$;

-- The claim tables are APPEND-ONLY for clients: an INSERT policy (no update/delete
-- policy exists, so update/delete are denied at the policy layer too).
create policy "authenticated append" on lot_reservations for insert to authenticated with check (true);
create policy "authenticated append" on lot_shipments    for insert to authenticated with check (true);

-- ──────────────────────────────────────────────────────────────────────────
-- 7. GRANTS (AD-8) — explicit SELECT on every new table/view; INSERT only on the
--    append-only claim tables; NO write grant on green_lots (RPC-only); the definer
--    RPC slams PUBLIC EXECUTE shut then grants only to authenticated. Nothing to anon.
-- ──────────────────────────────────────────────────────────────────────────
-- Per-object SELECT grants (one statement per object so the AD-8 static guard's
-- name-anchored regex matches each created object individually).
grant select on green_lots       to authenticated;
grant select on lot_reservations to authenticated;
grant select on lot_shipments    to authenticated;
grant select on green_lots_atp   to authenticated;

-- Append-only client write: INSERT only on the claim tables (UPDATE/DELETE never
-- granted — the oversell trigger + the append-only policy make a destructive client
-- path impossible). green_lots gets NO write grant (it is written only by the RPC).
grant insert on lot_reservations to authenticated;
grant insert on lot_shipments    to authenticated;

-- CRITICAL (the S3 lesson): Postgres grants EXECUTE to PUBLIC on every new function
-- by default, and a SECURITY DEFINER fn runs as the table owner (bypassing RLS) — so
-- a leftover PUBLIC grant would let the unauthenticated anon key materialize green
-- lots and route mass. Slam PUBLIC shut FIRST, then grant only to authenticated.
revoke execute on function materialize_green_lot(text, text, numeric, numeric, text, timestamptz) from public;
revoke execute on function prevent_oversell()                                                      from public;
revoke execute on function lots_conserve_mass_vs_claims()                                           from public;
grant  execute on function materialize_green_lot(text, text, numeric, numeric, text, timestamptz) to authenticated;
-- prevent_oversell() is a trigger fn — runs as the owner via the trigger, never a
-- caller-facing RPC — so it gets NO grant (the leading-underscore convention is for
-- the AD-8 static guard; trigger fns are excluded there by not being granted).

commit;
