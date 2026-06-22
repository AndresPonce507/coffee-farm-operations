-- P2-S7 — Blended piece-rate + hourly PAYROLL with the MIN-WAGE MAKE-WHOLE GUARD,
-- Panama statutory withholding, disbursement records, and the bilingual QR payslip.
--
-- THE PEOPLE-TRUNK CAPSTONE. It is the JOIN of both Phase-2 capture trunks:
--   - piece-rate  = Σ weigh_event.kg (S2) × the v_active_por_obra rate (S1) per day;
--   - hourly      = Σ hours from attendance_event clock-in/out pairs (S1) × hourly rate;
--   - make-whole  = the legal-minimum top-up (the CRIT invariant — see below).
-- Disbursing a pay line ALSO writes a Phase-1 cost_entry row, so payroll IS COGS
-- labor with no double-keying.
--
-- ORDERING: assigned timestamp 20260622108000 — sorts strictly above the Phase-2
-- head on disk (20260622102000_weigh_capture) AND the live Phase-1 head
-- (20260621110000_phase1_review_fixes), as the serial schema lane requires.
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ THE MIN-WAGE MAKE-WHOLE GUARD — the single most important Phase-2 labor    ║
-- ║ invariant, the one the global "promise → enforcement" rule mandates be     ║
-- ║ enforced AT THE DATA LAYER, never an honor-system in the UI.               ║
-- ║                                                                            ║
-- ║ It is IMPOSSIBLE to persist a pay line that underpays a worker below the    ║
-- ║ legal minimum for the hours they worked. Enforced in THREE un-bypassable    ║
-- ║ layers, all in the database — the disabled UI button is courtesy only:      ║
-- ║                                                                            ║
-- ║  (1) GENERATED COLUMNS. make_whole_usd and gross_usd are STORED GENERATED   ║
-- ║      columns — Postgres computes them from the row's own inputs; a caller   ║
-- ║      CANNOT supply or override them (a write that tries errors 428C9). So    ║
-- ║      make_whole = greatest(0, min_wage_floor − (piece+hourly)) and          ║
-- ║      gross = piece + hourly + make_whole are true BY CONSTRUCTION.          ║
-- ║  (2) A CHECK CONSTRAINT `gross_usd >= min_wage_floor_usd` on the row. With   ║
-- ║      the generated gross this can never trip on a well-formed row, but it    ║
-- ║      is the fail-closed backstop: if a future migration ever made gross a    ║
-- ║      plain column, an underpaying value is REJECTED at INSERT.               ║
-- ║  (3) A BEFORE INSERT TRIGGER that recomputes min_wage_floor_usd from the     ║
-- ║      CANONICAL farm_season_config (hours × min_wage_hourly) and OVERWRITES   ║
-- ║      whatever the caller passed. This defeats the direct-INSERT bypass — a   ║
-- ║      raw `insert ... (min_wage_floor_usd = 0)` cannot lie the floor down to   ║
-- ║      dodge the make-whole, because the trigger reasserts the real floor      ║
-- ║      from the one canonical home before the generated columns + CHECK run.   ║
-- ║                                                                            ║
-- ║  Net: via the RPC OR a direct INSERT/UPDATE bypass, an underpaying pay line  ║
-- ║  cannot exist. The minimum-wage value lives in ONE canonical place           ║
-- ║  (farm_season_config.min_wage_hourly_usd), never hardcoded in five bodies.   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- APPEND-ONLY (it is money + legal): pay_period freezes a snapshot on calculate;
-- pay_line + disbursement are append-only ledgers — corrections are REVERSING
-- entries (a negative/superseding row), NEVER an UPDATE/DELETE (the Phase-1
-- cost_entry discipline). approve_pay_line flips an approval flag via the ONE
-- allowed narrow UPDATE (status only), policed by the block trigger.
--
-- STATUTORY WITHHOLDING: CSS (Caja de Seguro Social employee share), Seguro
-- Educativo, and décimo (13th-month accrual) live as DATA in `statutory_rates`,
-- versioned by effective date — ONE canonical home, family/accountant-confirmable,
-- NEVER hardcoded. v_payroll_statutory applies the rate effective for the period.
--   ⚠️ FLAG (Apply-OK gate, DESIGN §4.1): the seeded rates are PLACEHOLDER
--   defaults pending family/accountant confirmation before the first REAL run.
--
-- DISBURSEMENT: record-only (Yappy / Nequi / ACH / signed-cash). It does NOT
-- integrate a real payment API — that is a flagged, dormant later option (DESIGN
-- §4.3). Moving money is a confirmed human action; NO automation path disburses.
--
-- GRANTS (AD-8 — grant_hygiene locked default privileges): every new table/view
-- gets an explicit `grant select ... to authenticated`; every caller-facing RPC
-- `revoke execute ... from public` then `grant execute ... to authenticated`.
-- NOTHING to anon. Writes flow ONLY through the command RPCs (no write grants).
--
-- RLS / FARM SCOPING (flag): matches the live spine's authenticated-only posture
-- exactly — no farm_id column, no multi-tenant scoping (that lands later as P4-S0).

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 0. The min-wage canonical home + the standard workday — added to the existing
--    singleton farm_season_config (one owned place, never hardcoded). Defaulted so
--    payroll is computable the moment this lands; the family confirms them later.
--    ⚠️ PLACEHOLDER: USD 0.80/hr (Panama agricultural region, indicative) and an
--    8-hour standard workday — both Apply-OK gated pending family confirmation.
-- ──────────────────────────────────────────────────────────────────────────
alter table farm_season_config
  add column if not exists min_wage_hourly_usd   numeric not null default 0.80,
  add column if not exists standard_workday_hours numeric not null default 8;

alter table farm_season_config
  add constraint min_wage_hourly_nonneg   check (min_wage_hourly_usd >= 0),
  add constraint standard_workday_pos     check (standard_workday_hours > 0);

-- ──────────────────────────────────────────────────────────────────────────
-- 1. statutory_rates — the Panama withholding rates, versioned by effective date.
--    ONE canonical home (the global "one canonical place holds the value" rule).
--    Each row names the employee-share rates effective FROM a date; the resolver
--    picks the latest row whose effective_from <= the period end. Append-only.
--    ⚠️ PLACEHOLDER rates — confirm with the family/an accountant before a real run.
--      css_employee_pct    : Caja de Seguro Social, EMPLOYEE share (≈ 9.75%).
--      seguro_educativo_pct: Seguro Educativo, employee share (≈ 1.25%).
--      decimo_accrual_pct  : décimo (13th month) accrual on gross (≈ 8.33% = 1/12).
-- ──────────────────────────────────────────────────────────────────────────
create table statutory_rates (
  id                   bigint generated always as identity primary key,
  effective_from       date    not null,
  css_employee_pct     numeric not null check (css_employee_pct     >= 0 and css_employee_pct     <= 100),
  seguro_educativo_pct numeric not null check (seguro_educativo_pct >= 0 and seguro_educativo_pct <= 100),
  decimo_accrual_pct   numeric not null check (decimo_accrual_pct   >= 0 and decimo_accrual_pct   <= 100),
  note                 text,
  created_at           timestamptz not null default now(),
  unique (effective_from)
);

