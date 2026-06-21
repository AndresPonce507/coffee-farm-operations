// P2-S7 — payroll seed smoke: the whole seed.sql must load cleanly on top of every
// migration AND produce the intended dogfood snapshot — a CALCULATED pay period whose
// roster includes a worker the legal-minimum make-whole guard visibly lifted.
//
// This doubles as a guard that the payroll seed block (attendance via record_attendance,
// the statutory rate row, compute_pay_period) replays end-to-end — a broken seed insert,
// FK, or RPC call here fails loudly instead of silently shipping a dead /payroll demo.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDb, type Harness } from "./pgliteHarness";

const SEED = readFileSync(join(process.cwd(), "supabase/seed.sql"), "utf8");

describe("P2-S7 — payroll seed dogfood (seed.sql replays end-to-end)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(SEED); // the whole seed, on top of every migration
  });
  afterAll(async () => h.close());

  it("seeds a CALCULATED pay period the cockpit can read", async () => {
    const r = await h.query<{ status: string; n: number }>(
      `select status, (select count(*)::int from pay_line where pay_period_id = pp.id and reverses_id is null) as n
         from pay_period pp where id = 'pp-2026-06-w3';`,
    );
    expect(r[0].status).toBe("calculated");
    expect(r[0].n).toBeGreaterThan(0); // a line per worker
  });

  it("the dogfood includes a worker the make-whole guard lifted (Lucía, w-06)", async () => {
    const r = await h.query<{ made_whole: string; gross: string; floor: string; net: string }>(
      `select make_whole_usd as made_whole, gross_usd as gross,
              min_wage_floor_usd as floor, net_usd as net
         from pay_line where pay_period_id = 'pp-2026-06-w3' and worker_id = 'w-06' and reverses_id is null;`,
    );
    // w-06: 1h clocked × (22 daily / 8h) = 2.75 hourly; floor = 1h × 3.00 = 3.00.
    // make-whole lifts gross from 2.75 to 3.00.
    expect(Number(r[0].floor)).toBeCloseTo(3.0, 2);
    expect(Number(r[0].made_whole)).toBeGreaterThan(0);
    expect(Number(r[0].gross)).toBeCloseTo(3.0, 2);
  });

  it("the period summary view surfaces the made-whole count for the dogfood banner", async () => {
    const r = await h.query<{ made_whole_count: number; total_make_whole_usd: string }>(
      `select made_whole_count, total_make_whole_usd from v_pay_period_summary where id = 'pp-2026-06-w3';`,
    );
    expect(Number(r[0].made_whole_count)).toBeGreaterThanOrEqual(1);
    expect(Number(r[0].total_make_whole_usd)).toBeGreaterThan(0);
  });

  it("v_payslip resolves the bilingual payload for a worker in the period", async () => {
    const r = await h.query<{ worker_name: string; languages: string[]; net: string }>(
      `select worker_name, languages, net_usd as net
         from v_payslip where pay_period_id = 'pp-2026-06-w3' and worker_id = 'w-06';`,
    );
    expect(r[0].worker_name).toBeTruthy();
    expect(r[0].languages).toContain("ngäbere"); // Lucía's seeded languages
  });
});
