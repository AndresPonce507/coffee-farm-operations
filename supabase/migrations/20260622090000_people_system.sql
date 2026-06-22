-- P2-S1 — Crew + worker system-of-record. The FIRST Phase-2 migration; it sorts
-- strictly above the live Phase-1 head (20260621110000_phase1_review_fixes), as the
-- Phase-2 DESIGN baseline correction requires (renumbered to the 20260622NNNNNN lane).
--
-- WHAT THIS PROMOTES (the Phase-1 `area_ha`/`lots(code)` "promote-in-place" move):
--   - workers.crew (a flat `text NOT NULL` snapshot) -> real `crews` + an append-only
--     `crew_memberships` history. workers.crew is RETAINED as a derived-backfilled
--     column (latest active membership) so every Phase-1 FK/read survives unchanged.
--   - workers.attendance (a single enum snapshot) -> an append-only, hash-chained
--     `attendance_event` ledger + a `worker_attendance_today` projection view.
--     workers.attendance is RETAINED as a derived column for Phase-1 reads.
--   - Adds worker identity (dignity fields the Ngäbe-Buglé crew needs), append-only
--     por-obra (piece-work) contracts with a supersede-resolver, and an append-only
--     certification ledger with a validity view.
--   - One-tap `rehire_worker()` reactivates a returning worker into a new season's
--     crew, carrying identity + valid certs forward, never re-keying their history.
--
-- SUBSTRATE REUSE (no retrofit): the new ledgers reuse the EXACT Phase-1 `lot_event`
-- hash-chain idiom — a BEFORE INSERT trigger that sets prev_hash from the stream head
-- and computes `extensions.digest(prev || canonical_bytes, 'sha256')`, immutability via
-- a no-UPDATE/DELETE policy + a block trigger, dual clocks occurred_at/recorded_at, and
-- device_id/device_seq/idempotency_key causal-ordering+replay columns. Worker streams
-- are PII-bearing so they get their OWN dedicated `worker_stream_event` ledger (DESIGN
-- §4.5 recommendation: dedicated, PII-scoped, not a `worker:<id>` key on lot_event).
--
-- GRANTS (AD-8 — grant_hygiene locked default privileges): EVERY new table/view gets an
-- explicit `grant select ... to authenticated`; EVERY caller-facing SECURITY DEFINER RPC
-- `revoke execute ... from public` then `grant execute ... to authenticated`. NOTHING is
-- granted to anon. Writes flow ONLY through the command RPCs (no write table grants).
--
-- RLS / FARM SCOPING NOTE (flag): the Phase-1 spine on disk uses simple authenticated-
-- only RLS (no `farm_id` column, no `app.apply_farm_rls` factory — those are aspirational
-- in the DESIGN doc, NOT present in the shipped migrations). To stay consistent with the
-- live spine and the single-owner posture, this slice does NOT introduce a farm_id column;
-- it matches Phase-1's "authenticated read + RPC-only write" posture exactly. The DESIGN's
-- multi-actor role model (§4 primary decision) is therefore flagged for a later slice.

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 0. crews — promote workers.crew in place. Seeded from the DISTINCT crew strings
--    already on workers so the backfill is lossless. A crew id is a slug derived
--    from the name; the original name is preserved verbatim so v_crew_roster can
--    reproduce the exact Phase-1 grouping.
-- ──────────────────────────────────────────────────────────────────────────
create table crews (
  id             text primary key,                 -- slug e.g. 'crew-norte'
  name           text not null unique,             -- the original workers.crew string, verbatim
  lead_worker_id text references workers(id),       -- nullable: a crew may have no named lead yet
  season         text,                              -- nullable: the season this crew is active for
  created_at     timestamptz not null default now()
);

-- ──────────────────────────────────────────────────────────────────────────
-- 1. crew_memberships — append-only membership HISTORY (not a flag). A worker's
--    membership in a crew is a row with joined_at and a nullable left_at; ending a
--    membership sets left_at (the one allowed UPDATE — see the append-only policy
--    note below: memberships are an *event log* of join/leave, and the active set is
--    a derived projection). Backfilled one active membership per existing worker.
-- ──────────────────────────────────────────────────────────────────────────
create table crew_memberships (
  id        bigint generated always as identity primary key,
  worker_id text        not null references workers(id),
  crew_id   text        not null references crews(id),
  joined_at timestamptz not null default now(),
  left_at   timestamptz,                             -- null = currently active
  check (left_at is null or left_at >= joined_at)
);
create index crew_memberships_worker_idx on crew_memberships(worker_id);
create index crew_memberships_crew_idx   on crew_memberships(crew_id);
-- one ACTIVE membership per worker (a worker is in at most one crew at a time).
create unique index crew_memberships_one_active_idx
  on crew_memberships(worker_id) where (left_at is null);

-- ──────────────────────────────────────────────────────────────────────────
-- 2. worker_identity — the dignity/identity extension the flat row lacks. One row
--    per worker (PK = worker_id). PII-bearing: read-only to authenticated, written
--    only via the enroll/rehire RPCs (no direct write grant).
-- ──────────────────────────────────────────────────────────────────────────
create table worker_identity (
  worker_id         text primary key references workers(id),
  preferred_name    text,
  comarca_origin    text,                            -- e.g. 'Ngäbe-Buglé'
  id_doc_kind       text check (id_doc_kind is null or id_doc_kind in ('cedula','migrant-doc','passport','none')),
  id_doc_ref        text,
  languages         text[] not null default '{}',    -- e.g. {es, ngäbere}
  emergency_contact text,
  rehire_eligible   boolean not null default true,
  updated_at        timestamptz not null default now()
);