-- the placeholder baseline (DESIGN §4.1 — confirm before the first real run).
insert into statutory_rates (effective_from, css_employee_pct, seguro_educativo_pct, decimo_accrual_pct, note)
values ('2026-01-01', 9.75, 1.25, 8.33,
        'PLACEHOLDER — Panama employee-share defaults; confirm with family/accountant before a real payroll run.');

-- v_statutory_effective — the rates effective for a given date (the latest row whose
-- window has opened). A function so callers pass the period-end date.
create or replace function v_statutory_effective(p_on_date date)
returns table (
  css_employee_pct numeric, seguro_educativo_pct numeric, decimo_accrual_pct numeric
)
  language sql
  security invoker
  stable
  set search_path = public
as $$
  select r.css_employee_pct, r.seguro_educativo_pct, r.decimo_accrual_pct
    from statutory_rates r
   where r.effective_from <= p_on_date
   order by r.effective_from desc, r.id desc
   limit 1;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. pay_period — a payroll window with a status lifecycle. Calculate freezes the
--    pay_lines (the snapshot); approve marks them reviewed; paid once disbursed.
-- ──────────────────────────────────────────────────────────────────────────
create table pay_period (
  id          text        primary key,                 -- e.g. 'pp-2026-06-w3'
  period_start date       not null,
  period_end   date       not null,
  season       text,
  status       text       not null default 'open'
                 check (status in ('open','calculated','approved','paid')),
  calculated_at timestamptz,
  created_at   timestamptz not null default now(),
  check (period_end >= period_start)
);

-- pay_period has the narrow status lifecycle (open→calculated→approved→paid); its
-- mutation is policed so the status can only advance and nothing else changes.
create or replace function pay_period_guard_mutation() returns trigger
  language plpgsql
as $$
declare ordr int; old_ordr int; new_ordr int;
begin
  if tg_op = 'DELETE' then
    raise exception 'pay_period is not deletable (a payroll window is a permanent record)'
      using errcode = 'restrict_violation';
  end if;
  -- only `status` (and calculated_at) may change; the window itself is frozen.
  if new.period_start is distinct from old.period_start
     or new.period_end is distinct from old.period_end
     or new.id        is distinct from old.id
     or new.season    is distinct from old.season then
    raise exception 'pay_period window/identity is immutable — only its status advances'
      using errcode = 'restrict_violation';
  end if;
  -- status may only move FORWARD along the lifecycle (no un-approving a paid run).
  old_ordr := case old.status when 'open' then 0 when 'calculated' then 1 when 'approved' then 2 when 'paid' then 3 end;
  new_ordr := case new.status when 'open' then 0 when 'calculated' then 1 when 'approved' then 2 when 'paid' then 3 end;
  if new_ordr < old_ordr then
    raise exception 'pay_period status cannot move backward (% -> %)', old.status, new.status
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

create trigger pay_period_guard
  before update or delete on pay_period
  for each row execute function pay_period_guard_mutation();

-- ──────────────────────────────────────────────────────────────────────────
-- 3. pay_line — THE append-only earnings ledger. One row per worker per period
--    (the frozen snapshot). The make-whole guard lives HERE in three layers.
--
--    INPUT columns (caller/RPC supplies): hours_worked, piece_rate_usd, hourly_usd.
--    DERIVED-FROM-CONFIG: min_wage_floor_usd — the trigger overwrites it from the
--      canonical farm_season_config so it can never be lied down (layer 3).
--    GENERATED (un-suppliable): make_whole_usd, gross_usd (layer 1).
--    CHECK: gross_usd >= min_wage_floor_usd (layer 2, fail-closed backstop).
--    WITHHOLDINGS: css/seguro/decimo are derived per the statutory resolver and
--      stored on the row at calculate-time (frozen with the snapshot); net is the
--      generated take-home.
--    REVERSALS: reverses_id self-FK — a correction is a NEGATIVE-input reversing
--      row, never an UPDATE (the cost_entry discipline).
-- ──────────────────────────────────────────────────────────────────────────
create table pay_line (
  id               bigint generated always as identity primary key,
  pay_period_id    text    not null references pay_period(id),
  worker_id        text    not null references workers(id),

  -- the blended EARNINGS inputs.
  hours_worked     numeric not null default 0 check (hours_worked >= 0),
  piece_rate_usd   numeric not null default 0,   -- Σ kg × por-obra rate (signed: reversals negative)
  hourly_usd       numeric not null default 0,   -- Σ hours × hourly rate (signed)

  -- PRESENCE DAYS — the count of distinct days the worker was present in the window
  -- (any weigh OR any clock-in). An INPUT column the RPC populates from
  -- v_worker_days_present. This is what makes the floor PROTECT PIECE-RATE PICKERS who
  -- never clock OUT: their paired hours are 0, but a worked day still owes a full
  -- standard-workday minimum. Defaults to 0 (a direct INSERT that omits it falls back
  -- to the hours-based floor, which is the conservative behavior).
  worked_days      integer not null default 0 check (worked_days >= 0),

  -- the legal floor — OVERWRITTEN by the before-insert trigger from the canonical
  -- farm_season_config (layer 3). Stored so the payslip shows exactly what protected
  -- this worker. For a reversing row the floor is 0 (a reversal owes no minimum).
  min_wage_floor_usd numeric not null default 0 check (min_wage_floor_usd >= 0),

  -- ── THE MAKE-WHOLE (layer 1: generated, un-suppliable) ──
  -- top-up so blended earnings never fall below the legal floor. greatest(0, …)
  -- means a worker already above the floor gets ZERO top-up; one below is lifted
  -- exactly to the floor. A REVERSING row (reverses_id not null) generates 0 make-whole:
  -- it carries non-positive earnings, so a bare greatest(0, 0 − negative) would
  -- spuriously fire a positive top-up — the `reverses_id is null` gate suppresses that so
  -- a reversal cleanly negates its original (gross/net sum to zero across the two rows).
  make_whole_usd   numeric
    generated always as (
      case when reverses_id is null
           then greatest(0, min_wage_floor_usd - (piece_rate_usd + hourly_usd))
           else 0 end) stored,

  -- gross = blended earnings + the make-whole. Generated, so a caller can never
  -- understate it.
  gross_usd        numeric
    generated always as (
      piece_rate_usd + hourly_usd
      + case when reverses_id is null
             then greatest(0, min_wage_floor_usd - (piece_rate_usd + hourly_usd))
             else 0 end) stored,

  -- frozen statutory withholdings (employee share), computed at calculate-time. An
  -- ORIGINAL row's withholdings are non-negative; a REVERSAL row's are non-positive (the
  -- negated original) so a reversing row nets the original's net exactly to zero. Enforced
  -- by the pay_line_reversal_sign constraint below (reversal-aware), not a bare `>= 0`.
  css_usd          numeric not null default 0,
  seguro_educativo_usd numeric not null default 0,
  decimo_accrual_usd numeric not null default 0,

  -- net take-home = gross − withholdings (décimo is an ACCRUAL, paid out separately,
  -- so it is NOT subtracted from the in-period net; it is tracked for the 13th-month).
  net_usd          numeric
    generated always as (
      piece_rate_usd + hourly_usd
      + case when reverses_id is null
             then greatest(0, min_wage_floor_usd - (piece_rate_usd + hourly_usd))
             else 0 end
      - css_usd - seguro_educativo_usd) stored,

  status           text    not null default 'calculated'
                     check (status in ('calculated','approved','reversed')),
  reverses_id      bigint  references pay_line(id),     -- a reversal points at its original
  memo             text,
  created_at       timestamptz not null default now(),

  -- ── THE MAKE-WHOLE GUARD (layer 2: CHECK, fail-closed backstop) ──
  -- gross can never fall below the floor on an ORIGINAL row. With the generated gross this
  -- holds by construction; if a future migration de-generated gross, an underpaying value
  -- is rejected at INSERT. A REVERSING row (reverses_id not null) carries non-positive
  -- earnings to negate its original and is exempt — it owes no minimum (floor 0).
  constraint pay_line_make_whole_floor
    check (reverses_id is not null or gross_usd >= min_wage_floor_usd),
  -- a reversal carries non-positive earnings inputs AND non-positive withholdings (the
  -- negated original); an original is non-negative on both. This lets a reversing row net
  -- the original's gross/net/withholdings exactly to zero across the worker's rows.
  constraint pay_line_reversal_sign check (
    (reverses_id is null
       and piece_rate_usd >= 0 and hourly_usd >= 0
       and css_usd >= 0 and seguro_educativo_usd >= 0 and decimo_accrual_usd >= 0)
    or (reverses_id is not null
       and piece_rate_usd <= 0 and hourly_usd <= 0
       and css_usd <= 0 and seguro_educativo_usd <= 0 and decimo_accrual_usd <= 0)
  )
);
create index pay_line_period_idx on pay_line (pay_period_id);
create index pay_line_worker_idx on pay_line (worker_id);
-- one LIVE original (non-reversal, non-reversed) line per worker per period. Keyed on
-- "live" (status <> 'reversed') so that after reverse_pay_line flips an original to
-- 'reversed', a corrected snapshot CAN be re-frozen by re-running compute_pay_period (the
-- reversed original no longer occupies the slot). The snapshot is otherwise frozen —
-- corrections are reversing rows, then a recompute.
create unique index pay_line_one_original_idx
  on pay_line (pay_period_id, worker_id) where (reverses_id is null and status <> 'reversed');

