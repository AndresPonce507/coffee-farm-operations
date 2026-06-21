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

  -- the legal floor — OVERWRITTEN by the before-insert trigger from the canonical
  -- farm_season_config (layer 3). Stored so the payslip shows exactly what protected
  -- this worker. For a reversing row the floor is 0 (a reversal owes no minimum).
  min_wage_floor_usd numeric not null default 0 check (min_wage_floor_usd >= 0),

  -- ── THE MAKE-WHOLE (layer 1: generated, un-suppliable) ──
  -- top-up so blended earnings never fall below the legal floor. greatest(0, …)
  -- means a worker already above the floor gets ZERO top-up; one below is lifted
  -- exactly to the floor. A reversing row (floor 0) generates 0 make-whole.
  make_whole_usd   numeric
    generated always as (greatest(0, min_wage_floor_usd - (piece_rate_usd + hourly_usd))) stored,

  -- gross = blended earnings + the make-whole. Generated, so a caller can never
  -- understate it.
  gross_usd        numeric
    generated always as (piece_rate_usd + hourly_usd
                         + greatest(0, min_wage_floor_usd - (piece_rate_usd + hourly_usd))) stored,

  -- frozen statutory withholdings (employee share), computed at calculate-time.
  css_usd          numeric not null default 0 check (css_usd    >= 0),
  seguro_educativo_usd numeric not null default 0 check (seguro_educativo_usd >= 0),
  decimo_accrual_usd numeric not null default 0 check (decimo_accrual_usd >= 0),

  -- net take-home = gross − withholdings (décimo is an ACCRUAL, paid out separately,
  -- so it is NOT subtracted from the in-period net; it is tracked for the 13th-month).
  net_usd          numeric
    generated always as (piece_rate_usd + hourly_usd
                         + greatest(0, min_wage_floor_usd - (piece_rate_usd + hourly_usd))
                         - css_usd - seguro_educativo_usd) stored,

  status           text    not null default 'calculated'
                     check (status in ('calculated','approved','reversed')),
  reverses_id      bigint  references pay_line(id),     -- a reversal points at its original
  memo             text,
  created_at       timestamptz not null default now(),

  -- ── THE MAKE-WHOLE GUARD (layer 2: CHECK, fail-closed backstop) ──
  -- gross can never fall below the floor. With the generated gross this holds by
  -- construction; if a future migration de-generated gross, an underpaying value is
  -- rejected at INSERT. (A reversing row has floor 0, so gross<=0 still satisfies it.)
  constraint pay_line_make_whole_floor check (gross_usd >= min_wage_floor_usd),
  -- a reversal carries non-positive earnings inputs; an original is non-negative.
  constraint pay_line_reversal_sign check (
    (reverses_id is null     and piece_rate_usd >= 0 and hourly_usd >= 0)
    or (reverses_id is not null and piece_rate_usd <= 0 and hourly_usd <= 0)
  )
);
create index pay_line_period_idx on pay_line (pay_period_id);
create index pay_line_worker_idx on pay_line (worker_id);
-- one ORIGINAL (non-reversal) calculated line per worker per period — re-calculating
-- requires reversing first (the snapshot is frozen, corrections are reversing rows).
create unique index pay_line_one_original_idx
  on pay_line (pay_period_id, worker_id) where (reverses_id is null);

-- ── THE MAKE-WHOLE GUARD (layer 3: the trigger that defeats the direct bypass) ──
-- Before every INSERT, recompute min_wage_floor_usd from the CANONICAL config —
-- hours_worked × min_wage_hourly_usd — and OVERWRITE whatever the caller supplied.
-- A reversing row (reverses_id not null) is exempt: it owes no minimum, floor stays
-- 0, so it never generates a spurious make-whole. This is what makes it impossible
-- to dodge the floor with a raw `insert ... min_wage_floor_usd = 0`.
create or replace function pay_line_enforce_floor() returns trigger
  language plpgsql
  set search_path = public