-- ──────────────────────────────────────────────────────────────────────────
-- 2a. _backfill_people() — the IDEMPOTENT promote-in-place backfill. Run once by
--     this migration AND by seed.sql AFTER it inserts `workers` (the generated seed
--     emits `select _backfill_people();`). Why a callable helper, not an inline
--     `insert`: seed.sql runs AFTER all migrations, so an inline migration backfill
--     would see an empty `workers` table in a fresh prod/test bootstrap and backfill
--     nothing. Calling it post-seed lands the crews/memberships/identity for the real
--     workers; it is idempotent (on conflict / not-exists guards) so the migration's
--     own call (on whatever workers exist then) and the seed's call never collide.
--       - one `crews` row per DISTINCT workers.crew string (id = a slugged name);
--       - one ACTIVE crew_memberships row per worker (their current crew);
--       - one worker_identity shell per worker (languages default to Spanish).
-- ──────────────────────────────────────────────────────────────────────────
create or replace function _backfill_people() returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  -- crews: one per distinct crew string. id = the whole name slugged (lowercased,
  -- accent-folded, non-alnum -> dash, trimmed of edge dashes). 'Crew Norte' ->
  -- 'crew-norte', 'Field Ops' -> 'field-ops' (no redundant prefix — the name already
  -- carries "Crew" where present, so slugging the whole name is both correct and stable).
  insert into crews (id, name)
  select
    trim(both '-' from regexp_replace(lower(translate(c, 'áéíóúñ', 'aeioun')), '[^a-z0-9]+', '-', 'g')),
    c
  from (select distinct crew as c from workers) src
  on conflict (name) do nothing;

  -- one active membership per worker, in the crew matching their current crew string.
  -- Skip a worker who already has an active membership (idempotent re-run).
  insert into crew_memberships (worker_id, crew_id)
  select w.id, c.id
  from workers w
  join crews c on c.name = w.crew
  where not exists (
    select 1 from crew_memberships m where m.worker_id = w.id and m.left_at is null
  );

  -- one identity shell per worker (Spanish by default).
  insert into worker_identity (worker_id, languages)
  select id, array['es'] from workers
  on conflict (worker_id) do nothing;
end $$;

-- Run it now so a migration-only replay (no seed) is internally consistent.
select _backfill_people();

-- ──────────────────────────────────────────────────────────────────────────
-- 3. worker_stream_event — the PII-scoped, append-only, hash-chained ledger for
--    worker-life events (enroll / rehire / identity changes). Mirrors lot_event's
--    substrate EXACTLY but on its own table so worker PII has its own grant surface.
-- ──────────────────────────────────────────────────────────────────────────
create table worker_stream_event (
  event_uid       uuid        primary key default gen_random_uuid(),
  idempotency_key text,
  stream_key      text        not null,                  -- 'worker:<id>'
  kind            text        not null,
  payload         jsonb       not null default '{}'::jsonb
                    check (octet_length(payload::text) < 4096),
  occurred_at     timestamptz not null,
  recorded_at     timestamptz not null default now(),
  device_id       text        not null,
  device_seq      bigint      not null,
  prev_hash       bytea,
  hash            bytea,
  -- Exactly-once is anchored PER COMMAND KIND, not on a single global key. Four
  -- worker-life RPCs (enroll / rehire / por-obra-sign / certify) write this one
  -- ledger and each takes a caller-supplied idempotency_key; a GLOBAL unique on the
  -- key alone let a key reused across command types short-circuit on a FOREIGN
  -- command's event (a rehire reusing an enroll key returned the enroll's event and
  -- reported "rehired" while opening no membership and skipping the eligibility gate;
  -- a sign/certify reusing an enroll key read an absent contract_id/cert_id and
  -- returned NULL, silently dropping the contract/cert). Namespacing the dedupe by
  -- (kind, idempotency_key) means the SAME client key under two different kinds
  -- yields two independent events, and each RPC's replay guard + on-conflict target
  -- this pair so a replay only ever matches its OWN command kind.
  unique (kind, idempotency_key),
  unique (device_id, device_seq)
);
create index worker_stream_event_stream_idx on worker_stream_event (stream_key, device_seq);

-- Server-minted device_seq source. Two write paths need a monotonic per-device seq
-- for the SAME synthetic device_id='server':
--   (a) sign_por_obra_contract / record_certification — owner-only RPCs that take NO
--       client device_seq, mint their worker_stream_event seq internally; and
--   (b) the ONLINE server actions (record_attendance / enroll_crew_member /
--       rehire_worker), which run on the single 'server' device today (no offline
--       outbox yet — that is S0). They must NOT hardcode device_seq=0: every
--       attendance_event/worker_stream_event carries `unique (device_id, device_seq)`,
--       so a constant 0 collides on the SECOND write (system-wide). A shared global
--       monotonic sequence keeps ('server', seq) unique within BOTH tables forever.
-- `next_server_seq()` is the caller-facing draw for (b); the internal RPCs (a) call
-- nextval directly. When S0's offline outbox lands, field devices mint their own
-- (device_id, device_seq) client-side and this server path is just one more device.
create sequence worker_server_seq as bigint start with 1 increment by 1;

create or replace function next_server_seq() returns bigint
  language sql
  security definer
  set search_path = public