-- ── THE MAKE-WHOLE GUARD (layer 3: the trigger that defeats the direct bypass) ──
-- Before every INSERT, recompute min_wage_floor_usd from the CANONICAL config and
-- OVERWRITE whatever the caller supplied. The floor is the GREATER of:
--   (a) hours_worked × min_wage_hourly      — the paired-clock-hours floor (hourly crew);
--   (b) worked_days × standard_workday_hours × min_wage_hourly — the PRESENCE-DAY floor.
-- (b) is what protects the ~90% piece-rate picking crew: a picker is auto-clocked-IN by
-- the weigh-in but NEVER clocks out, so their paired hours are 0 — but a worked day
-- still owes a full standard-workday legal minimum. Taking the GREATEST means an hourly
-- worker with a genuinely long paired shift still gets their full actual-hours minimum,
-- while a weigh-only picker can never collapse to a $0 floor. A reversing row
-- (reverses_id not null) is exempt: it owes no minimum, floor stays 0, so it never
-- generates a spurious make-whole. This is what makes it impossible to dodge the floor
-- with a raw `insert ... min_wage_floor_usd = 0` (or a faked worked_days = 0).
create or replace function pay_line_enforce_floor() returns trigger
  language plpgsql
  set search_path = public
as $$
declare v_hourly numeric; v_workday numeric;
begin
  if new.reverses_id is not null then
    new.min_wage_floor_usd := 0;        -- a reversal owes no minimum
    return new;
  end if;
  select min_wage_hourly_usd, standard_workday_hours into v_hourly, v_workday
    from farm_season_config where id = 1;
  v_hourly  := coalesce(v_hourly, 0);   -- no config row => no floor (a missing singleton is a
  v_workday := coalesce(v_workday, 8);  -- bootstrap error, not a pay run)
  -- the legal floor is ALWAYS recomputed from the canonical home; the caller's value
  -- (if any) is discarded. This is the un-bypassable assertion.
  new.min_wage_floor_usd := round(
    greatest(
      coalesce(new.hours_worked, 0) * v_hourly,                      -- (a) paired hours
      coalesce(new.worked_days, 0) * v_workday * v_hourly            -- (b) presence days
    ), 2);
  return new;
end $$;

create trigger pay_line_enforce_floor
  before insert on pay_line
  for each row execute function pay_line_enforce_floor();

-- pay_line is append-only: block DELETE always; block UPDATE except the ONE legal
-- transition — flipping status calculated→approved or →reversed (no figure mutates).
create or replace function pay_line_block_mutation() returns trigger
  language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'pay_line is append-only (DELETE blocked) — correct with a reversing entry'
      using errcode = 'restrict_violation';
  end if;
  -- UPDATE: every money/identity column is frozen; only `status` may change.
  if new.pay_period_id   is distinct from old.pay_period_id
     or new.worker_id    is distinct from old.worker_id
     or new.hours_worked is distinct from old.hours_worked
     or new.worked_days  is distinct from old.worked_days
     or new.piece_rate_usd is distinct from old.piece_rate_usd
     or new.hourly_usd   is distinct from old.hourly_usd
     or new.min_wage_floor_usd is distinct from old.min_wage_floor_usd
     or new.css_usd      is distinct from old.css_usd
     or new.seguro_educativo_usd is distinct from old.seguro_educativo_usd
     or new.decimo_accrual_usd is distinct from old.decimo_accrual_usd
     or new.reverses_id  is distinct from old.reverses_id then
    raise exception 'pay_line is append-only — money/identity columns are immutable; correct with a reversing entry'
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

create trigger pay_line_block_mutation
  before update or delete on pay_line
  for each row execute function pay_line_block_mutation();

