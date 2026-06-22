// P2-S7 — Blended PAYROLL with the MIN-WAGE MAKE-WHOLE GUARD (the CRIT invariant).
// SQL tests that replay the REAL migrations in PGlite (S1 people + S2 weigh + this
// slice) and prove the slice's load-bearing data-layer invariants + AD-8 grants.
//
// THE CRIT INVARIANT — the make-whole guard is un-bypassable AT THE DATA LAYER:
//   - a piece-rate worker whose blended earnings fall below the legal minimum is
//     TOPPED UP to the minimum (make_whole_usd > 0, gross == floor);
//   - an attempt to PERSIST a below-minimum pay line is REJECTED at the DB — BOTH
//     via the RPC path (it can't underpay) AND via a direct INSERT/UPDATE bypass
//     (the floor trigger reasserts the canonical floor; generated cols + CHECK win).
// Plus: blended piece-rate+hourly calc; withholding math; append-only (reversing,
// never mutate); the disbursement→cost_entry COGS write; AD-8 grant posture.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asAuthenticated, freshDb, type Harness } from "./pgliteHarness";

// ──────────────────────────────────────────────────────────────────────────
// Fixtures. A plot, two pickers on an active crew, a por-obra picking rate, and a
// configured min wage. One picker weighs a LOT of cherries (above the floor); the
// other barely anything (a slow-ripening week — below the floor → make-whole fires).
// ──────────────────────────────────────────────────────────────────────────
const PLOT = `insert into plots (id, ord, name, block, variety, area_ha, altitude_masl, trees,
  shade_pct, established_year, status, last_inspected, expected_yield_kg, harvested_kg, geom, centroid)
  values ('p-pay', 91, 'Pay Plot', 'Block P', 'Geisha', 4.2, 1690, 14800, 55, 2014, 'healthy',
    '2026-06-18', 18600, 12120,
    '{"type":"Polygon","coordinates":[[[-82.641,8.776],[-82.639,8.776],[-82.639,8.778],[-82.641,8.778],[-82.641,8.776]]]}'::jsonb,
    '{"type":"Point","coordinates":[-82.640344,8.777835]}'::jsonb);`;

const WORKERS = `insert into workers (id, name, role, daily_rate_usd, attendance, started_year, phone, today_kg, crew) values
  ('w-big','Big Picker',  'Picker', 24, 'present', 2019, '+507 0', 0, 'Crew Tizingal'),
  ('w-low','Low Picker',  'Picker', 24, 'present', 2020, '+507 1', 0, 'Crew Tizingal');`;

const NEAR_LAT = 8.777835,
  NEAR_LNG = -82.640344;

let SEQ = 6000;
const seq = () => SEQ++;

const PERIOD_START = "2026-06-15";
const PERIOD_END = "2026-06-21";
const PERIOD_ID = "pp-test-w3";

async function weigh(
  h: Harness,
  worker: string,
  kg: number,
  key: string,
  day = "2026-06-18",
): Promise<void> {
  await h.query(
    `select record_weigh_in('${worker}','p-pay',${kg},'ripe'::ripeness,null,'manual',
       ${NEAR_LAT},${NEAR_LNG},'${day}T15:00:00Z'::timestamptz,'dev-field',${seq()},'${key}');`,
  );
}

async function seedFarm(h: Harness): Promise<void> {
  await h.query(PLOT);
  await h.query(WORKERS);
  await h.query(`select _backfill_people();`);
  // a picking por-obra rate for both workers (USD 2.00 / kg, effective the period).
  await h.query(
    `select sign_por_obra_contract('w-big','picking','per-kg',2.00,'2026-06-01',null,'sig-big','por-big');`,
  );
  await h.query(
    `select sign_por_obra_contract('w-low','picking','per-kg',2.00,'2026-06-01',null,'sig-low','por-low');`,
  );
  // a generous min wage so the LOW picker's piece-rate falls under it: USD 2.00/hr.
  await h.query(`update farm_season_config set min_wage_hourly_usd = 2.00, standard_workday_hours = 8 where id = 1;`);
  // big picker: 50 kg → 100 USD piece-rate (well above any plausible floor).
  await weigh(h, "w-big", 50, "wb1");
  // low picker: 1 kg → 2 USD piece-rate (far below the floor for a worked day).
  await weigh(h, "w-low", 1, "wl1");
}