as $$
declare v_hourly numeric;
begin
  if new.reverses_id is not null then
    new.min_wage_floor_usd := 0;        -- a reversal owes no minimum
    return new;
  end if;
  select min_wage_hourly_usd into v_hourly from farm_season_config where id = 1;
  if v_hourly is null then
    v_hourly := 0;                       -- no config row => no floor (fail-open is wrong here, but
  end if;                                -- a missing singleton is a bootstrap error, not a pay run)
  -- the legal floor is ALWAYS recomputed from the canonical home; the caller's value
  -- (if any) is discarded. This is the un-bypassable assertion.
  new.min_wage_floor_usd := round(coalesce(new.hours_worked, 0) * v_hourly, 2);
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
  signature_ref   text,                             -- for cash-signed: the worker's signature capture
  cost_entry_id   bigint  references cost_entry(id), -- the COGS journal row this wrote
  reverses_id     bigint  references disbursement(id),
  disbursed_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  -- a cash-signed disbursement must carry a signature reference (the unbanked-crew
  -- dignity + audit requirement); the digital rails carry an external ref.
  check (method <> 'cash-signed' or signature_ref is not null),
  check ((reverses_id is null and amount_usd >= 0) or (reverses_id is not null and amount_usd <= 0))
);
create index disbursement_period_idx on disbursement (pay_period_id);
create index disbursement_worker_idx on disbursement (worker_id);

create or replace function disbursement_block_mutation() returns trigger
  language plpgsql
as $$
begin
  raise exception 'disbursement is append-only (% blocked) — money moved is a permanent record; correct with a reversing entry', tg_op
    using errcode = 'restrict_violation';
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

-- piece-rate per worker per period: each weigh row priced at the rate effective on
-- its own day (the rate-resolver is per-date), then summed.
create or replace function v_worker_piece_rate(p_worker_id text, p_period_start date, p_period_end date)
returns numeric
  language sql
  security invoker
  stable
  set search_path = public
as $$
  select coalesce(sum(
           we.kg * coalesce(
             (select r.rate_usd from v_active_por_obra(we.worker_id, 'picking',
                                                       (we.occurred_at at time zone 'UTC')::date) r),
             0)
         ), 0)
    from weigh_event we
   where we.worker_id = p_worker_id
     and (we.occurred_at at time zone 'UTC')::date between p_period_start and p_period_end;
$$;

-- hours per worker per period from paired clock-in→clock-out attendance events.
-- Pairs each clock-in with the NEXT clock-out the same UTC day; unpaired in = 0.
create or replace function v_worker_hours(p_worker_id text, p_period_start date, p_period_end date)
returns numeric
  language sql
  security invoker
  stable
  set search_path = public
as $$
  with day_events as (
    select (occurred_at at time zone 'UTC')::date as d, event_kind, occurred_at
      from attendance_event
     where worker_id = p_worker_id
       and (occurred_at at time zone 'UTC')::date between p_period_start and p_period_end
       and event_kind in ('clock-in','clock-out')
  ),
  paired as (
    select ci.d,
           ci.occurred_at as in_at,
           (select min(co.occurred_at) from day_events co
             where co.d = ci.d and co.event_kind = 'clock-out' and co.occurred_at >= ci.occurred_at) as out_at
      from day_events ci
     where ci.event_kind = 'clock-in'
  )
  select coalesce(sum(
           case when out_at is not null
                then extract(epoch from (out_at - in_at)) / 3600.0
                else 0 end
         ), 0)::numeric
    from paired;
$$;

-- the days-worked count (distinct clock-in days) — for the workday-based floor:
-- the legal minimum is per-hour, applied to the hours actually worked.
create or replace function v_worker_hours_total(p_worker_id text, p_period_start date, p_period_end date)
returns numeric
  language sql security invoker stable set search_path = public