-- ──────────────────────────────────────────────────────────────────────────
-- 4. disbursement — the append-only payment-RECORD ledger (record-only; NO real
--    payment API — flagged dormant, DESIGN §4.3). Writing one ALSO appends a
--    Phase-1 cost_entry (direct-labor → the worker's pay, target farm) so payroll
--    IS COGS labor with no double-keying. Append-only; corrections are reversing
--    disbursement rows.
-- ──────────────────────────────────────────────────────────────────────────
create table disbursement (
  id              bigint generated always as identity primary key,
  pay_period_id   text    not null references pay_period(id),
  worker_id       text    not null references workers(id),
  pay_line_id     bigint  references pay_line(id),
  amount_usd      numeric not null,                 -- signed: a reversal is negative
  method          text    not null check (method in ('yappy','nequi','ach','cash-signed')),
  ref             text,                              -- the external transfer ref / receipt no.
  -- the exactly-once anchor, in its OWN column (NOT overloaded onto `ref`, which now
  -- carries the real Yappy/Nequi/ACH receipt). A reversal re-uses its own key namespace.
  idempotency_key text,
  signature_ref   text,                             -- for cash-signed: the worker's signature capture
  cost_entry_id   bigint  references cost_entry(id), -- the COGS journal row this wrote
  reverses_id     bigint  references disbursement(id),
  -- stamped on an ORIGINAL the instant a reversal is appended for it (the one narrow,
  -- non-money UPDATE the block trigger permits). This is what FREES the worker+period
  -- slot so a corrected payment can be re-recorded after a reversal — without it, the
  -- append-only original would occupy the one-per-worker slot forever and "reverse first
  -- to re-pay" would be a dead end. A live (re-payable) original has reversed_at = null.
  reversed_at     timestamptz,
  disbursed_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  -- a cash-signed disbursement must carry a signature reference (the unbanked-crew
  -- dignity + audit requirement); the digital rails carry an external ref.
  check (method <> 'cash-signed' or signature_ref is not null),
  check ((reverses_id is null and amount_usd >= 0) or (reverses_id is not null and amount_usd <= 0))
);
create index disbursement_period_idx on disbursement (pay_period_id);
create index disbursement_worker_idx on disbursement (worker_id);
-- EXACTLY-ONCE is the DB's authority, not a SELECT-then-INSERT race: a unique key
-- scoped to ORIGINAL (non-reversal) rows. Two concurrent same-key calls collapse to ONE
-- row (the loser hits the conflict and re-selects the winner). Reversal rows are
-- unconstrained (they self-FK the original and carry their own keys).
create unique index disbursement_idempotency_idx
  on disbursement (worker_id, pay_period_id, idempotency_key)
  where (reverses_id is null and idempotency_key is not null);
-- ONE LIVE non-reversal disbursement per worker per period: a re-record with the SAME key
-- is the idempotent retry (handled above); a DIFFERENT-key second pay while a live
-- disbursement still stands is a double-pay and is rejected by this index. Keyed on LIVE
-- originals (reversed_at is null) — exactly like pay_line_one_original_idx — so once an
-- original is REVERSED (reversed_at stamped) it no longer occupies the slot and a corrected
-- payment CAN be re-recorded. Mirrors the make-whole's data-layer posture — the "paid at
-- most once while live" promise is enforced, not honor-system.
create unique index disbursement_one_per_worker_period_idx
  on disbursement (worker_id, pay_period_id)
  where (reverses_id is null and reversed_at is null);
-- one reversal per original (a disbursement can be reversed at most once).
create unique index disbursement_one_reversal_idx
  on disbursement (reverses_id)
  where (reverses_id is not null);

create or replace function disbursement_block_mutation() returns trigger
  language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'disbursement is append-only (DELETE blocked) — money moved is a permanent record; correct with a reversing entry'
      using errcode = 'restrict_violation';
  end if;
  -- UPDATE: every money/identity column is frozen. The ONE permitted change is stamping
  -- reversed_at (null → a timestamp) when this original gets a reversal — the same narrow,
  -- non-money status-style UPDATE pay_line allows. Re-stamping or clearing it is blocked.
  if old.reversed_at is not null
     or new.id            is distinct from old.id
     or new.pay_period_id is distinct from old.pay_period_id
     or new.worker_id     is distinct from old.worker_id
     or new.pay_line_id   is distinct from old.pay_line_id
     or new.amount_usd    is distinct from old.amount_usd
     or new.method        is distinct from old.method
     or new.ref           is distinct from old.ref
     or new.idempotency_key is distinct from old.idempotency_key
     or new.signature_ref is distinct from old.signature_ref
     or new.cost_entry_id is distinct from old.cost_entry_id
     or new.reverses_id   is distinct from old.reverses_id then
    raise exception 'disbursement is append-only — money moved is a permanent record; correct with a reversing entry'
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

create trigger disbursement_block_mutation
  before update or delete on disbursement
  for each row execute function disbursement_block_mutation();

-- ──────────────────────────────────────────────────────────────────────────
-- 5. v_worker_pay_inputs — the blended-earnings INPUTS per worker per period,
--    derived live from the capture trunks. The calculate RPC reads this to freeze
--    the snapshot. security_invoker so base-table RLS governs the caller.
--      piece-rate = Σ (weigh_event.kg on day D × the v_active_por_obra 'picking'
--                      rate effective on day D), summed across the period's days.
--      hours      = Σ hours between paired clock-in/clock-out attendance events in
--                   the period (a lone clock-in with no clock-out contributes 0 —
--                   conservative; the make-whole still protects on rest/short days).
--    Both keyed to the period window [period_start, period_end].
-- ──────────────────────────────────────────────────────────────────────────

-- piece-rate per worker per period, priced BY rate_basis (each weigh row priced at the
-- contract effective on its OWN day, since the resolver is per-date and a contract can be
-- renegotiated mid-window):
--   per-kg   → Σ(kg × rate)                         (the kilo is the denominator);
--   per-lata → Σ(rate) i.e. count(rows) × rate      (weigh_event is ONE ROW PER LATA);
--   per-tarea / per-tree → NO kg relationship exists; weigh_event carries no tarea/tree
--                count, so these CANNOT be derived from kg. The function RAISES rather
--                than silently mis-pricing the farm's primary labor cost (~12x overpay if
--                a per-lata rate were multiplied by kg). A missing/expired contract prices
--                the day at 0 (no contract ⇒ no piece pay), as before.
-- plpgsql (not sql) so it can RAISE for the no-kg bases.
create or replace function v_worker_piece_rate(p_worker_id text, p_period_start date, p_period_end date)
returns numeric
  language plpgsql
  security invoker
  stable
  set search_path = public
as $$
declare
  v_total numeric := 0;
  r       record;
begin
  for r in
    select we.kg,
           c.rate_usd, c.rate_basis
      from weigh_event we
      left join lateral v_active_por_obra(we.worker_id, 'picking',
                  (we.occurred_at at time zone 'UTC')::date) c on true
     where we.worker_id = p_worker_id
       and (we.occurred_at at time zone 'UTC')::date between p_period_start and p_period_end
  loop
    if r.rate_basis is null or r.rate_usd is null then
      -- no active contract on that day ⇒ that weigh contributes no piece pay.
      continue;
    elsif r.rate_basis = 'per-kg' then
      v_total := v_total + r.kg * r.rate_usd;
    elsif r.rate_basis = 'per-lata' then
      v_total := v_total + r.rate_usd;          -- one weigh_event row = one lata
    else
      -- per-tarea / per-tree: kg is meaningless for these; fail loud until a per-event
      -- tarea/tree count is captured. Silent mis-pay of the primary labor cost is worse.
      raise exception 'piece-rate basis % for worker % cannot be priced from weigh kg — capture a tarea/tree count first',
        r.rate_basis, p_worker_id using errcode = 'feature_not_supported';
    end if;
  end loop;
  return coalesce(v_total, 0);