// ════════════════════════════════════════════════════════════════════════════
// THE CRIT: the make-whole guard, three layers, un-bypassable.
// ════════════════════════════════════════════════════════════════════════════
describe("P2-S7 CRIT — the min-wage make-whole guard is un-bypassable at the DB", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedFarm(h);
    await h.query(
      `select compute_pay_period('${PERIOD_ID}','${PERIOD_START}','${PERIOD_END}','2026-2027','daily');`,
    );
  });
  afterAll(async () => h.close());

  it("tops up a below-minimum piece-rate worker to the legal floor (make_whole > 0, gross == floor)", async () => {
    const r = await h.query<{
      piece: string;
      floor: string;
      make_whole: string;
      gross: string;
    }>(
      `select piece_rate_usd as piece, min_wage_floor_usd as floor,
              make_whole_usd as make_whole, gross_usd as gross
         from pay_line where worker_id = 'w-low' and reverses_id is null;`,
    );
    const floor = Number(r[0].floor);
    const makeWhole = Number(r[0].make_whole);
    const gross = Number(r[0].gross);
    // ROOT 1 (the headline CRIT): the low picker weighed 1 kg ($2 piece) and never
    // clocked OUT — pickers don't. The floor MUST come from worked-DAYS presence, not
    // paired clocked hours, or it collapses to $0 for ~90% of the crew. With a presence
    // day × 8h standard workday × $2.00/hr the legal floor is $16.00, so the make-whole
    // tops the $2 piece up to exactly the floor. (Pre-fix: floor=0, make_whole=0, gross=2.)
    expect(floor).toBeCloseTo(16.0, 2);
    expect(makeWhole).toBeCloseTo(14.0, 2);
    expect(gross).toBeCloseTo(16.0, 2);
    expect(gross).toBeGreaterThanOrEqual(floor - 0.001);
    expect(makeWhole).toBeCloseTo(Math.max(0, floor - Number(r[0].piece)), 2);
  });

  it("a worker ABOVE the floor gets ZERO make-whole (no spurious top-up)", async () => {
    const r = await h.query<{ make_whole: string; gross: string; piece: string }>(
      `select make_whole_usd as make_whole, gross_usd as gross, piece_rate_usd as piece
         from pay_line where worker_id = 'w-big' and reverses_id is null;`,
    );
    expect(Number(r[0].make_whole)).toBe(0);
    expect(Number(r[0].gross)).toBeCloseTo(Number(r[0].piece), 2);
  });

  it("make_whole_usd and gross_usd are GENERATED — a caller cannot supply them (layer 1)", async () => {
    await expect(
      h.query(
        `insert into pay_line (pay_period_id, worker_id, hours_worked, piece_rate_usd, hourly_usd, gross_usd)
           values ('${PERIOD_ID}','w-big', 8, 1, 0, 0);`,
      ),
    ).rejects.toThrow(/generated|cannot insert|428C9|column "gross_usd"/i);
  });

  it("DIRECT-INSERT BYPASS is defeated: lying min_wage_floor_usd=0 is overwritten from canonical config (layer 3)", async () => {
    // attacker tries to persist an underpaying line directly: 8 hours worked, only
    // 1 USD piece-rate, and floor faked to 0 to dodge the make-whole.
    await h.query(
      `insert into pay_line (pay_period_id, worker_id, hours_worked, piece_rate_usd, hourly_usd, min_wage_floor_usd)
         values ('${PERIOD_ID}','w-big', 8, 1, 0, 0)
         on conflict do nothing;`,
    );
    // there is already an original w-big line (one-original unique index); insert a
    // fresh worker to avoid the unique index and isolate the floor-trigger behavior.
    await h.query(
      `insert into workers (id, name, role, daily_rate_usd, attendance, started_year, phone, today_kg, crew)
         values ('w-bypass','Bypass','Picker',24,'present',2020,'+507 9',0,'Crew Tizingal');`,
    );
    await h.query(
      `insert into pay_line (pay_period_id, worker_id, hours_worked, piece_rate_usd, hourly_usd, min_wage_floor_usd)
         values ('${PERIOD_ID}','w-bypass', 8, 1, 0, 0);`,  // floor faked to 0
    );
    const r = await h.query<{ floor: string; make_whole: string; gross: string }>(
      `select min_wage_floor_usd as floor, make_whole_usd as make_whole, gross_usd as gross
         from pay_line where worker_id = 'w-bypass' and reverses_id is null;`,
    );
    // the trigger reasserted the REAL floor = 8h × 2.00/hr = 16.00; the make-whole
    // lifted gross from 1 to 16 despite the caller's lie. The bypass is defeated.
    expect(Number(r[0].floor)).toBeCloseTo(16.0, 2);
    expect(Number(r[0].make_whole)).toBeCloseTo(15.0, 2);
    expect(Number(r[0].gross)).toBeCloseTo(16.0, 2);
  });

  it("the CHECK floor-backstop holds: gross_usd is never below the floor on any row", async () => {
    const r = await h.query<{ n: number }>(
      `select count(*)::int as n from pay_line where gross_usd < min_wage_floor_usd - 0.0001;`,
    );
    expect(r[0].n).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Blended calc: piece-rate × por-obra rate + hourly from attendance hours.
// ════════════════════════════════════════════════════════════════════════════
describe("P2-S7 — blended piece-rate + hourly calculation", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedFarm(h);
    // give w-big a real clock-in→clock-out pair = 5 hours, so hourly is non-zero.
    await h.query(
      `select record_attendance('w-big','clock-in','p-pay','2026-06-19T13:00:00Z'::timestamptz,'dev-a',${seq()},'att-in-big');`,
    );
    await h.query(
      `select record_attendance('w-big','clock-out','p-pay','2026-06-19T18:00:00Z'::timestamptz,'dev-a',${seq()},'att-out-big');`,
    );
    await h.query(
      `select compute_pay_period('${PERIOD_ID}','${PERIOD_START}','${PERIOD_END}','2026-2027','daily');`,
    );
  });
  afterAll(async () => h.close());

  it("piece-rate = Σ kg × the por-obra rate (50 kg × 2.00 = 100.00)", async () => {
    const r = await h.query<{ piece: string }>(
      `select piece_rate_usd as piece from pay_line where worker_id='w-big' and reverses_id is null;`,
    );
    expect(Number(r[0].piece)).toBeCloseTo(100.0, 2);
  });

  it("hourly = paired clock-in/out hours × hourly rate (5h × 24/8 = 15.00)", async () => {
    const r = await h.query<{ hours: string; hourly: string }>(
      `select hours_worked as hours, hourly_usd as hourly from pay_line where worker_id='w-big' and reverses_id is null;`,
    );
    expect(Number(r[0].hours)).toBeCloseTo(5.0, 2);
    expect(Number(r[0].hourly)).toBeCloseTo(15.0, 2); // 24/8=3 per hour × 5
  });

  it("gross blends both legs (100 piece + 15 hourly = 115.00, above floor → no make-whole)", async () => {
    const r = await h.query<{ gross: string; make_whole: string }>(
      `select gross_usd as gross, make_whole_usd as make_whole from pay_line where worker_id='w-big' and reverses_id is null;`,
    );
    expect(Number(r[0].gross)).toBeCloseTo(115.0, 2);
    expect(Number(r[0].make_whole)).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Statutory withholding math (CSS / Seguro Educativo / décimo from the config rates).
// ════════════════════════════════════════════════════════════════════════════
describe("P2-S7 — statutory withholding from the canonical rate table", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedFarm(h);
    // pin the rates so the math is exact: CSS 10%, Seguro 1%, décimo 8.33%.
    await h.query(
      `insert into statutory_rates (effective_from, css_employee_pct, seguro_educativo_pct, decimo_accrual_pct, note)
         values ('2026-06-01', 10, 1, 8.33, 'test-pin');`,
    );
    await h.query(
      `select compute_pay_period('${PERIOD_ID}','${PERIOD_START}','${PERIOD_END}','2026-2027','daily');`,
    );
  });
  afterAll(async () => h.close());

  it("CSS + Seguro + décimo are computed on the blended gross at the effective rates", async () => {
    const r = await h.query<{
      gross: string;
      css: string;
      seg: string;
      dec: string;
      net: string;
    }>(
      `select gross_usd as gross, css_usd as css, seguro_educativo_usd as seg,
              decimo_accrual_usd as dec, net_usd as net
         from pay_line where worker_id='w-big' and reverses_id is null;`,
    );
    // w-big: 50kg × 2.00 = 100 piece (no paired hours here → 0 hourly). gross 100.
    const gross = Number(r[0].gross);
    expect(gross).toBeCloseTo(100.0, 2);
    expect(Number(r[0].css)).toBeCloseTo(10.0, 2); // 10% of 100
    expect(Number(r[0].seg)).toBeCloseTo(1.0, 2); // 1%
    expect(Number(r[0].dec)).toBeCloseTo(8.33, 2); // 8.33%
    // net = gross − css − seguro (décimo is an accrual, NOT in-period deducted).
    expect(Number(r[0].net)).toBeCloseTo(100 - 10 - 1, 2);
  });

  it("v_statutory_effective resolves the LATEST window that has opened", async () => {
    const r = await h.query<{ css: string }>(
      `select css_employee_pct as css from v_statutory_effective('${PERIOD_END}'::date);`,
    );
    expect(Number(r[0].css)).toBe(10); // the 2026-06-01 pin beats the 2026-01-01 baseline
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Append-only: pay_line + disbursement reverse, never mutate.
// ════════════════════════════════════════════════════════════════════════════
describe("P2-S7 — append-only ledgers (reverse, never mutate)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedFarm(h);
    await h.query(
      `select compute_pay_period('${PERIOD_ID}','${PERIOD_START}','${PERIOD_END}','2026-2027','daily');`,
    );
  });
  afterAll(async () => h.close());

  it("DELETE on pay_line raises (append-only)", async () => {
    await expect(
      h.query(`delete from pay_line where worker_id='w-big';`),
    ).rejects.toThrow(/append-only|reversing/);
  });

  it("UPDATE of a money column on pay_line raises (immutable; reverse instead)", async () => {
    await expect(
      h.query(`update pay_line set piece_rate_usd = 9999 where worker_id='w-big' and reverses_id is null;`),
    ).rejects.toThrow(/append-only|immutable/);
  });

  it("a status-only UPDATE (calculated→approved) is the ONE allowed transition", async () => {
    const id = (
      await h.query<{ id: number }>(
        `select id from pay_line where worker_id='w-big' and reverses_id is null;`,
      )
    )[0].id;
    await h.query(`select approve_pay_line(${id});`);
    const r = await h.query<{ status: string }>(
      `select status from pay_line where id = ${id};`,
    );
    expect(r[0].status).toBe("approved");
  });

  it("DELETE/UPDATE on disbursement raises (money moved is permanent)", async () => {
    // approve + disburse w-big first.
    const id = (
      await h.query<{ id: number }>(
        `select id from pay_line where worker_id='w-big' and reverses_id is null;`,
      )
    )[0].id;
    await h.query(`select approve_pay_line(${id});`);
    await h.query(
      `select record_disbursement('${PERIOD_ID}','w-big', 89.00, 'yappy', null, null, 'disb-big-1');`,
    );
    await expect(
      h.query(`delete from disbursement where worker_id='w-big';`),
    ).rejects.toThrow(/append-only/);
    await expect(
      h.query(`update disbursement set amount_usd = 0 where worker_id='w-big';`),
    ).rejects.toThrow(/append-only/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Disbursement → cost_entry COGS write + the approval gate.
// ════════════════════════════════════════════════════════════════════════════
describe("P2-S7 — disbursement writes a COGS cost_entry + requires an approved line", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedFarm(h);
    await h.query(
      `select compute_pay_period('${PERIOD_ID}','${PERIOD_START}','${PERIOD_END}','2026-2027','daily');`,
    );
  });
  afterAll(async () => h.close());

  it("refuses to disburse an un-approved (merely calculated) line (fail-closed)", async () => {
    await expect(
      h.query(
        `select record_disbursement('${PERIOD_ID}','w-big', 50, 'ach', 'ref1', null, 'd-early');`,
      ),
    ).rejects.toThrow(/not approved/);
  });

  it("a cash-signed disbursement without a signature is rejected", async () => {
    const id = (
      await h.query<{ id: number }>(
        `select id from pay_line where worker_id='w-big' and reverses_id is null;`,
      )
    )[0].id;
    await h.query(`select approve_pay_line(${id});`);
    await expect(
      h.query(
        `select record_disbursement('${PERIOD_ID}','w-big', 50, 'cash-signed', null, null, 'd-nosig');`,
      ),
    ).rejects.toThrow(/signature/);
  });

  it("a valid disbursement writes a matching cost_entry (payroll IS COGS, no double-keying)", async () => {
    const before = (
      await h.query<{ n: number }>(`select count(*)::int as n from cost_entry;`)
    )[0].n;
    const dId = (
      await h.query<{ id: number }>(
        `select record_disbursement('${PERIOD_ID}','w-big', 89.00, 'yappy', 'yappy-tx-1', null, 'd-ok') as id;`,
      )
    )[0].id;
    const after = (
      await h.query<{ n: number }>(`select count(*)::int as n from cost_entry;`)
    )[0].n;
    expect(after).toBe(before + 1);
    const ce = await h.query<{
      amount: string;
      driver: string;
      rule: string;
      cost_entry_id: number;
    }>(
      `select d.amount_usd as amount, c.driver, c.allocation_rule as rule, d.cost_entry_id
         from disbursement d join cost_entry c on c.id = d.cost_entry_id where d.id = ${dId};`,
    );
    expect(Number(ce[0].amount)).toBeCloseTo(89.0, 2);
    expect(ce[0].driver).toBe("worker-day");
    expect(ce[0].rule).toBe("direct-labor"); // payroll buckets as LABOR, not overhead
    expect(ce[0].cost_entry_id).toBeTruthy();
  });

  it("disbursement is exactly-once on the idempotency key (a retry is one row)", async () => {
    const line = (
      await h.query<{ id: number; net: string }>(
        `select id, net_usd as net from pay_line where worker_id='w-low' and reverses_id is null;`,
      )
    )[0];
    await h.query(`select approve_pay_line(${line.id});`);
    const net = Number(line.net);
    const first = (
      await h.query<{ id: number }>(
        `select record_disbursement('${PERIOD_ID}','w-low', ${net}, 'nequi', 'n-1', null, 'd-low-retry') as id;`,
      )
    )[0].id;
    const second = (
      await h.query<{ id: number }>(
        `select record_disbursement('${PERIOD_ID}','w-low', ${net}, 'nequi', 'n-1', null, 'd-low-retry') as id;`,
      )
    )[0].id;
    expect(second).toBe(first);
    const n = (
      await h.query<{ n: number }>(
        `select count(*)::int as n from disbursement where worker_id='w-low';`,
      )
    )[0].n;
    expect(n).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Idempotency of the calculate run + the period lifecycle.
// ════════════════════════════════════════════════════════════════════════════
describe("P2-S7 — compute_pay_period is idempotent + freezes the snapshot", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedFarm(h);
  });
  afterAll(async () => h.close());

  it("re-running calculate on a frozen period is a no-op (one line per worker)", async () => {
    await h.query(
      `select compute_pay_period('${PERIOD_ID}','${PERIOD_START}','${PERIOD_END}','2026-2027','daily');`,
    );
    await h.query(
      `select compute_pay_period('${PERIOD_ID}','${PERIOD_START}','${PERIOD_END}','2026-2027','daily');`,
    );
    const r = await h.query<{ n: number }>(
      `select count(*)::int as n from pay_line where pay_period_id='${PERIOD_ID}' and worker_id='w-big' and reverses_id is null;`,
    );
    expect(r[0].n).toBe(1);
    const st = await h.query<{ status: string }>(
      `select status from pay_period where id='${PERIOD_ID}';`,
    );
    expect(st[0].status).toBe("calculated");
  });

  it("pay_period status cannot move backward", async () => {
    await expect(
      h.query(`update pay_period set status='open' where id='${PERIOD_ID}';`),
    ).rejects.toThrow(/backward/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// AD-8 grant posture.
// ════════════════════════════════════════════════════════════════════════════
describe("P2-S7 — AD-8 grant posture (authenticated reads; anon reads nothing)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedFarm(h);
    await h.query(
      `select compute_pay_period('${PERIOD_ID}','${PERIOD_START}','${PERIOD_END}','2026-2027','daily');`,
    );
  });
  afterAll(async () => h.close());

  it("authenticated reads pay_line + v_worker_pay + v_payslip", async () => {
    await asAuthenticated(h, async (hh) => {
      const a = await hh.query<{ n: number }>(`select count(*)::int as n from pay_line;`);
      expect(a[0].n).toBeGreaterThan(0);
      const b = await hh.query<{ n: number }>(`select count(*)::int as n from v_worker_pay;`);
      expect(b[0].n).toBeGreaterThan(0);
      const c = await hh.query<{ n: number }>(`select count(*)::int as n from v_payslip;`);
      expect(c[0].n).toBeGreaterThanOrEqual(0);
    });
  });

  it("anon cannot read pay_line (SELECT grant never issued)", async () => {
    await asAnon(h, async (hh) => {
      await expect(hh.query(`select 1 from pay_line;`)).rejects.toThrow(/permission denied/);
    });
  });

  it("compute_pay_period executes for authenticated", async () => {
    await asAuthenticated(h, async (hh) => {
      const r = await hh.query<{ pid: string }>(
        `select compute_pay_period('pp-auth','${PERIOD_START}','${PERIOD_END}','2026-2027','daily') as pid;`,
      );
      expect(r[0].pid).toBe("pp-auth");
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ROOT 1 (D02) — the make-whole floor is PRESENCE-DAY-based, never paired-hours
// only, so it protects the piece-rate picking crew (~90%) who never clock out.
// ════════════════════════════════════════════════════════════════════════════
describe("P2-S7 ROOT1 — presence-day floor protects weigh-only pickers", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedFarm(h);
    await h.query(
      `select compute_pay_period('${PERIOD_ID}','${PERIOD_START}','${PERIOD_END}','2026-2027','daily');`,
    );
  });
  afterAll(async () => h.close());

  it("v_worker_days_present counts distinct presence days from a weigh-only picker", async () => {
    // w-low weighed once (one auto clock-in, no clock-out) → 1 presence day.
    const r = await h.query<{ d: string }>(
      `select v_worker_days_present('w-low','${PERIOD_START}','${PERIOD_END}') as d;`,
    );
    expect(Number(r[0].d)).toBe(1);
  });

  it("a picker with weighs across two days floors at 2 × workday × min-wage", async () => {
    h = h; // (per-describe isolation handled by beforeAll)
    const hh = await freshDb();
    await seedFarm(hh);
    // a second weigh on a different day for w-low (still no clock-out).
    await weigh(hh, "w-low", 1, "wl2", "2026-06-19");
    await hh.query(
      `select compute_pay_period('pp-two','${PERIOD_START}','${PERIOD_END}','2026-2027','daily');`,
    );
    const r = await hh.query<{ floor: string; make_whole: string; gross: string }>(
      `select min_wage_floor_usd as floor, make_whole_usd as make_whole, gross_usd as gross
         from pay_line where pay_period_id='pp-two' and worker_id='w-low' and reverses_id is null;`,
    );
    // 2 days × 8h × $2.00 = $32 floor; piece $4 (2 latas × $2/kg) → make_whole $28.
    expect(Number(r[0].floor)).toBeCloseTo(32.0, 2);
    expect(Number(r[0].make_whole)).toBeCloseTo(28.0, 2);
    expect(Number(r[0].gross)).toBeCloseTo(32.0, 2);
    await hh.close();
  });

  it("a genuinely hourly worker with long paired hours keeps the hours-based floor (greatest wins)", async () => {
    // w-big: 5h paired clock-pair on one day. days_present = 1 (the clock-in day, plus
    // the weigh day). floor = greatest(hours×rate, days×workday×rate).
    const hh = await freshDb();
    await seedFarm(hh);
    // weigh w-big on 2026-06-18 (auto clock-in), then a 10h paired shift same day so
    // hours-based (10×2=20) beats days-based (1×8×2=16) on that single day.
    await hh.query(
      `select record_attendance('w-big','clock-in','p-pay','2026-06-18T08:00:00Z'::timestamptz,'dev-a',${seq()},'big-in');`,
    );
    await hh.query(
      `select record_attendance('w-big','clock-out','p-pay','2026-06-18T18:00:00Z'::timestamptz,'dev-a',${seq()},'big-out');`,
    );
    await hh.query(
      `select compute_pay_period('pp-h','${PERIOD_START}','${PERIOD_END}','2026-2027','daily');`,
    );
    const r = await hh.query<{ floor: string; hours: string }>(
      `select min_wage_floor_usd as floor, hours_worked as hours
         from pay_line where pay_period_id='pp-h' and worker_id='w-big' and reverses_id is null;`,
    );
    expect(Number(r[0].hours)).toBeCloseTo(10.0, 2);
    // greatest(10h × $2, 1 day × 8h × $2) = greatest(20, 16) = 20.
    expect(Number(r[0].floor)).toBeCloseTo(20.0, 2);
    await hh.close();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ROOT 3 (D02) — v_worker_piece_rate honors rate_basis (per-kg vs per-lata; the
// no-kg bases raise rather than silently mis-price).
// ════════════════════════════════════════════════════════════════════════════
describe("P2-S7 ROOT3 — piece-rate is priced by rate_basis", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
  });
  afterAll(async () => h.close());

  it("a per-lata contract pays count(latas) × rate, NOT Σ(kg) × rate", async () => {
    const hh = await freshDb();
    await hh.query(PLOT);
    await hh.query(
      `insert into workers (id, name, role, daily_rate_usd, attendance, started_year, phone, today_kg, crew) values
         ('w-lata','Lata Picker','Picker',24,'present',2020,'+507 5',0,'Crew Tizingal');`,
    );
    await hh.query(`select _backfill_people();`);
    await hh.query(
      `select sign_por_obra_contract('w-lata','picking','per-lata',3.50,'2026-06-01',null,'sig-l','por-l');`,
    );
    await hh.query(`update farm_season_config set min_wage_hourly_usd = 0, standard_workday_hours = 8 where id = 1;`);
    // 3 latas (3 weigh_event rows), each ~12 kg.
    await weigh(hh, "w-lata", 12, "wlata1");
    await weigh(hh, "w-lata", 12, "wlata2");
    await weigh(hh, "w-lata", 12, "wlata3");
    await hh.query(
      `select compute_pay_period('pp-lata','${PERIOD_START}','${PERIOD_END}','2026-2027','daily');`,
    );
    const r = await hh.query<{ piece: string }>(
      `select piece_rate_usd as piece from pay_line where pay_period_id='pp-lata' and worker_id='w-lata' and reverses_id is null;`,
    );
    // 3 latas × $3.50 = $10.50 (NOT 36 kg × $3.50 = $126.00).
    expect(Number(r[0].piece)).toBeCloseTo(10.5, 2);
    await hh.close();
  });

  it("a per-kg contract still pays Σ(kg) × rate (unchanged)", async () => {
    const hh = await freshDb();
    await seedFarm(hh);
    await hh.query(
      `select compute_pay_period('pp-kg','${PERIOD_START}','${PERIOD_END}','2026-2027','daily');`,
    );
    const r = await hh.query<{ piece: string }>(
      `select piece_rate_usd as piece from pay_line where pay_period_id='pp-kg' and worker_id='w-big' and reverses_id is null;`,
    );
    expect(Number(r[0].piece)).toBeCloseTo(100.0, 2); // 50 kg × $2.00
    await hh.close();
  });

  it("a per-tarea contract RAISES at calculate (kg cannot price a no-kg basis)", async () => {
    const hh = await freshDb();
    await hh.query(PLOT);
    await hh.query(
      `insert into workers (id, name, role, daily_rate_usd, attendance, started_year, phone, today_kg, crew) values
         ('w-tarea','Tarea Worker','Picker',24,'present',2020,'+507 6',0,'Crew Tizingal');`,
    );
    await hh.query(`select _backfill_people();`);
    await hh.query(
      `select sign_por_obra_contract('w-tarea','picking','per-tarea',5.00,'2026-06-01',null,'sig-t','por-t');`,
    );
    await weigh(hh, "w-tarea", 12, "wtarea1");
    await expect(
      hh.query(
        `select compute_pay_period('pp-tarea','${PERIOD_START}','${PERIOD_END}','2026-2027','daily');`,
      ),
    ).rejects.toThrow(/rate_basis|per-tarea|per-tree|count/i);
    await hh.close();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ROOT 2 (D02) — record_disbursement: exactly-once UNIQUE backing, p_ref
// persisted, amount reconciled to net, one disbursement per worker+period.
// ════════════════════════════════════════════════════════════════════════════
describe("P2-S7 ROOT2 — disbursement exactly-once, ref, amount reconciliation", () => {
  let h: Harness;
  async function approveAll(hh: Harness): Promise<void> {
    const ids = await hh.query<{ id: number }>(
      `select id from pay_line where reverses_id is null;`,
    );
    for (const { id } of ids) await hh.query(`select approve_pay_line(${id});`);
  }
  beforeAll(async () => {
    h = await freshDb();
    await seedFarm(h);
    await h.query(
      `select compute_pay_period('${PERIOD_ID}','${PERIOD_START}','${PERIOD_END}','2026-2027','daily');`,
    );
    await approveAll(h);
  });
  afterAll(async () => h.close());

  it("persists p_ref (the transfer receipt) in the ref column, NOT the idempotency key", async () => {
    const net = Number(
      (
        await h.query<{ net: string }>(
          `select net_usd as net from pay_line where worker_id='w-low' and reverses_id is null;`,
        )
      )[0].net,
    );
    await h.query(
      `select record_disbursement('${PERIOD_ID}','w-low', ${net}, 'yappy', 'YAPPY-TX-REAL-12345', null, 'idem-low-1');`,
    );
    const r = await h.query<{ ref: string; key: string }>(
      `select ref, idempotency_key as key from disbursement where worker_id='w-low' and reverses_id is null;`,
    );
    expect(r[0].ref).toBe("YAPPY-TX-REAL-12345");
    expect(r[0].key).toBe("idem-low-1");
  });

  it("a unique index backs exactly-once: a second original insert with the same key is rejected at the DB", async () => {
    // the partial unique index on (worker_id, pay_period_id, idempotency_key) is the
    // real authority — prove it exists and rejects a duplicate direct insert.
    await expect(
      h.query(
        `insert into disbursement (pay_period_id, worker_id, amount_usd, method, ref, idempotency_key)
           values ('${PERIOD_ID}','w-low', 1, 'yappy', 'x', 'idem-low-1');`,
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it("an amount below the line's net is REJECTED (the $0.01-closes-the-period bug)", async () => {
    const net = Number(
      (
        await h.query<{ net: string }>(
          `select net_usd as net from pay_line where worker_id='w-big' and reverses_id is null;`,
        )
      )[0].net,
    );
    expect(net).toBeGreaterThan(1);
    await expect(
      h.query(
        `select record_disbursement('${PERIOD_ID}','w-big', 0.01, 'yappy', 'r', null, 'idem-big-low');`,
      ),
    ).rejects.toThrow(/net|below|exceed/i);
  });

  it("an amount above the line's net is REJECTED (overpay guard)", async () => {
    await expect(
      h.query(
        `select record_disbursement('${PERIOD_ID}','w-big', 1000000, 'yappy', 'r', null, 'idem-big-high');`,
      ),
    ).rejects.toThrow(/net|exceed|above/i);
  });

  it("a full-net disbursement is accepted and a same-key retry returns the same row (one row, one cost_entry)", async () => {
    const net = Number(
      (
        await h.query<{ net: string }>(
          `select net_usd as net from pay_line where worker_id='w-big' and reverses_id is null;`,
        )
      )[0].net,
    );
    const ceBefore = (
      await h.query<{ n: number }>(`select count(*)::int as n from cost_entry;`)
    )[0].n;
    const first = (
      await h.query<{ id: number }>(
        `select record_disbursement('${PERIOD_ID}','w-big', ${net}, 'yappy', 'tx-big', null, 'idem-big-ok') as id;`,
      )
    )[0].id;
    const second = (
      await h.query<{ id: number }>(
        `select record_disbursement('${PERIOD_ID}','w-big', ${net}, 'yappy', 'tx-big', null, 'idem-big-ok') as id;`,
      )
    )[0].id;
    expect(second).toBe(first);
    const rows = (
      await h.query<{ n: number }>(
        `select count(*)::int as n from disbursement where worker_id='w-big' and reverses_id is null;`,
      )
    )[0].n;
    expect(rows).toBe(1);
    const ceAfter = (
      await h.query<{ n: number }>(`select count(*)::int as n from cost_entry;`)
    )[0].n;
    // exactly ONE cost_entry written across the two calls (the retry is a no-op).
    expect(ceAfter).toBe(ceBefore + 1);
  });

  it("a SECOND disbursement for the same worker+period with a DIFFERENT key is rejected (one-per-worker)", async () => {
    await expect(
      h.query(
        `select record_disbursement('${PERIOD_ID}','w-big', 1, 'yappy', 'r2', null, 'idem-big-dup');`,
      ),
    ).rejects.toThrow(/already|one|exceed|net/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ROOT 4 (D02) — the period reaches 'approved' then 'paid', and reversals are a
// reachable append-only correction door for both ledgers.
// ════════════════════════════════════════════════════════════════════════════
describe("P2-S7 ROOT4 — period lifecycle + reversal RPCs", () => {
  let h: Harness;
  async function approveAll(hh: Harness): Promise<void> {
    const ids = await hh.query<{ id: number }>(
      `select id from pay_line where reverses_id is null;`,
    );
    for (const { id } of ids) await hh.query(`select approve_pay_line(${id});`);
  }
  beforeAll(async () => {
    h = await freshDb();
    await seedFarm(h);
    await h.query(
      `select compute_pay_period('${PERIOD_ID}','${PERIOD_START}','${PERIOD_END}','2026-2027','daily');`,
    );
  });
  afterAll(async () => h.close());

  it("approving every line advances the PERIOD to 'approved'", async () => {
    await approveAll(h);
    const st = await h.query<{ status: string }>(
      `select status from pay_period where id='${PERIOD_ID}';`,
    );
    expect(st[0].status).toBe("approved");
  });

  it("disbursing every owed worker their full net flips the period to 'paid'", async () => {
    const lines = await h.query<{ worker_id: string; net: string }>(
      `select worker_id, net_usd as net from pay_line where pay_period_id='${PERIOD_ID}' and reverses_id is null and net_usd > 0;`,
    );
    let i = 0;
    for (const l of lines) {
      await h.query(
        `select record_disbursement('${PERIOD_ID}','${l.worker_id}', ${Number(l.net)}, 'yappy', 'tx-${i}', null, 'paykey-${i}');`,
      );
      i++;
    }
    const st = await h.query<{ status: string }>(
      `select status from pay_period where id='${PERIOD_ID}';`,
    );
    expect(st[0].status).toBe("paid");
  });

  it("reverse_pay_line appends a negative reversing row and flips the original to 'reversed'", async () => {
    const hh = await freshDb();
    await seedFarm(hh);
    await hh.query(
      `select compute_pay_period('pp-rev','${PERIOD_START}','${PERIOD_END}','2026-2027','daily');`,
    );
    const orig = (
      await hh.query<{ id: number; net: string }>(
        `select id, net_usd as net from pay_line where pay_period_id='pp-rev' and worker_id='w-big' and reverses_id is null;`,
      )
    )[0];
    const revId = (
      await hh.query<{ id: number }>(
        `select reverse_pay_line(${orig.id}, 'mis-keyed weigh', 'rev-1') as id;`,
      )
    )[0].id;
    expect(revId).toBeTruthy();
    const rev = (
      await hh.query<{ reverses_id: number; net: string }>(
        `select reverses_id, net_usd as net from pay_line where id=${revId};`,
      )
    )[0];
    expect(rev.reverses_id).toBe(orig.id);
    // the reversing row nets the original out: net of all w-big rows = 0.
    const tot = (
      await hh.query<{ tot: string }>(
        `select coalesce(sum(net_usd),0) as tot from pay_line where pay_period_id='pp-rev' and worker_id='w-big';`,
      )
    )[0];
    expect(Number(tot.tot)).toBeCloseTo(0, 2);
    const st = (
      await hh.query<{ status: string }>(
        `select status from pay_line where id=${orig.id};`,
      )
    )[0];
    expect(st.status).toBe("reversed");
    // idempotent: a second reverse returns the same reversing id.
    const again = (
      await hh.query<{ id: number }>(
        `select reverse_pay_line(${orig.id}, 'again', 'rev-1') as id;`,
      )
    )[0].id;
    expect(again).toBe(revId);
    await hh.close();
  });

  it("a reversed original does NOT collide with the one-live-original unique index (slot freed for a future re-insert)", async () => {
    // the partial unique index is keyed on live (status <> 'reversed') originals, so a
    // reversed original frees the (period, worker) slot. Re-inserting a fresh live original
    // for the same worker+period succeeds (the index no longer counts the reversed row).
    const hh = await freshDb();
    await seedFarm(hh);
    await hh.query(
      `select compute_pay_period('pp-slot','${PERIOD_START}','${PERIOD_END}','2026-2027','daily');`,
    );
    const orig = (
      await hh.query<{ id: number }>(
        `select id from pay_line where pay_period_id='pp-slot' and worker_id='w-big' and reverses_id is null;`,
      )
    )[0].id;
    await hh.query(`select reverse_pay_line(${orig}, 'fix', 'slot-1');`);
    // a fresh live original for the same worker+period no longer collides with the index.
    await hh.query(
      `insert into pay_line (pay_period_id, worker_id, hours_worked, worked_days, piece_rate_usd, hourly_usd, status)
         values ('pp-slot','w-big', 0, 1, 0, 0, 'calculated');`,
    );
    const live = (
      await hh.query<{ n: number }>(
        `select count(*)::int as n from pay_line
           where pay_period_id='pp-slot' and worker_id='w-big' and reverses_id is null and status <> 'reversed';`,
      )
    )[0].n;
    expect(live).toBe(1);
    await hh.close();
  });

  it("reverse_disbursement appends a negative disbursement + negative COGS, netting both to zero", async () => {
    const hh = await freshDb();
    await seedFarm(hh);
    await hh.query(
      `select compute_pay_period('pp-revd','${PERIOD_START}','${PERIOD_END}','2026-2027','daily');`,
    );
    const orig = (
      await hh.query<{ id: number; net: string }>(
        `select id, net_usd as net from pay_line where pay_period_id='pp-revd' and worker_id='w-big' and reverses_id is null;`,
      )
    )[0];
    await hh.query(`select approve_pay_line(${orig.id});`);
    const dId = (
      await hh.query<{ id: number }>(
        `select record_disbursement('pp-revd','w-big', ${Number(orig.net)}, 'yappy', 'tx-d', null, 'd-revd') as id;`,
      )
    )[0].id;
    const revDid = (
      await hh.query<{ id: number }>(
        `select reverse_disbursement(${dId}, 'rev-d-1') as id;`,
      )
    )[0].id;
    expect(revDid).toBeTruthy();
    const dTot = (
      await hh.query<{ tot: string }>(
        `select coalesce(sum(amount_usd),0) as tot from disbursement where worker_id='w-big';`,
      )
    )[0];
    expect(Number(dTot.tot)).toBeCloseTo(0, 2);
    const cTot = (
      await hh.query<{ tot: string }>(
        `select coalesce(sum(amount_usd),0) as tot from cost_entry where allocation_rule='direct-labor';`,
      )
    )[0];
    expect(Number(cTot.tot)).toBeCloseTo(0, 2);
    await hh.close();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// HIGH/MED sweeps (D02) — backdated statutory fail-closed; overlapping clock-in
// double-count stitch; misnamed days helper.
// ════════════════════════════════════════════════════════════════════════════
describe("P2-S7 sweeps — statutory fail-closed + hours interval-stitching", () => {
  it("a backdated period with no statutory row RAISES (no silent $0 withholding)", async () => {
    const hh = await freshDb();
    await seedFarm(hh);
    // the only seeded statutory row is effective 2026-01-01; a 2025 period has none.
    await expect(
      hh.query(
        `select compute_pay_period('pp-2025','2025-12-15','2025-12-31','2025-2026','daily');`,
      ),
    ).rejects.toThrow(/statutory|effective|rates/i);
    await hh.close();
  });

  it("v_worker_hours does not double-count overlapping clock-ins (one clock-out closes one interval)", async () => {
    const hh = await freshDb();
    await seedFarm(hh);
    // clock-in 08:00, a forgotten second clock-in 13:00, then one clock-out 17:00.
    await hh.query(
      `select record_attendance('w-big','clock-in','p-pay','2026-06-19T08:00:00Z'::timestamptz,'dev-a',${seq()},'ci-1');`,
    );
    await hh.query(
      `select record_attendance('w-big','clock-in','p-pay','2026-06-19T13:00:00Z'::timestamptz,'dev-a',${seq()},'ci-2');`,
    );
    await hh.query(
      `select record_attendance('w-big','clock-out','p-pay','2026-06-19T17:00:00Z'::timestamptz,'dev-a',${seq()},'co-1');`,
    );
    const r = await hh.query<{ hrs: string }>(
      `select v_worker_hours('w-big','${PERIOD_START}','${PERIOD_END}') as hrs;`,
    );
    // physically at most 9h (08:00→17:00), NOT 13h (9h + 4h double-count).
    expect(Number(r[0].hrs)).toBeCloseTo(9.0, 2);
    await hh.close();
  });
});