as $$ select v_worker_hours(p_worker_id, p_period_start, p_period_end); $$;

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

  -- idempotent: if any original lines already exist for this period, do nothing.
  if exists (select 1 from pay_line where pay_period_id = p_period_id and reverses_id is null) then
    return p_period_id;
  end if;

  select standard_workday_hours into v_workday from farm_season_config where id = 1;
  v_workday := coalesce(v_workday, 8);
  select * into st from v_statutory_effective(p_period_end);

  for r in select id, daily_rate_usd from workers loop
    v_piece := v_worker_piece_rate(r.id, p_period_start, p_period_end);
    v_hours := v_worker_hours(r.id, p_period_start, p_period_end);
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
    -- OVERWRITES it from the canonical config (hours × min_wage_hourly). make_whole +
    -- gross + net are GENERATED. So this insert CANNOT underpay — the floor is the
    -- table's, not this RPC's.
    insert into pay_line (pay_period_id, worker_id, hours_worked, piece_rate_usd, hourly_usd,
                          min_wage_floor_usd, css_usd, seguro_educativo_usd, decimo_accrual_usd, status)
    values (p_period_id, r.id, v_hours, v_piece, v_hourly_pay,
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
  return p_pay_line_id;
end $$;

-- record_disbursement — the IRREVERSIBLE money-shaped action (manual confirm; NO
-- automation path reaches it). Records a payment against a worker+period and writes
-- the matching Phase-1 cost_entry (direct-labor COGS). Idempotent on idempotency_key
-- (carried as the ref so a retry is one disbursement). Requires the worker's line be
-- APPROVED first (no paying an un-reviewed run). Returns the disbursement id.
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
  v_cost     bigint;
  v_new      bigint;
begin
  -- exactly-once: the idempotency_key is stored as the disbursement ref namespace.
  select id into v_existing from disbursement
   where worker_id = p_worker_id and pay_period_id = p_pay_period_id
     and ref = p_idempotency_key;
  if v_existing is not null then
    return v_existing;
  end if;

  if p_amount_usd is null or p_amount_usd < 0 then
    raise exception 'disbursement amount must be >= 0' using errcode = 'check_violation';
  end if;
  if p_method = 'cash-signed' and (p_signature_ref is null or p_signature_ref = '') then
    raise exception 'a cash-signed disbursement requires a signature reference'
      using errcode = 'check_violation';
  end if;

  -- the worker must have an APPROVED original line for this period (fail-closed: no
  -- paying an un-reviewed/un-calculated run).
  select id, status into v_line, v_status from pay_line
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

  -- write the Phase-1 COGS labor cost_entry. allocation_rule = 'direct-labor' so cost
  -- reports bucket payroll as LABOR (not overhead); target_kind = 'farm' because a pay
  -- period spans the whole roster, not a single lot (the cost_entry CHECK allows any
  -- rule with a farm target). Payroll IS COGS — no double-keying.
  insert into cost_entry (driver, allocation_rule, target_kind, target_code, amount_usd, memo, occurred_at)
  values ('worker-day', 'direct-labor', 'farm', null, p_amount_usd,
          'payroll disbursement: ' || p_worker_id || ' / ' || p_pay_period_id || ' (' || p_method || ')',
          now())
  returning id into v_cost;

  insert into disbursement (pay_period_id, worker_id, pay_line_id, amount_usd, method, ref,
                            signature_ref, cost_entry_id)
  values (p_pay_period_id, p_worker_id, v_line, p_amount_usd, p_method, p_idempotency_key,
          p_signature_ref, v_cost)
  returning id into v_new;

  -- advance the period to 'paid' once every approved worker WHO IS OWED MONEY has a
  -- disbursement. A zero-pay line (a rostered worker with no hours/weigh in the window)
  -- owes nothing, so it does NOT need a $0 disbursement to let the period close — this
  -- avoids a complete-roster period stranding in 'approved' on noise lines.
  if not exists (
    select 1 from pay_line pl
     where pl.pay_period_id = p_pay_period_id and pl.reverses_id is null and pl.status = 'approved'
       and pl.net_usd > 0
       and not exists (select 1 from disbursement d
                        where d.pay_period_id = pl.pay_period_id and d.worker_id = pl.worker_id
                          and d.reverses_id is null)
  ) then
    update pay_period set status = 'paid' where id = p_pay_period_id and status = 'approved';
  end if;

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
revoke execute on function v_statutory_effective(date)                                               from public;
revoke execute on function v_worker_piece_rate(text, date, date)                                      from public;
revoke execute on function v_worker_hours(text, date, date)                                           from public;
revoke execute on function v_worker_hours_total(text, date, date)                                     from public;
revoke execute on function pay_line_enforce_floor()                                                   from public;
revoke execute on function pay_line_block_mutation()                                                  from public;
revoke execute on function pay_period_guard_mutation()                                                from public;
revoke execute on function disbursement_block_mutation()                                              from public;

grant execute on function compute_pay_period(text, date, date, text, text)                           to authenticated;
grant execute on function approve_pay_line(bigint)                                                   to authenticated;
grant execute on function record_disbursement(text, text, numeric, text, text, text, text)           to authenticated;
grant execute on function v_statutory_effective(date)                                                to authenticated;
grant execute on function v_worker_piece_rate(text, date, date)                                       to authenticated;
grant execute on function v_worker_hours(text, date, date)                                            to authenticated;
grant execute on function v_worker_hours_total(text, date, date)                                      to authenticated;

commit;