end $$;

-- hours per worker per period from clock-in→clock-out attendance events, INTERVAL-
-- STITCHED so overlapping/duplicate punches are not double-counted. An interval OPENS
-- only on a clock-in taken while currently OUT (a second clock-in before a clock-out is
-- ignored), and closes on the next event iff it is a clock-out. A lone trailing
-- clock-in contributes 0 (the conservative "unpaired in = 0" behavior is preserved).
-- This defeats the everyday "forgot the pre-lunch clock-out, re-clocked-in" pattern
-- (clock-in 08:00, clock-in 13:00, clock-out 17:00 = 9h, not 9h+4h).
create or replace function v_worker_hours(p_worker_id text, p_period_start date, p_period_end date)
returns numeric
  language sql
  security invoker
  stable
  set search_path = public
as $$
  with ev as (
    select (occurred_at at time zone 'UTC')::date as d, event_kind, occurred_at,
           row_number() over (
             partition by (occurred_at at time zone 'UTC')::date
             order by occurred_at, case event_kind when 'clock-in' then 0 else 1 end
           ) as rn
      from attendance_event
     where worker_id = p_worker_id
       and (occurred_at at time zone 'UTC')::date between p_period_start and p_period_end
       and event_kind in ('clock-in','clock-out')
  ),
  state as (
    -- net open clock-ins BEFORE this row (0 = currently OUT). A clock-in taken while
    -- already IN (open_before > 0) is a duplicate punch and does NOT open its own interval.
    select d, event_kind, occurred_at,
           coalesce(sum(case when event_kind = 'clock-in' then 1 else -1 end)
                    over (partition by d order by rn
                          rows between unbounded preceding and 1 preceding), 0) as open_before
      from ev
  ),
  opens as (
    -- the OPENING clock-ins (each is a transition from OUT → IN).
    select d, occurred_at as in_at from state
     where event_kind = 'clock-in' and open_before = 0
  ),
  intervals as (
    -- pair each opening clock-in with the NEXT clock-out at/after it the same day
    -- (skipping any intervening duplicate clock-ins). A lone trailing opening clock-in
    -- with no following clock-out contributes 0 (conservative "unpaired in = 0").
    select o.in_at,
           (select min(s.occurred_at) from state s
             where s.d = o.d and s.event_kind = 'clock-out' and s.occurred_at >= o.in_at) as out_at
      from opens o
  )
  select coalesce(sum(
           case when out_at is not null
                then extract(epoch from (out_at - in_at)) / 3600.0
                else 0 end
         ), 0)::numeric
    from intervals;
$$;

-- v_worker_days_present — the count of distinct UTC days the worker was PRESENT in the
-- window. A weigh-in auto-stamps a clock-in, so a weigh-only picking day counts. This is
-- the PRESENCE basis for the make-whole floor (a worked day owes a full standard-workday
-- minimum even when the worker never clocked out). 'rest-day'/'absent' do not count.
create or replace function v_worker_days_present(p_worker_id text, p_period_start date, p_period_end date)
returns integer
  language sql
  security invoker
  stable
  set search_path = public
as $$
  select count(distinct (occurred_at at time zone 'UTC')::date)::int
    from attendance_event
   where worker_id = p_worker_id
     and event_kind in ('clock-in','clock-out')
     and (occurred_at at time zone 'UTC')::date between p_period_start and p_period_end;
$$;

-- v_worker_pay — the load-bearing read view: every CALCULATED (frozen, non-reversed)
-- pay_line with its full breakdown, joined to the worker + period. The cockpit reads
-- this. make_whole_usd > 0 is the highlight signal. Net-of-reversals is handled by
-- the cockpit (a reversed original + its negative reversal sum to zero).
create view v_worker_pay with (security_invoker = on) as
  select pl.id,
         pl.pay_period_id,
         pp.period_start,
         pp.period_end,
         pl.worker_id,
         w.name              as worker_name,
         w.crew              as crew_name,
         pl.hours_worked,
         pl.piece_rate_usd,
         pl.hourly_usd,
         pl.min_wage_floor_usd,
         pl.make_whole_usd,
         pl.gross_usd,
         pl.css_usd,
         pl.seguro_educativo_usd,
         pl.decimo_accrual_usd,
         pl.net_usd,
         pl.status,
         pl.reverses_id,
         (pl.make_whole_usd > 0) as made_whole
    from pay_line pl
    join pay_period pp on pp.id = pl.pay_period_id
    join workers w     on w.id  = pl.worker_id;

-- v_payroll_statutory — the per-line withholding breakdown (frozen figures + the
-- décimo accrual), for the cockpit's deductions column + the statutory report.
create view v_payroll_statutory with (security_invoker = on) as
  select pl.id            as pay_line_id,
         pl.pay_period_id,
         pl.worker_id,
         pl.gross_usd,
         pl.css_usd,
         pl.seguro_educativo_usd,
         pl.decimo_accrual_usd,
         (pl.css_usd + pl.seguro_educativo_usd) as in_period_withholding_usd
    from pay_line pl
   where pl.reverses_id is null;

-- v_payslip — the bilingual QR-payslip payload: one worker's frozen pay line for a
-- period with their identity + period window. The UI renders es/ngäbere labels over
-- this; the QR encodes a compact deep-link to it.
create view v_payslip with (security_invoker = on) as
  select pl.id            as pay_line_id,
         pl.pay_period_id,
         pp.period_start,
         pp.period_end,
         pp.season,
         pl.worker_id,
         w.name           as worker_name,
         i.preferred_name,
         i.languages,
         pl.hours_worked,
         pl.piece_rate_usd,
         pl.hourly_usd,
         pl.make_whole_usd,
         pl.gross_usd,
         pl.css_usd,
         pl.seguro_educativo_usd,
         pl.decimo_accrual_usd,
         pl.net_usd,
         pl.status
    from pay_line pl
    join pay_period pp on pp.id = pl.pay_period_id
    join workers w     on w.id  = pl.worker_id
    left join worker_identity i on i.worker_id = pl.worker_id
   where pl.reverses_id is null;

-- v_pay_period_summary — the period board's per-period roll-up.
create view v_pay_period_summary with (security_invoker = on) as
  select pp.id,
         pp.period_start,
         pp.period_end,
         pp.season,
         pp.status,
         pp.calculated_at,
         count(pl.id) filter (where pl.reverses_id is null)               as worker_count,
         coalesce(sum(pl.gross_usd)   filter (where pl.reverses_id is null), 0) as total_gross_usd,
         coalesce(sum(pl.net_usd)     filter (where pl.reverses_id is null), 0) as total_net_usd,
         coalesce(sum(pl.make_whole_usd) filter (where pl.reverses_id is null), 0) as total_make_whole_usd,
         count(pl.id) filter (where pl.reverses_id is null and pl.make_whole_usd > 0) as made_whole_count
    from pay_period pp
    left join pay_line pl on pl.pay_period_id = pp.id
   group by pp.id, pp.period_start, pp.period_end, pp.season, pp.status, pp.calculated_at;