as $$
  select nextval('worker_server_seq');
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. attendance_event — append-only, hash-chained attendance ledger. The presence
--    proof payroll + labor-law evidence both read. Its own table (worker-scoped).
-- ──────────────────────────────────────────────────────────────────────────
create table attendance_event (
  event_uid       uuid        primary key default gen_random_uuid(),
  idempotency_key text        unique,
  stream_key      text        not null,                  -- 'attendance:<worker_id>'
  worker_id       text        not null references workers(id),
  crew_id         text        references crews(id),
  event_kind      text        not null check (event_kind in ('clock-in','clock-out','rest-day','absent')),
  plot_id         text        references plots(id),       -- nullable geofence stamp
  payload         jsonb       not null default '{}'::jsonb
                    check (octet_length(payload::text) < 4096),
  occurred_at     timestamptz not null,
  recorded_at     timestamptz not null default now(),
  device_id       text        not null,
  device_seq      bigint      not null,
  prev_hash       bytea,
  hash            bytea,
  unique (device_id, device_seq)
);
create index attendance_event_worker_idx on attendance_event (worker_id, occurred_at);
create index attendance_event_stream_idx on attendance_event (stream_key, device_seq);

-- ──────────────────────────────────────────────────────────────────────────
-- 5. por_obra_contracts — append-only piece-work rate contracts. Supersede-don't-
--    update: a new row supersedes an old one, so the rate a worker agreed to on a
--    given day is forever auditable (the Phase-1 cost_entry reversing discipline).
--    v_active_por_obra windows by effective_from/to to resolve the rate on a date.
-- ──────────────────────────────────────────────────────────────────────────
create table por_obra_contracts (
  id             bigint generated always as identity primary key,
  worker_id      text        not null references workers(id),
  task_kind      text        not null,                     -- e.g. 'picking'
  rate_basis     text        not null check (rate_basis in ('per-lata','per-kg','per-tarea','per-tree')),
  rate_usd       numeric     not null check (rate_usd >= 0),
  effective_from date        not null,
  effective_to   date,                                     -- null = open-ended
  signed_at      timestamptz not null default now(),
  signature_ref  text,
  superseded_by  bigint references por_obra_contracts(id), -- supersede chain
  created_at     timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
create index por_obra_worker_idx on por_obra_contracts(worker_id, task_kind);

-- ──────────────────────────────────────────────────────────────────────────
-- 6. worker_certifications — append-only cert ledger. Backs the IPM slice's
--    certification-gated hazard work (S12). v_worker_certs_valid is the single
--    validity source the spray-log RPC will check.
-- ──────────────────────────────────────────────────────────────────────────
create table worker_certifications (
  id         bigint generated always as identity primary key,
  worker_id  text        not null references workers(id),
  cert_kind  text        not null,                          -- e.g. 'pesticide-handling','chainsaw','first-aid'
  issued_at  date        not null,
  expires_at date,                                          -- null = non-expiring
  issuer     text,
  doc_ref    text,
  created_at timestamptz not null default now(),
  check (expires_at is null or expires_at >= issued_at)
);
create index worker_certifications_worker_idx on worker_certifications(worker_id, cert_kind);

-- ──────────────────────────────────────────────────────────────────────────
-- 7. The hash-chain substrate for the worker-scoped ledgers (worker_stream_event +
--    attendance_event). Reuses lot_event_canonical_bytes (already on disk, immutable)
--    so the chain math is shared and proven. One BEFORE INSERT trigger fn per table,
--    keyed on each table's own stream head; one shared block-mutation fn.
-- ──────────────────────────────────────────────────────────────────────────

-- worker_stream_event: set prev_hash from the stream head, compute hash.
create or replace function worker_stream_event_set_hash() returns trigger
  language plpgsql
  set search_path = public, extensions
as $$
declare head bytea;
begin
  select e.hash into head
    from worker_stream_event e
   where e.stream_key = new.stream_key
   order by e.device_seq desc
   limit 1;
  new.prev_hash := head;
  new.hash := extensions.digest(
    coalesce(new.prev_hash, ''::bytea)
      || lot_event_canonical_bytes(new.stream_key, new.kind, new.payload,
                                   new.occurred_at, new.device_id, new.device_seq),
    'sha256'
  );
  return new;
end $$;

create trigger worker_stream_event_set_hash
  before insert on worker_stream_event
  for each row execute function worker_stream_event_set_hash();

-- attendance_event: same chain, but its canonical bytes fold in event_kind via the
-- `kind` slot so two events differing only by kind hash differently.
create or replace function attendance_event_set_hash() returns trigger
  language plpgsql
  set search_path = public, extensions
as $$
declare head bytea;
begin
  select e.hash into head
    from attendance_event e
   where e.stream_key = new.stream_key
   order by e.device_seq desc
   limit 1;
  new.prev_hash := head;
  new.hash := extensions.digest(
    coalesce(new.prev_hash, ''::bytea)
      || lot_event_canonical_bytes(new.stream_key, new.event_kind, new.payload,
                                   new.occurred_at, new.device_id, new.device_seq),
    'sha256'
  );
  return new;
end $$;

create trigger attendance_event_set_hash
  before insert on attendance_event
  for each row execute function attendance_event_set_hash();

-- Shared append-only block: UPDATE/DELETE on the worker ledgers always raises.
create or replace function worker_ledger_block_mutation() returns trigger
  language plpgsql
as $$
begin
  raise exception '% is append-only and immutable (% blocked)', tg_table_name, tg_op
    using errcode = 'restrict_violation';
end $$;

create trigger worker_stream_event_block_mutation
  before update or delete on worker_stream_event
  for each row execute function worker_ledger_block_mutation();

create trigger attendance_event_block_mutation
  before update or delete on attendance_event
  for each row execute function worker_ledger_block_mutation();

-- por_obra_contracts: append-only with a supersede column. Block DELETE always;
-- block UPDATE EXCEPT setting superseded_by (the one supersede link write — the rate
-- itself is never mutated, satisfying "por-obra rate immutable once signed").
create or replace function por_obra_block_mutation() returns trigger
  language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'por_obra_contracts is append-only (DELETE blocked)'
      using errcode = 'restrict_violation';
  end if;
  -- UPDATE: only the superseded_by link may change; every rate/term column is frozen.
  if new.worker_id      is distinct from old.worker_id
     or new.task_kind   is distinct from old.task_kind
     or new.rate_basis  is distinct from old.rate_basis
     or new.rate_usd    is distinct from old.rate_usd
     or new.effective_from is distinct from old.effective_from
     or new.effective_to   is distinct from old.effective_to
     or new.signed_at      is distinct from old.signed_at
     or new.signature_ref  is distinct from old.signature_ref then
    raise exception 'por_obra_contracts rate/terms are immutable once signed — supersede with a new contract'
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

create trigger por_obra_block_mutation
  before update or delete on por_obra_contracts
  for each row execute function por_obra_block_mutation();

-- worker_certifications: append-only (a cert is evidence; correct by issuing a new
-- row, never by mutating history).
create or replace function worker_certifications_block_mutation() returns trigger
  language plpgsql
as $$
begin
  raise exception 'worker_certifications is append-only and immutable (% blocked)', tg_op
    using errcode = 'restrict_violation';
end $$;

create trigger worker_certifications_block_mutation
  before update or delete on worker_certifications
  for each row execute function worker_certifications_block_mutation();

-- ──────────────────────────────────────────────────────────────────────────
-- 7a. verify_chain — make the Phase-1 corruption detector STREAM-AWARE. The
--     attendance ledger lives in its OWN table (attendance_event, stream_key
--     'attendance:<id>') and the worker life-stream in worker_stream_event
--     ('worker:<id>'), NOT in lot_event. The Phase-1 verify_chain (defined in
--     20260621092000) iterates ONLY lot_event, so verify_chain('attendance:<id>')
--     found ZERO rows and returned a VACUOUS `true` — the "Chain verified" badge on
--     every worker profile was a permanent false-positive that verified nothing (it
--     could never go amber even on a fully-corrupted attendance ledger). Redefine it
--     here (after both worker ledgers exist) to branch on the stream_key prefix and
--     recompute over the correct table. Attendance folds event_kind into the `kind`
--     slot of canonical bytes (matching attendance_event_set_hash), worker_stream and
--     lot_event use `kind`. CREATE OR REPLACE keeps the existing grants
--     (verify_chain(text): revoked from public, granted to authenticated) — restated
--     in section 12 to be safe. Same caveat as lot_event: this proves INTERNAL
--     CONSISTENCY, not authenticity (the primary tamper guards are the append-only
--     block triggers + force-RLS + no write grant).
-- ──────────────────────────────────────────────────────────────────────────
create or replace function verify_chain(stream_key text)
  returns boolean
  language plpgsql
  stable
  security definer
  set search_path = public, extensions
as $$
declare
  r           record;
  expect_prev bytea := null;
  recomputed  bytea;
begin
  if verify_chain.stream_key like 'attendance:%' then
    for r in
      select * from attendance_event e
       where e.stream_key = verify_chain.stream_key
       order by e.device_seq
    loop
      if r.prev_hash is distinct from expect_prev then return false; end if;
      recomputed := extensions.digest(
        coalesce(r.prev_hash, ''::bytea)
          || lot_event_canonical_bytes(r.stream_key, r.event_kind, r.payload,
                                       r.occurred_at, r.device_id, r.device_seq),
        'sha256'
      );
      if recomputed is distinct from r.hash then return false; end if;
      expect_prev := recomputed;
    end loop;
    return true;
  elsif verify_chain.stream_key like 'worker:%' then
    for r in
      select * from worker_stream_event e
       where e.stream_key = verify_chain.stream_key
       order by e.device_seq
    loop
      if r.prev_hash is distinct from expect_prev then return false; end if;
      recomputed := extensions.digest(
        coalesce(r.prev_hash, ''::bytea)
          || lot_event_canonical_bytes(r.stream_key, r.kind, r.payload,
                                       r.occurred_at, r.device_id, r.device_seq),
        'sha256'
      );
      if recomputed is distinct from r.hash then return false; end if;
      expect_prev := recomputed;
    end loop;
    return true;
  else
    for r in
      select * from lot_event e
       where e.stream_key = verify_chain.stream_key
       order by e.device_seq
    loop
      if r.prev_hash is distinct from expect_prev then return false; end if;
      recomputed := extensions.digest(
        coalesce(r.prev_hash, ''::bytea)
          || lot_event_canonical_bytes(r.stream_key, r.kind, r.payload,
                                       r.occurred_at, r.device_id, r.device_seq),
        'sha256'
      );
      if recomputed is distinct from r.hash then return false; end if;
      expect_prev := recomputed;
    end loop;
    return true;
  end if;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 8. workers.crew + workers.attendance as DERIVED columns. They already exist
--    (Phase-1) and stay; the people RPCs keep them in sync so Phase-1 reads survive.
--    A helper resyncs workers.crew from the active membership + workers.attendance
--    from the latest attendance event. Owner-run (called by the RPCs / triggers).
-- ──────────────────────────────────────────────────────────────────────────
create or replace function _resync_worker_crew(p_worker_id text) returns void
  language plpgsql
  set search_path = public
as $$
declare nm text;
begin
  -- P4-S0: clamp to the caller's tenant. This helper is invoked (via perform) from the
  -- SECURITY DEFINER command RPCs, so it runs RLS-bypassing as the function owner; a bare
  -- worker_id read/write would touch another estate's same-id worker. The session GUC is
  -- preserved across the perform, so current_tenant_id() is the caller's.
  select c.name into nm
    from crew_memberships m
    join crews c on c.id = m.crew_id and c.tenant_id = m.tenant_id
   where m.worker_id = p_worker_id and m.left_at is null
     and m.tenant_id = current_tenant_id()
   order by m.joined_at desc
   limit 1;
  if nm is not null then
    update workers set crew = nm where id = p_worker_id and tenant_id = current_tenant_id();
  end if;
end $$;

create or replace function _resync_worker_attendance(p_worker_id text) returns void
  language plpgsql
  set search_path = public
as $$
declare k text; st attendance_status;
begin
  -- P4-S0: clamp to the caller's tenant (runs RLS-bypassing under the calling definer RPC).
  select event_kind into k
    from attendance_event
   where worker_id = p_worker_id and tenant_id = current_tenant_id()
   order by occurred_at desc, recorded_at desc
   limit 1;
  st := case k
          when 'clock-in'  then 'present'::attendance_status
          when 'clock-out' then 'present'::attendance_status
          when 'rest-day'  then 'rest-day'::attendance_status
          when 'absent'    then 'absent'::attendance_status
          else null
        end;
  if st is not null then
    update workers set attendance = st where id = p_worker_id and tenant_id = current_tenant_id();
  end if;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 9. Read views (security_invoker so base-table RLS governs the caller).
-- ──────────────────────────────────────────────────────────────────────────

-- v_crew_roster — every worker with their CURRENT crew + identity + presence. The
-- backfill-parity anchor: grouping by `crew` here reproduces the Phase-1 grouping.
create view v_crew_roster with (security_invoker = on) as
  select w.id              as worker_id,
         w.name,
         w.role,
         w.crew            as crew_name,
         cm.crew_id,
         w.attendance,
         i.preferred_name,
         i.comarca_origin,
         i.languages,
         i.rehire_eligible
    from workers w
    left join crew_memberships cm
           on cm.worker_id = w.id and cm.left_at is null
    left join worker_identity i on i.worker_id = w.id;

-- worker_attendance_today — the latest attendance event per worker TODAY (the
-- derived presence the Phase-1 attendance enum becomes).
create view worker_attendance_today with (security_invoker = on) as
  select distinct on (a.worker_id)
         a.worker_id,
         a.crew_id,
         a.event_kind,
         a.plot_id,
         a.occurred_at
    from attendance_event a
   where a.occurred_at::date = current_date
   order by a.worker_id, a.occurred_at desc, a.recorded_at desc;

-- v_active_por_obra — the rate-resolver payroll calls: the EFFECTIVE contract for a
-- worker+task on a date (the row whose effective window contains the date). The DATE
-- WINDOW is the SOLE resolution authority; `superseded_by` is AUDIT METADATA only
-- (the supersede chain records lineage / contract-history, it is NOT a resolution
-- filter). Filtering on `superseded_by is null` here was window-blind and wrong: the
-- supersede UPDATE in sign_por_obra_contract stamps EVERY still-open contract for the
-- worker+task regardless of date window, so the moment a second contract is signed the
-- first becomes invisible to this resolver for ANY date — including dates inside its
-- OWN effective window (a back-pay / audit / late-offline-sync lookup of a historical
-- piece-rate then prices the day at nothing). With the window as the sole authority,
-- `order by effective_from desc, id desc limit 1` already picks the right row: an
-- overlapping renegotiation resolves to the later-effective contract on dates both
-- windows cover, to the earlier (historically-agreed) contract on dates only it
-- covers, and a same-day correction tiebreaks on the later id. The rate a worker
-- agreed to on a given day stays forever auditable (migration header invariant).
-- Exposed as a function so callers pass (worker, task, date).
create or replace function v_active_por_obra(
  p_worker_id text, p_task_kind text, p_on_date date
) returns table (
  id bigint, worker_id text, task_kind text, rate_basis text,
  rate_usd numeric, effective_from date, effective_to date
)
  language sql
  security invoker
  stable
  set search_path = public
as $$
  select c.id, c.worker_id, c.task_kind, c.rate_basis,
         c.rate_usd, c.effective_from, c.effective_to
    from por_obra_contracts c
   where c.worker_id = p_worker_id
     and c.task_kind = p_task_kind
     and c.effective_from <= p_on_date
     and (c.effective_to is null or c.effective_to >= p_on_date)
   order by c.effective_from desc, c.id desc
   limit 1;
$$;

-- v_worker_certs_valid — every cert that is currently in force as of today. The
-- single source the S12 spray gate consults. Bounds BOTH ends of the window: a cert
-- is valid today only if it has already been issued (issued_at <= current_date) AND
-- has not yet expired (expires_at null or >= current_date). Without the lower bound a
-- future-issued cert (a data-entry slip, or a cert recorded ahead of course
-- completion) would read as valid today and let an untrained applicator pass the
-- fail-closed spray gate.
create view v_worker_certs_valid with (security_invoker = on) as
  select worker_id, cert_kind, issued_at, expires_at, issuer
    from worker_certifications
   where issued_at <= current_date
     and (expires_at is null or expires_at >= current_date);

-- ──────────────────────────────────────────────────────────────────────────
-- 10. Command RPCs (ADR-002 — SECURITY DEFINER, pinned search_path, mutate the
--     domain rows AND append the worker/attendance event in ONE txn, idempotent on
--     idempotency_key). EXECUTE to authenticated only.
-- ──────────────────────────────────────────────────────────────────────────

-- record_attendance — append an attendance event (offline-replayable via the S0
-- outbox: accepts client-minted device_id/device_seq/idempotency_key). Resyncs the
-- derived workers.attendance. Exactly-once on idempotency_key.
create or replace function record_attendance(
  p_worker_id       text,
  p_event_kind      text,
  p_plot_id         text,
  p_occurred_at     timestamptz,
  p_device_id       text,
  p_device_seq      bigint,
  p_idempotency_key text
) returns uuid
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare existing uuid; new_uid uuid; v_crew text;
begin
  select event_uid into existing from attendance_event where idempotency_key = p_idempotency_key;
  if existing is not null then
    return existing;                                  -- exactly-once replay
  end if;

  if not exists (select 1 from workers where id = p_worker_id) then
    raise exception 'unknown worker %', p_worker_id using errcode = 'foreign_key_violation';
  end if;

  -- the worker's current crew stamps the event (nullable if unassigned).
  select crew_id into v_crew from crew_memberships
   where worker_id = p_worker_id and left_at is null limit 1;

  insert into attendance_event (idempotency_key, stream_key, worker_id, crew_id,
                                event_kind, plot_id, occurred_at, device_id, device_seq)
  values (p_idempotency_key, 'attendance:' || p_worker_id, p_worker_id, v_crew,
          p_event_kind, p_plot_id, p_occurred_at, p_device_id, p_device_seq)
  on conflict (idempotency_key) do nothing
  returning event_uid into new_uid;
  if new_uid is null then
    select event_uid into new_uid from attendance_event where idempotency_key = p_idempotency_key;
    return new_uid;
  end if;

  perform _resync_worker_attendance(p_worker_id);
  return new_uid;
end $$;

-- enroll_crew_member — move a worker into a crew: close any active membership, open a
-- new one, append a WORKER_ENROLLED event, resync the derived workers.crew. Idempotent
-- on idempotency_key (a replay is a no-op returning the same event).
create or replace function enroll_crew_member(
  p_worker_id       text,
  p_crew_id         text,
  p_occurred_at     timestamptz,
  p_device_id       text,
  p_device_seq      bigint,
  p_idempotency_key text
) returns uuid
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare existing uuid; new_uid uuid; v_changed boolean := false;
begin
  -- replay guard is scoped to THIS command kind (see worker_stream_event's
  -- (kind, idempotency_key) namespace note) so a key reused under another command
  -- type can never short-circuit on a foreign event.
  select event_uid into existing from worker_stream_event
   where idempotency_key = p_idempotency_key and kind = 'WORKER_ENROLLED';
  if existing is not null then
    return existing;
  end if;
  if not exists (select 1 from workers where id = p_worker_id) then
    raise exception 'unknown worker %', p_worker_id using errcode = 'foreign_key_violation';
  end if;
  if not exists (select 1 from crews where id = p_crew_id) then
    raise exception 'unknown crew %', p_crew_id using errcode = 'foreign_key_violation';
  end if;

  -- close the current active membership (if any, and if it's a different crew).
  update crew_memberships
     set left_at = p_occurred_at
   where worker_id = p_worker_id and left_at is null and crew_id <> p_crew_id;
  if found then v_changed := true; end if;

  -- open a new membership only if not already actively in this crew.
  if not exists (
    select 1 from crew_memberships
     where worker_id = p_worker_id and crew_id = p_crew_id and left_at is null
  ) then
    insert into crew_memberships (worker_id, crew_id, joined_at)
    values (p_worker_id, p_crew_id, p_occurred_at);
    v_changed := true;
  end if;

  -- Only append the WORKER_ENROLLED event + resync when the membership actually
  -- CHANGED. A same-crew re-enroll (already active in the target crew, fresh key) is
  -- a true no-op: the membership logic above leaves it untouched, so appending a
  -- WORKER_ENROLLED row to the immutable hash-chained ledger would record an
  -- enrollment that never happened — a permanent false event downstream readers
  -- treat as a real crew change. On a genuine no-op, return the worker's most recent
  -- WORKER_ENROLLED event (or null if they were never enrolled via this RPC).
  if v_changed then
    insert into worker_stream_event (idempotency_key, stream_key, kind, payload,
                                     occurred_at, device_id, device_seq)
    values (p_idempotency_key, 'worker:' || p_worker_id, 'WORKER_ENROLLED',
            jsonb_build_object('worker_id', p_worker_id, 'crew_id', p_crew_id),
            p_occurred_at, p_device_id, p_device_seq)
    on conflict (kind, idempotency_key) do nothing
    returning event_uid into new_uid;
    if new_uid is null then
      select event_uid into new_uid from worker_stream_event
       where idempotency_key = p_idempotency_key and kind = 'WORKER_ENROLLED';
    end if;
    perform _resync_worker_crew(p_worker_id);
  else
    select event_uid into new_uid from worker_stream_event
     where stream_key = 'worker:' || p_worker_id and kind = 'WORKER_ENROLLED'
     order by recorded_at desc limit 1;
  end if;
  return new_uid;
end $$;

-- sign_por_obra_contract — append a piece-work contract. If a current (open) contract
-- for the same worker+task exists, it is SUPERSEDED (its superseded_by points at the
-- new row), never edited. Idempotent on idempotency_key.
create or replace function sign_por_obra_contract(
  p_worker_id       text,
  p_task_kind       text,
  p_rate_basis      text,
  p_rate_usd        numeric,
  p_effective_from  date,
  p_effective_to    date,
  p_signature_ref   text,
  p_idempotency_key text
) returns bigint
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare new_id bigint;
begin
  -- Exactly-once is anchored on the WORKER-STREAM signing event's idempotency_key,
  -- scoped to THIS command kind (POR_OBRA_SIGNED) so a key reused under another
  -- command type can never short-circuit on a foreign event (signature_ref is a
  -- free-text reference, not the dedupe key). A replay returns the contract_id
  -- recorded in the prior signing event; it appends no second contract.
  if exists (select 1 from worker_stream_event
              where idempotency_key = p_idempotency_key and kind = 'POR_OBRA_SIGNED') then
    -- already signed under this key: return the contract id recorded in the event.
    select (payload->>'contract_id')::bigint into new_id
      from worker_stream_event
     where idempotency_key = p_idempotency_key and kind = 'POR_OBRA_SIGNED';
    return new_id;
  end if;

  if not exists (select 1 from workers where id = p_worker_id) then
    raise exception 'unknown worker %', p_worker_id using errcode = 'foreign_key_violation';
  end if;

  insert into por_obra_contracts (worker_id, task_kind, rate_basis, rate_usd,
                                  effective_from, effective_to, signature_ref)
  values (p_worker_id, p_task_kind, p_rate_basis, p_rate_usd,
          p_effective_from, p_effective_to, p_signature_ref)
  returning id into new_id;

  -- supersede the previously-open contract for this worker+task (the one not yet
  -- superseded and not this new row), pointing it at the new contract.
  update por_obra_contracts
     set superseded_by = new_id
   where worker_id = p_worker_id and task_kind = p_task_kind
     and id <> new_id and superseded_by is null;

  insert into worker_stream_event (idempotency_key, stream_key, kind, payload,
                                   occurred_at, device_id, device_seq)
  values (p_idempotency_key, 'worker:' || p_worker_id, 'POR_OBRA_SIGNED',
          jsonb_build_object('worker_id', p_worker_id, 'task_kind', p_task_kind,
                             'contract_id', new_id, 'rate_usd', p_rate_usd),
          coalesce(p_effective_from::timestamptz, now()), 'server',
          nextval('worker_server_seq'))
  on conflict (kind, idempotency_key) do nothing;

  return new_id;
end $$;

-- record_certification — append a cert to the ledger + a WORKER_CERTIFIED event.
-- Idempotent on idempotency_key.
create or replace function record_certification(
  p_worker_id       text,
  p_cert_kind       text,
  p_issued_at       date,
  p_expires_at      date,
  p_issuer          text,
  p_doc_ref         text,
  p_idempotency_key text
) returns bigint
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare new_id bigint;
begin
  -- replay guard scoped to THIS command kind (WORKER_CERTIFIED) — see the
  -- worker_stream_event (kind, idempotency_key) namespace note.
  if exists (select 1 from worker_stream_event
              where idempotency_key = p_idempotency_key and kind = 'WORKER_CERTIFIED') then
    select (payload->>'cert_id')::bigint into new_id
      from worker_stream_event
     where idempotency_key = p_idempotency_key and kind = 'WORKER_CERTIFIED';
    return new_id;
  end if;
  if not exists (select 1 from workers where id = p_worker_id) then
    raise exception 'unknown worker %', p_worker_id using errcode = 'foreign_key_violation';
  end if;

  insert into worker_certifications (worker_id, cert_kind, issued_at, expires_at, issuer, doc_ref)
  values (p_worker_id, p_cert_kind, p_issued_at, p_expires_at, p_issuer, p_doc_ref)
  returning id into new_id;

  insert into worker_stream_event (idempotency_key, stream_key, kind, payload,
                                   occurred_at, device_id, device_seq)
  values (p_idempotency_key, 'worker:' || p_worker_id, 'WORKER_CERTIFIED',
          jsonb_build_object('worker_id', p_worker_id, 'cert_kind', p_cert_kind, 'cert_id', new_id),
          coalesce(p_issued_at::timestamptz, now()), 'server',
          nextval('worker_server_seq'))
  on conflict (kind, idempotency_key) do nothing;

  return new_id;
end $$;

-- rehire_worker — the dignity moment. Reactivate a rehire-eligible worker into a new
-- season's crew with a FRESH membership + a WORKER_REHIRED event, carrying identity +
-- still-valid certs forward (never re-keying history). Raises if not rehire-eligible.
-- Idempotent on idempotency_key.
create or replace function rehire_worker(
  p_worker_id       text,
  p_crew_id         text,
  p_season          text,
  p_occurred_at     timestamptz,
  p_device_id       text,
  p_device_seq      bigint,
  p_idempotency_key text
) returns uuid
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare existing uuid; new_uid uuid; eligible boolean; valid_certs int;
begin
  -- replay guard scoped to THIS command kind (WORKER_REHIRED) — see the
  -- worker_stream_event (kind, idempotency_key) namespace note. Scoping here is what
  -- stops a rehire reusing an enroll/sign/certify key from short-circuiting on that
  -- foreign event and falsely reporting success while skipping the eligibility gate.
  select event_uid into existing from worker_stream_event
   where idempotency_key = p_idempotency_key and kind = 'WORKER_REHIRED';
  if existing is not null then
    return existing;                                  -- exactly-once replay
  end if;

  select rehire_eligible into eligible from worker_identity where worker_id = p_worker_id;
  if eligible is null then
    raise exception 'unknown worker %', p_worker_id using errcode = 'foreign_key_violation';
  end if;
  if not eligible then
    raise exception 'worker % is not rehire-eligible', p_worker_id using errcode = 'check_violation';
  end if;
  if not exists (select 1 from crews where id = p_crew_id) then
    raise exception 'unknown crew %', p_crew_id using errcode = 'foreign_key_violation';
  end if;

  -- close any stale active membership, open a fresh one in the new crew/season.
  update crew_memberships set left_at = p_occurred_at
   where worker_id = p_worker_id and left_at is null;
  insert into crew_memberships (worker_id, crew_id, joined_at)
  values (p_worker_id, p_crew_id, p_occurred_at);

  -- stamp the crew with the season (so the roster reflects the rehire season).
  update crews set season = coalesce(p_season, season) where id = p_crew_id;

  -- carry valid certs forward = they already live in worker_certifications and are
  -- never re-keyed; count them for the event payload (the "still-valid cert" proof).
  select count(*) into valid_certs from v_worker_certs_valid where worker_id = p_worker_id;

  insert into worker_stream_event (idempotency_key, stream_key, kind, payload,
                                   occurred_at, device_id, device_seq)
  values (p_idempotency_key, 'worker:' || p_worker_id, 'WORKER_REHIRED',
          jsonb_build_object('worker_id', p_worker_id, 'crew_id', p_crew_id,
                             'season', p_season, 'valid_certs', valid_certs),
          p_occurred_at, p_device_id, p_device_seq)
  on conflict (kind, idempotency_key) do nothing
  returning event_uid into new_uid;
  if new_uid is null then
    select event_uid into new_uid from worker_stream_event
     where idempotency_key = p_idempotency_key and kind = 'WORKER_REHIRED';
  end if;

  perform _resync_worker_crew(p_worker_id);
  return new_uid;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 11. RLS — authenticated-only read on every new table; the append-only ledgers
--     additionally `force` RLS and get NO write policy (immutability at the policy
--     layer too, mirroring lot_event).
-- ──────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'crews','crew_memberships','worker_identity','worker_stream_event',
    'attendance_event','por_obra_contracts','worker_certifications'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
    execute format($p$create policy "authenticated read" on %I for select to authenticated using (true);$p$, t);
  end loop;
end $$;

-- the append-only PII/evidence ledgers force RLS so even the owner reads via policy.
alter table worker_stream_event  force row level security;
alter table attendance_event     force row level security;
alter table por_obra_contracts   force row level security;
alter table worker_certifications force row level security;

-- ──────────────────────────────────────────────────────────────────────────
-- 12. GRANTS (AD-8). Per-object SELECT to authenticated on every new table/view;
--     EXECUTE on the caller-facing command RPCs (revoke public first); NOTHING to
--     anon; internal helpers (leading underscore) and trigger fns get NO grant.
-- ──────────────────────────────────────────────────────────────────────────
grant select on crews                  to authenticated;
grant select on crew_memberships       to authenticated;
grant select on worker_identity        to authenticated;
grant select on worker_stream_event    to authenticated;
grant select on attendance_event       to authenticated;
grant select on por_obra_contracts     to authenticated;
grant select on worker_certifications  to authenticated;
grant select on v_crew_roster          to authenticated;
grant select on worker_attendance_today to authenticated;
grant select on v_worker_certs_valid   to authenticated;

-- Slam PUBLIC EXECUTE shut on every function, then grant only the caller-facing RPCs
-- (and the invoker rate-resolver) to authenticated. Trigger/helper fns get nothing.
revoke execute on function record_attendance(text, text, text, timestamptz, text, bigint, text)            from public;
revoke execute on function enroll_crew_member(text, text, timestamptz, text, bigint, text)                 from public;
revoke execute on function sign_por_obra_contract(text, text, text, numeric, date, date, text, text)        from public;
revoke execute on function record_certification(text, text, date, date, text, text, text)                  from public;
revoke execute on function rehire_worker(text, text, text, timestamptz, text, bigint, text)                from public;
revoke execute on function v_active_por_obra(text, text, date)                                             from public;
revoke execute on function next_server_seq()                                                              from public;
-- _backfill_people is an owner/seed-only helper (called by this migration + seed.sql,
-- never from the REST API); slam its PUBLIC execute shut and grant it to NO REST role.
revoke execute on function _backfill_people()                    from public;
revoke execute on function worker_stream_event_set_hash()        from public;
revoke execute on function attendance_event_set_hash()           from public;
revoke execute on function worker_ledger_block_mutation()        from public;
revoke execute on function por_obra_block_mutation()             from public;
revoke execute on function worker_certifications_block_mutation() from public;
-- _resync_* are owner/RPC-internal projection helpers, invoked only via `perform`
-- from the SECURITY DEFINER command RPCs (which run as the function owner, so they
-- still call these fine). Postgres grants PUBLIC EXECUTE by default; the AD-8
-- invariant ("internal helpers get NO grant") was silently missing these two, so
-- they were reachable by anon/authenticated REST. Grant them to NO REST role.
revoke execute on function _resync_worker_crew(text)             from public;
revoke execute on function _resync_worker_attendance(text)       from public;

grant execute on function record_attendance(text, text, text, timestamptz, text, bigint, text)            to authenticated;
grant execute on function enroll_crew_member(text, text, timestamptz, text, bigint, text)                 to authenticated;
grant execute on function sign_por_obra_contract(text, text, text, numeric, date, date, text, text)        to authenticated;
grant execute on function record_certification(text, text, date, date, text, text, text)                  to authenticated;
grant execute on function rehire_worker(text, text, text, timestamptz, text, bigint, text)                to authenticated;
grant execute on function v_active_por_obra(text, text, date)                                             to authenticated;
grant execute on function next_server_seq()                                                              to authenticated;
-- verify_chain(text) was redefined above (section 7a) to be stream-aware. CREATE OR
-- REPLACE preserves the original grant posture, but restate it to keep the AD-8
-- posture explicit and audit-legible.
revoke execute on function verify_chain(text) from public;
grant  execute on function verify_chain(text) to authenticated;

commit;