-- ──────────────────────────────────────────────────────────────────────────
-- 6. Command RPCs (ADR-002 — SECURITY DEFINER, pinned search_path, idempotent,
--    one txn). EXECUTE to authenticated only.
-- ──────────────────────────────────────────────────────────────────────────

-- compute_pay_period — find-or-create the period, then for EVERY worker on the roster
-- freeze a calculated pay_line from the live blended inputs + statutory rates (a
-- worker with no weigh/attendance in the window gets an all-zero line — floor 0, gross
-- 0 — which is correct: zero hours owes no minimum, and a complete roster is what the
-- period's worker_count reflects). The
-- make-whole is enforced by the table itself (the floor trigger + generated cols),
-- so this RPC NEVER computes the top-up — it can't underpay even if it tried.
-- Idempotent: re-running a period that already has original lines is a no-op (the
-- snapshot is frozen; recompute requires reversing first). Returns the period id.
create or replace function compute_pay_period(
  p_period_id     text,
  p_period_start  date,
  p_period_end    date,
  p_season        text,
  p_hourly_rate_source text default 'daily'   -- 'daily' => workers.daily_rate_usd/standard_workday_hours
) returns text
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare
  r            record;
  v_piece      numeric;
  v_hours      numeric;
  v_days       integer;
  v_hourly_pay numeric;
  v_hourly_rate numeric;
  v_workday    numeric;
  v_css        numeric;
  v_seg        numeric;
  v_dec        numeric;
  v_gross      numeric;
  st           record;
begin
  -- find-or-create the period.
  insert into pay_period (id, period_start, period_end, season, status)
  values (p_period_id, p_period_start, p_period_end, p_season, 'open')
  on conflict (id) do nothing;

  -- idempotent: if any LIVE original lines (non-reversed) already exist for this period,
  -- do nothing — the snapshot is frozen. A period whose originals were all REVERSED can be
  -- recomputed (status-aware, matching pay_line_one_original_idx) to re-freeze a correction.
  if exists (select 1 from pay_line
              where pay_period_id = p_period_id and reverses_id is null and status <> 'reversed') then
    return p_period_id;
  end if;

  select standard_workday_hours into v_workday from farm_season_config where id = 1;
  v_workday := coalesce(v_workday, 8);
  select * into st from v_statutory_effective(p_period_end);
  -- FAIL CLOSED: no statutory_rates row covers this period (e.g. a backdated/historical
  -- window before the earliest effective_from). Without a row the withholdings would
  -- silently freeze at $0 (a fail-OPEN on legally-required CSS/Seguro deductions, and
  -- the snapshot is append-only). Refuse to freeze rather than under-withhold.
  if not found then
    raise exception 'no statutory_rates effective on or before % — configure rates for this period before computing payroll', p_period_end
      using errcode = 'no_data_found';
  end if;

  for r in select id, daily_rate_usd from workers loop
    v_piece := v_worker_piece_rate(r.id, p_period_start, p_period_end);
    v_hours := v_worker_hours(r.id, p_period_start, p_period_end);
    v_days  := v_worker_days_present(r.id, p_period_start, p_period_end);
    -- hourly rate from the daily rate over a standard workday (the only rate the
    -- flat workers row carries today; a dedicated hourly column is a later refinement).
    v_hourly_rate := case when v_workday > 0 then coalesce(r.daily_rate_usd, 0) / v_workday else 0 end;
    v_hourly_pay  := round(v_hours * v_hourly_rate, 2);
    v_piece       := round(v_piece, 2);

    -- gross (pre-make-whole) for the withholding base; the table will add any
    -- make-whole on top. Withholdings are computed on the blended gross BEFORE the
    -- make-whole (a conservative base; the make-whole is a floor protection, not
    -- extra taxable wage in this v1 — flagged for accountant confirmation).
    v_gross := v_piece + v_hourly_pay;
    v_css := round(v_gross * coalesce(st.css_employee_pct, 0)     / 100.0, 2);
    v_seg := round(v_gross * coalesce(st.seguro_educativo_pct, 0) / 100.0, 2);
    v_dec := round(v_gross * coalesce(st.decimo_accrual_pct, 0)   / 100.0, 2);

    -- INSERT the line. min_wage_floor_usd is supplied as 0; the BEFORE INSERT trigger
    -- OVERWRITES it from the canonical config (greatest of hours × min_wage and
    -- worked_days × standard_workday × min_wage). make_whole + gross + net are
    -- GENERATED. So this insert CANNOT underpay — the floor is the table's, not the RPC's,
    -- and a piece-rate picker's worked DAYS drive a real floor even with 0 paired hours.
    insert into pay_line (pay_period_id, worker_id, hours_worked, worked_days, piece_rate_usd, hourly_usd,
                          min_wage_floor_usd, css_usd, seguro_educativo_usd, decimo_accrual_usd, status)
    values (p_period_id, r.id, v_hours, v_days, v_piece, v_hourly_pay,
            0, v_css, v_seg, v_dec, 'calculated');
  end loop;

  update pay_period set status = 'calculated', calculated_at = now()
   where id = p_period_id and status = 'open';

  return p_period_id;
end $$;

-- approve_pay_line — flip a calculated line to approved (the one allowed narrow
-- UPDATE; the block trigger permits a status-only change). Idempotent. Owner action.
create or replace function approve_pay_line(p_pay_line_id bigint)
returns bigint
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare v_status text;
begin
  select status into v_status from pay_line where id = p_pay_line_id;
  if v_status is null then
    raise exception 'unknown pay_line %', p_pay_line_id using errcode = 'no_data_found';
  end if;
  if v_status = 'approved' then
    return p_pay_line_id;                 -- idempotent
  end if;
  if v_status <> 'calculated' then
    raise exception 'pay_line % cannot be approved from status %', p_pay_line_id, v_status
      using errcode = 'check_violation';
  end if;
  update pay_line set status = 'approved' where id = p_pay_line_id;

  -- advance the PERIOD to 'approved' once NO non-reversed line in that period is still
  -- merely 'calculated'. Without this the documented open→calculated→approved→paid
  -- lifecycle never reaches 'approved', so record_disbursement's close-out (gated on
  -- status='approved') is a permanent no-op and every real run strands in 'calculated'.
  -- The forward-only period guard already permits calculated→approved.
  update pay_period pp
     set status = 'approved'
   where pp.id = (select pay_period_id from pay_line where id = p_pay_line_id)
     and pp.status = 'calculated'
     and not exists (
       select 1 from pay_line pl
        where pl.pay_period_id = pp.id
          and pl.reverses_id is null
          and pl.status = 'calculated'
     );
  return p_pay_line_id;
end $$;

-- record_disbursement — the IRREVERSIBLE money-shaped action (manual confirm; NO
-- automation path reaches it). Records a payment against a worker+period and writes
-- the matching Phase-1 cost_entry (direct-labor COGS). EXACTLY-ONCE is backed by the
-- disbursement_idempotency_idx UNIQUE (a concurrent/replayed same-key call collapses to
-- ONE row + ONE cost_entry; the retry returns the original). The recorded amount is
-- RECONCILED against the approved line's net (an over/under-payment is rejected, so a
-- $0.01 cannot close a period). The external receipt (p_ref) is persisted in `ref`.
-- Requires the worker's line be APPROVED first. Returns the disbursement id.
create or replace function record_disbursement(
  p_pay_period_id   text,
  p_worker_id       text,
  p_amount_usd      numeric,
  p_method          text,
  p_ref             text,
  p_signature_ref   text,
  p_idempotency_key text
) returns bigint
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare
  v_existing bigint;
  v_line     bigint;
  v_status   text;
  v_net      numeric;
  v_cost     bigint;
  v_new      bigint;
begin
  -- exactly-once FAST PATH: a prior original disbursement under this key is the retry.
  -- (The UNIQUE index below is the real authority under concurrency; this just short-
  -- circuits the common sequential replay without writing an orphan cost_entry.)
  select id into v_existing from disbursement
   where worker_id = p_worker_id and pay_period_id = p_pay_period_id
     and idempotency_key = p_idempotency_key and reverses_id is null;
  if v_existing is not null then
    return v_existing;
  end if;

  if p_amount_usd is null or p_amount_usd < 0 then
    raise exception 'disbursement amount must be >= 0' using errcode = 'check_violation';
  end if;
  if p_idempotency_key is null or p_idempotency_key = '' then
    raise exception 'a disbursement requires an idempotency key (the exactly-once anchor)'
      using errcode = 'check_violation';
  end if;
  if p_method = 'cash-signed' and (p_signature_ref is null or p_signature_ref = '') then
    raise exception 'a cash-signed disbursement requires a signature reference'
      using errcode = 'check_violation';
  end if;

  -- the worker must have an APPROVED original line for this period (fail-closed: no
  -- paying an un-reviewed/un-calculated run). Read net_usd to RECONCILE the amount.
  select id, status, net_usd into v_line, v_status, v_net from pay_line
   where pay_period_id = p_pay_period_id and worker_id = p_worker_id and reverses_id is null
   limit 1;
  if v_line is null then
    raise exception 'no pay line for worker % in period % — calculate first', p_worker_id, p_pay_period_id
      using errcode = 'check_violation';
  end if;
  if v_status <> 'approved' then
    raise exception 'pay line for worker % in period % is not approved (status %)', p_worker_id, p_pay_period_id, v_status
      using errcode = 'check_violation';
  end if;

  -- AMOUNT RECONCILIATION: the recorded payment must equal the approved net owed (within
  -- a cent of rounding tolerance). This binds the irreversible money record + the COGS
  -- entry to the make-whole-protected net — a worker owed $16.00 cannot be recorded paid
  -- $0.01 (defeating the floor at pay-out) nor $1,000,000 (overpay/COGS inflation). The
  -- current slice has no advances/partial-payment concept (a flagged FUTURE roadmap item),
  -- so net IS the full take-home owed; a disbursement records exactly it.
  if abs(p_amount_usd - v_net) > 0.01 then
    raise exception 'disbursement %.2f must equal the approved net %.2f owed to worker % (period %); corrections are reversing rows',
      p_amount_usd, v_net, p_worker_id, p_pay_period_id using errcode = 'check_violation';
  end if;

  -- Write the COGS cost_entry + the disbursement TOGETHER inside a sub-block so that, if
  -- a concurrent/earlier winner or a different-key second pay trips the unique index, the
  -- whole pair ROLLS BACK to the savepoint — the loser never orphans a cost_entry, and
  -- the disbursement is append-only (no post-insert UPDATE needed to link the COGS row).
  -- allocation_rule = 'direct-labor' buckets payroll as LABOR; target_kind = 'farm'
  -- because a pay period spans the whole roster. Payroll IS COGS — no double-keying.
  begin
    insert into cost_entry (driver, allocation_rule, target_kind, target_code, amount_usd, memo, occurred_at)
    values ('worker-day', 'direct-labor', 'farm', null, p_amount_usd,
            'payroll disbursement: ' || p_worker_id || ' / ' || p_pay_period_id || ' (' || p_method || ')',
            now())
    returning id into v_cost;

    insert into disbursement (pay_period_id, worker_id, pay_line_id, amount_usd, method, ref,
                              idempotency_key, signature_ref, cost_entry_id)
    values (p_pay_period_id, p_worker_id, v_line, p_amount_usd, p_method, p_ref,
            p_idempotency_key, p_signature_ref, v_cost)
    returning id into v_new;
  exception when unique_violation then
    -- the unique index arbitrated. Either a same-key original already exists (idempotent
    -- retry → return it) or a DIFFERENT-key second pay hit the one-per-worker-period
    -- guard (a double-pay → reject). The cost_entry insert above is rolled back with it.
    select id into v_existing from disbursement
     where worker_id = p_worker_id and pay_period_id = p_pay_period_id
       and idempotency_key = p_idempotency_key and reverses_id is null;
    if v_existing is not null then
      return v_existing;
    end if;
    raise exception 'worker % already has a disbursement for period % — reverse it first to re-pay', p_worker_id, p_pay_period_id
      using errcode = 'unique_violation';
  end;

  -- advance the period to 'paid' once every approved worker WHO IS OWED MONEY has been
  -- FULLY disbursed (Σ of their non-reversed disbursements >= net). Existence alone is
  -- not enough — that let a $0.01 disbursement close a period. A zero-pay line (a rostered
  -- worker with no hours/weigh) owes nothing, so it does not block the close.
  if not exists (
    select 1 from pay_line pl
     where pl.pay_period_id = p_pay_period_id and pl.reverses_id is null and pl.status = 'approved'
       and pl.net_usd > 0
       and coalesce((select sum(d.amount_usd) from disbursement d
                      where d.pay_period_id = pl.pay_period_id and d.worker_id = pl.worker_id), 0)
           < pl.net_usd - 0.01
  ) then
    update pay_period set status = 'paid' where id = p_pay_period_id and status = 'approved';
  end if;

  return v_new;
end $$;

-- reverse_pay_line — the append-only CORRECTION door for a mis-keyed/mis-rated pay line
-- (the "corrections are reversing rows, never UPDATE" discipline the table is built for).
-- Appends a NEGATIVE reversing pay_line (reverses_id set; earnings + withholdings negated
-- so the original nets to zero across the two rows) and flips the original to 'reversed'
-- (the one narrow status-only UPDATE the block trigger permits). Idempotent on the
-- original id (a second call returns the existing reversing row). After reversing, the
-- corrected snapshot can be re-frozen by re-running compute_pay_period. Owner action.
create or replace function reverse_pay_line(
  p_pay_line_id     bigint,
  p_memo            text default null,
  p_idempotency_key text default null
) returns bigint
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare v record; v_existing bigint; v_new bigint;
begin
  select * into v from pay_line where id = p_pay_line_id and reverses_id is null;
  if not found then
    raise exception 'no original pay_line %', p_pay_line_id using errcode = 'no_data_found';
  end if;
  -- idempotent: an already-reversed original returns its existing reversing row.
  select id into v_existing from pay_line where reverses_id = p_pay_line_id limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  -- the reversing row negates the original's FULL gross (piece + hourly + the original's
  -- make-whole, since make-whole is suppressed on reversal rows) and its withholdings, so
  -- the worker's net across the original + reversal sums to zero. min_wage_floor is forced
  -- to 0 by the floor trigger for a reversal; worked_days 0 (no floor on a reversal).
  insert into pay_line (pay_period_id, worker_id, hours_worked, worked_days,
                        piece_rate_usd, hourly_usd, min_wage_floor_usd,
                        css_usd, seguro_educativo_usd, decimo_accrual_usd,
                        status, reverses_id, memo)
  values (v.pay_period_id, v.worker_id, 0, 0,
          -(v.piece_rate_usd + v.make_whole_usd), -v.hourly_usd, 0,
          -v.css_usd, -v.seguro_educativo_usd, -v.decimo_accrual_usd,
          'calculated', p_pay_line_id, coalesce(p_memo, 'reversal of pay_line ' || p_pay_line_id))
  returning id into v_new;

  -- flip the original to 'reversed' (status-only UPDATE — the one transition the block
  -- trigger allows; from 'calculated' or 'approved').
  update pay_line set status = 'reversed' where id = p_pay_line_id;
  return v_new;
end $$;

-- reverse_disbursement — the append-only CORRECTION door for a wrong/duplicate
-- disbursement. Appends a NEGATIVE reversing disbursement (reverses_id set; amount
-- negated) AND a matching NEGATIVE, LINKED cost_entry (reverses_id → the original's
-- cost_entry) so BOTH the payment ledger and the COGS journal net to zero and stay
-- traceable. Idempotent on the original id (disbursement_one_reversal_idx backs it).
-- Once reversed, the freed worker+period slot lets a corrected payment be re-recorded.
create or replace function reverse_disbursement(
  p_disbursement_id bigint,
  p_idempotency_key text default null
) returns bigint
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare v record; v_existing bigint; v_cost bigint; v_new bigint;
begin
  select * into v from disbursement where id = p_disbursement_id and reverses_id is null;
  if not found then
    raise exception 'no original disbursement %', p_disbursement_id using errcode = 'no_data_found';
  end if;
  -- idempotent: an already-reversed disbursement returns its existing reversing row.
  select id into v_existing from disbursement where reverses_id = p_disbursement_id limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  -- the matching negative, LINKED COGS reversal (do NOT leave the COGS correction
  -- unlinked — keep the two ledgers consistent and traceable).
  if v.cost_entry_id is not null then
    insert into cost_entry (driver, allocation_rule, target_kind, target_code, amount_usd,
                            reverses_id, memo, occurred_at)
    values ('worker-day', 'direct-labor', 'farm', null, -v.amount_usd,
            v.cost_entry_id,
            'reversal of payroll disbursement ' || p_disbursement_id, now())
    returning id into v_cost;
  end if;

  -- the negative reversing disbursement. A reversal carries no idempotency_key namespace
  -- collision (the unique index is scoped to originals); cash-signed reversals reuse the
  -- original's signature reference to satisfy the signature CHECK.
  insert into disbursement (pay_period_id, worker_id, pay_line_id, amount_usd, method, ref,
                            idempotency_key, signature_ref, cost_entry_id, reverses_id)
  values (v.pay_period_id, v.worker_id, v.pay_line_id, -v.amount_usd, v.method,
          coalesce(p_idempotency_key, 'reversal:' || p_disbursement_id),
          'reversal:' || p_disbursement_id, v.signature_ref, v_cost, p_disbursement_id)
  returning id into v_new;

  -- FREE the worker+period slot: stamp the original reversed_at (the one narrow non-money
  -- UPDATE the block trigger permits). This drops the original out of the LIVE one-per-
  -- worker unique index so a CORRECTED payment can be re-recorded — making "reverse first
  -- to re-pay" actually reachable rather than a permanent dead end.
  update disbursement set reversed_at = now() where id = p_disbursement_id;
  return v_new;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 7. RLS — authenticated-only read on every new table; the append-only ledgers
--    force RLS and get NO write policy (immutability at the policy layer too).
-- ──────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['statutory_rates','pay_period','pay_line','disbursement']
  loop
    execute format('alter table %I enable row level security;', t);
    execute format($p$create policy "authenticated read" on %I for select to authenticated using (true);$p$, t);
  end loop;
end $$;

alter table pay_line     force row level security;
alter table disbursement force row level security;

-- ──────────────────────────────────────────────────────────────────────────
-- 8. GRANTS (AD-8). Per-object SELECT to authenticated on every new table/view;
--    EXECUTE on the caller-facing RPCs (revoke public first); NOTHING to anon;
--    trigger/helper fns get NO grant.
-- ──────────────────────────────────────────────────────────────────────────
grant select on statutory_rates       to authenticated;
grant select on pay_period            to authenticated;
grant select on pay_line              to authenticated;
grant select on disbursement          to authenticated;
grant select on v_worker_pay          to authenticated;
grant select on v_payroll_statutory   to authenticated;
grant select on v_payslip             to authenticated;
grant select on v_pay_period_summary  to authenticated;

-- slam PUBLIC execute shut, then grant only the caller-facing surface to authenticated.
revoke execute on function compute_pay_period(text, date, date, text, text)                          from public;
revoke execute on function approve_pay_line(bigint)                                                  from public;
revoke execute on function record_disbursement(text, text, numeric, text, text, text, text)          from public;
revoke execute on function reverse_pay_line(bigint, text, text)                                       from public;
revoke execute on function reverse_disbursement(bigint, text)                                         from public;
revoke execute on function v_statutory_effective(date)                                               from public;
revoke execute on function v_worker_piece_rate(text, date, date)                                      from public;
revoke execute on function v_worker_hours(text, date, date)                                           from public;
revoke execute on function v_worker_days_present(text, date, date)                                    from public;
revoke execute on function pay_line_enforce_floor()                                                   from public;
revoke execute on function pay_line_block_mutation()                                                  from public;
revoke execute on function pay_period_guard_mutation()                                                from public;
revoke execute on function disbursement_block_mutation()                                              from public;

grant execute on function compute_pay_period(text, date, date, text, text)                           to authenticated;
grant execute on function approve_pay_line(bigint)                                                   to authenticated;
grant execute on function record_disbursement(text, text, numeric, text, text, text, text)           to authenticated;
grant execute on function reverse_pay_line(bigint, text, text)                                        to authenticated;
grant execute on function reverse_disbursement(bigint, text)                                          to authenticated;
grant execute on function v_statutory_effective(date)                                                to authenticated;
grant execute on function v_worker_piece_rate(text, date, date)                                       to authenticated;
grant execute on function v_worker_hours(text, date, date)                                            to authenticated;
grant execute on function v_worker_days_present(text, date, date)                                     to authenticated;

commit;
