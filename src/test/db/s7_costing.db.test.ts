// S7 — Activity-based COGS: the number the business turns on (true cost-per-kg-green).
//
// These tests replay the REAL migrations in PGlite (AD-9) and prove the costing
// slice's invariants against a HAND-COMPUTED seed — written RED first per the spec:
//
//   - cost_entry is APPEND-ONLY: corrections are reversing (negative-amount) rows,
//     never UPDATE/DELETE. A reversal nets the original contribution to zero.
//   - mv_lot_cost / cogs_per_lot() apportion each cost over green-kg across ALL
//     FOUR documented allocation rules (D-COST-1):
//       1. direct-labor → lot           (whole amount to that lot, walked to green)
//       2. processing   → lot           (whole amount to that lot, walked to green)
//       3. agronomy     → plot          (split to lots by that plot's harvested-kg share)
//       4. overhead     → farm          (split across ALL green lots pro-rata by green-kg)
//   - green-kg denominator = the lot node's green mass, DEGRADING to
//     processing_batches.current_kg WHERE stage='green' when the node has none.
//   - NULL (not divide-by-zero) when green-kg is zero/undeclared.
//   - the matview reflects new cost_entry rows after a refresh on the write path.
//   - AD-8 grant posture: cost_entry + mv_lot_cost SELECT-granted to authenticated;
//     cogs_per_lot/cogs_per_plot are authenticated-only; anon reads/executes nothing.
//
// All money math is hand-computed in the comments next to each assertion so a human
// can verify the SQL against arithmetic, not against itself.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, freshDb, type Harness } from "./pgliteHarness";

// ──────────────────────────────────────────────────────────────────────────
// A self-contained costing fixture. Two single-origin green lots fed by two
// distinct source lots, plus the harvests that tie a PLOT to its lots (so the
// agronomy→plot→lot share rule has data), all hand-chosen for round numbers.
//
//   plot p-A → harvests:  60 kg cherries to lot JC-900, 40 kg to lot JC-910
//   JC-900 (milled, 50 kg) --process 30kg--> JC-901 (green, 30 kg)
//   JC-910 (milled, 80 kg) --process 60kg--> JC-911 (green, 60 kg)
//
// Green-kg totals: JC-901 = 30, JC-911 = 60  (sum 90).
// ──────────────────────────────────────────────────────────────────────────
const FIXTURE = `
  -- a plot the agronomy rule allocates against (only the columns the rule needs)
  insert into plots (id, ord, name, block, variety, area_ha, altitude_masl, trees,
                     shade_pct, established_year, status, last_inspected,
                     expected_yield_kg, harvested_kg)
    values ('p-A', 90, 'Costing Plot A', 'Block Z', 'Geisha', 1, 1500, 100, 50,
            2015, 'healthy', '2026-06-01', 1000, 100);

  -- a picker for the harvest rows (worker FK)
  insert into workers (id, name, role, daily_rate_usd, attendance, started_year, phone, crew)
    values ('w-c1', 'Costing Picker', 'Picker', 22, 'present', 2015, '+507 0000-0000', 'Crew Z');

  -- source (milled) lots with declared mass
  insert into lots (code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
    values ('JC-900', 'milled', 'Geisha', 50, 50, true, now()),
           ('JC-910', 'milled', 'Geisha', 80, 80, true, now());

  -- harvests tie plot p-A to lots JC-900 (60 kg cherries) and JC-910 (40 kg).
  -- The agronomy→plot rule splits a plot cost across its lots by this cherries_kg
  -- share: JC-900 gets 60/100 = 0.6, JC-910 gets 40/100 = 0.4.
  insert into harvests (id, date, plot_id, worker_id, cherries_kg, ripeness_pct, brix_avg, lot_code)
    values ('h-c1', '2026-06-01', 'p-A', 'w-c1', 60, 95, 22, 'JC-900'),
           ('h-c2', '2026-06-01', 'p-A', 'w-c1', 40, 95, 22, 'JC-910');
`;

/** Materialize the two green lots from their sources via the only-writer RPC. */
async function materializeGreens(h: Harness) {
  await h.query(
    `select materialize_green_lot('JC-900','JC-901',30,85,'WH-A', now()) as code;`,
  );
  await h.query(
    `select materialize_green_lot('JC-910','JC-911',60,85,'WH-A', now()) as code;`,
  );
}

/** Read cost-per-kg-green for a green lot via the RPC (rounded for stable compare). */
async function cogs(h: Harness, lot: string): Promise<number | null> {
  const r = await h.query<{ v: number | null }>(
    `select cogs_per_lot('${lot}') as v;`,
  );
  return r[0].v === null ? null : Number(r[0].v);
}

/** Read total allocated cost for a green lot straight off the matview. */
async function totalCost(h: Harness, lot: string): Promise<number | null> {
  const r = await h.query<{ total_cost: number | null }>(
    `select total_cost from mv_lot_cost where green_lot_code = '${lot}';`,
  );
  return r.length === 0 || r[0].total_cost === null ? null : Number(r[0].total_cost);
}

const REFRESH = `select refresh_lot_cost();`;

// ──────────────────────────────────────────────────────────────────────────
// 1. The four allocation rules, hand-computed.
// ──────────────────────────────────────────────────────────────────────────
describe("S7 COGS — four allocation rules (hand-computed seed)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(FIXTURE);
    await materializeGreens(h);
  });
  afterAll(async () => h.close());

  it("rule 1 — direct-labor → lot lands wholly on that lot, over its green-kg", async () => {
    // $300 direct labor booked to JC-901 (a green lot). green-kg = 30.
    // cost-per-kg-green = 300 / 30 = 10.00
    await h.query(
      `insert into cost_entry (driver, allocation_rule, target_kind, target_code, amount_usd)
       values ('worker-day','direct-labor','lot','JC-901',300);`,
    );
    await h.query(REFRESH);
    expect(await totalCost(h, "JC-901")).toBeCloseTo(300, 6);
    expect(await cogs(h, "JC-901")).toBeCloseTo(10, 6); // 300 / 30
    // untouched lot stays zero
    expect(await totalCost(h, "JC-911")).toBeCloseTo(0, 6);
  });

  it("rule 2 — processing → lot adds to that lot's cost over its green-kg", async () => {
    // $150 processing booked to JC-901. running total 300 + 150 = 450.
    // cost-per-kg-green = 450 / 30 = 15.00
    await h.query(
      `insert into cost_entry (driver, allocation_rule, target_kind, target_code, amount_usd)
       values ('processing-batch','processing','lot','JC-901',150);`,
    );
    await h.query(REFRESH);
    expect(await totalCost(h, "JC-901")).toBeCloseTo(450, 6);
    expect(await cogs(h, "JC-901")).toBeCloseTo(15, 6); // 450 / 30
  });

  it("rule 3 — agronomy → plot splits to lots by harvested-kg share", async () => {
    // $1000 agronomy booked to plot p-A. p-A's cherries split: JC-900 60%, JC-910 40%.
    // JC-900's share = 600, flows down its process edge to green JC-901 (only child).
    // JC-910's share = 400, flows down to green JC-911.
    //   JC-901 total = 450 + 600 = 1050 ; per-kg = 1050 / 30 = 35.00
    //   JC-911 total = 0   + 400 = 400  ; per-kg = 400  / 60 = 6.666...
    await h.query(
      `insert into cost_entry (driver, allocation_rule, target_kind, target_code, amount_usd)
       values ('task','agronomy','plot','p-A',1000);`,
    );
    await h.query(REFRESH);
    expect(await totalCost(h, "JC-901")).toBeCloseTo(1050, 6);
    expect(await totalCost(h, "JC-911")).toBeCloseTo(400, 6);
    expect(await cogs(h, "JC-901")).toBeCloseTo(35, 6); // 1050 / 30
    expect(await cogs(h, "JC-911")).toBeCloseTo(400 / 60, 6); // 6.6667
  });

  it("rule 4 — overhead → farm splits across all green lots pro-rata by green-kg", async () => {
    // $900 overhead booked to the farm. Green-kg total = 30 + 60 = 90.
    //   JC-901 share = 900 * 30/90 = 300  -> total 1050 + 300 = 1350 ; /30 = 45.00
    //   JC-911 share = 900 * 60/90 = 600  -> total 400  + 600 = 1000 ; /60 = 16.666...
    await h.query(
      `insert into cost_entry (driver, allocation_rule, target_kind, target_code, amount_usd)
       values ('worker-day','overhead','farm',null,900);`,
    );
    await h.query(REFRESH);
    expect(await totalCost(h, "JC-901")).toBeCloseTo(1350, 6);
    expect(await totalCost(h, "JC-911")).toBeCloseTo(1000, 6);
    expect(await cogs(h, "JC-901")).toBeCloseTo(45, 6); // 1350 / 30
    expect(await cogs(h, "JC-911")).toBeCloseTo(1000 / 60, 6); // 16.6667
  });

  it("cogs_per_plot aggregates the plot's green lots' cost over their green-kg", async () => {
    // Both green lots descend (via their source lots' harvests) from plot p-A.
    // cogs_per_plot('p-A') = (Σ total cost of its green lots) / (Σ their green-kg)
    //   = (1350 + 1000) / (30 + 60) = 2350 / 90 = 26.111...
    const r = await h.query<{ v: number | null }>(`select cogs_per_plot('p-A') as v;`);
    expect(Number(r[0].v)).toBeCloseTo(2350 / 90, 6);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2. Reversing entries net to zero (append-only correction path).
// ──────────────────────────────────────────────────────────────────────────
describe("S7 COGS — reversing entries (append-only corrections)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(FIXTURE);
    await materializeGreens(h);
  });
  afterAll(async () => h.close());

  it("an entry plus its reversal contributes zero (no UPDATE/DELETE needed)", async () => {
    // book $500 to JC-901, then reverse it with a -$500 row. Net contribution 0.
    await h.query(
      `insert into cost_entry (driver, allocation_rule, target_kind, target_code, amount_usd)
       values ('processing-batch','processing','lot','JC-901',500);`,
    );
    await h.query(REFRESH);
    expect(await cogs(h, "JC-901")).toBeCloseTo(500 / 30, 6); // booked

    await h.query(
      `insert into cost_entry (driver, allocation_rule, target_kind, target_code, amount_usd, reverses_id)
       values ('processing-batch','processing','lot','JC-901',-500,
               (select id from cost_entry where target_code='JC-901' and amount_usd=500 limit 1));`,
    );
    await h.query(REFRESH);
    // net 0 -> cost-per-kg-green is 0 (lot exists, green-kg known), not NULL.
    expect(await totalCost(h, "JC-901")).toBeCloseTo(0, 6);
    expect(await cogs(h, "JC-901")).toBeCloseTo(0, 6);
    // both rows are still on the ledger — nothing was deleted.
    const cnt = await h.query<{ n: number }>(
      `select count(*)::int as n from cost_entry where target_code='JC-901';`,
    );
    expect(cnt[0].n).toBe(2);
  });

  it("rejects an UPDATE to a cost_entry row (ledger is immutable)", async () => {
    await expect(
      h.query(`update cost_entry set amount_usd = 1 where target_code='JC-901';`),
    ).rejects.toThrow();
  });

  it("rejects a DELETE from cost_entry (ledger is immutable)", async () => {
    await expect(
      h.query(`delete from cost_entry where target_code='JC-901';`),
    ).rejects.toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. NULL-on-zero-yield (no divide-by-zero) + green-kg degradation.
// ──────────────────────────────────────────────────────────────────────────
describe("S7 COGS — NULL on zero green-kg (no divide-by-zero)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    // a green lot node with ZERO declared mass and no processing_batch to degrade to.
    await h.query(
      `insert into lots (code, stage, variety, origin_kg, current_kg, minted_at)
       values ('JC-920','green','Geisha',0,0, now());`,
    );
  });
  afterAll(async () => h.close());

  it("returns NULL (not an error) when green-kg is zero", async () => {
    await h.query(
      `insert into cost_entry (driver, allocation_rule, target_kind, target_code, amount_usd)
       values ('worker-day','direct-labor','lot','JC-920',100);`,
    );
    await h.query(REFRESH);
    expect(await cogs(h, "JC-920")).toBeNull(); // 100 / 0 -> NULL, never a raise
  });

  it("degrades to processing_batches.current_kg WHERE stage='green' when the node has no mass", async () => {
    // green lot node exists but its mass is undeclared; a finished batch carries the
    // real green mass. The denominator must fall back to the batch's current_kg.
    await h.query(
      `insert into lots (code, stage, variety, minted_at)
       values ('JC-930','green','Geisha', now());`,
    );
    await h.query(
      `insert into processing_batches (id, lot_code, variety, method, stage, started_date,
                                       cherries_kg, current_kg, moisture_pct, patio, progress_pct)
       values ('b-930','JC-930','Geisha','Washed','green','2026-05-20', 400, 40, 10.8, 'Bed 1', 100);`,
    );
    await h.query(
      `insert into cost_entry (driver, allocation_rule, target_kind, target_code, amount_usd)
       values ('processing-batch','processing','lot','JC-930',200);`,
    );
    await h.query(REFRESH);
    // denominator degrades to 40 kg -> 200 / 40 = 5.00
    expect(await cogs(h, "JC-930")).toBeCloseTo(5, 6);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 4. Matview reflects new ledger rows after a write-path refresh.
// ──────────────────────────────────────────────────────────────────────────
describe("S7 COGS — matview refresh on the write path", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(FIXTURE);
    await materializeGreens(h);
  });
  afterAll(async () => h.close());

  it("a new cost_entry only shows up in the matview after refresh", async () => {
    await h.query(REFRESH); // baseline: no costs yet
    expect(await totalCost(h, "JC-901")).toBeCloseTo(0, 6);

    await h.query(
      `insert into cost_entry (driver, allocation_rule, target_kind, target_code, amount_usd)
       values ('worker-day','direct-labor','lot','JC-901',60);`,
    );
    // before refresh the matview is stale (still 0)
    expect(await totalCost(h, "JC-901")).toBeCloseTo(0, 6);

    await h.query(REFRESH); // the write path busts + refreshes
    expect(await totalCost(h, "JC-901")).toBeCloseTo(60, 6); // 60 booked
    expect(await cogs(h, "JC-901")).toBeCloseTo(2, 6); // 60 / 30
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 5. AD-8 grant posture + authenticated-only execute.
// ──────────────────────────────────────────────────────────────────────────
describe("S7 COGS — AD-8 grant posture", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(FIXTURE);
    await materializeGreens(h);
    await h.query(REFRESH);
  });
  afterAll(async () => h.close());

  it("authenticated can SELECT cost_entry and the secure COGS read surface (raw matview is owner-only)", async () => {
    const a = await h.query<{ has: boolean }>(
      `select has_table_privilege('authenticated','cost_entry','select') as has;`,
    );
    // P4-S0 (§6.1): the RAW matview SELECT grant is REVOKED from authenticated — a
    // matview carries no RLS, so a surviving raw grant is a cross-tenant COGS read.
    // The authenticated read surface is the tenant-filtered mv_lot_cost_secure view.
    const rawMv = await h.query<{ has: boolean }>(
      `select has_table_privilege('authenticated','mv_lot_cost','select') as has;`,
    );
    const secureMv = await h.query<{ has: boolean }>(
      `select has_table_privilege('authenticated','mv_lot_cost_secure','select') as has;`,
    );
    expect(a[0].has).toBe(true);
    expect(rawMv[0].has).toBe(false);
    expect(secureMv[0].has).toBe(true);
  });

  it("no role holds a write grant on cost_entry beyond the legal INSERT path", async () => {
    // append-only: INSERT allowed to authenticated; UPDATE/DELETE granted to NOBODY.
    const upd = await h.query<{ a: boolean; an: boolean }>(
      `select has_table_privilege('authenticated','cost_entry','update') as a,
              has_table_privilege('anon','cost_entry','update') as an;`,
    );
    const del = await h.query<{ a: boolean; an: boolean }>(
      `select has_table_privilege('authenticated','cost_entry','delete') as a,
              has_table_privilege('anon','cost_entry','delete') as an;`,
    );
    expect(upd[0].a).toBe(false);
    expect(upd[0].an).toBe(false);
    expect(del[0].a).toBe(false);
    expect(del[0].an).toBe(false);
  });

  it("anon holds no SELECT grant on cost_entry or mv_lot_cost", async () => {
    const a = await h.query<{ has: boolean }>(
      `select has_table_privilege('anon','cost_entry','select') as has;`,
    );
    const b = await h.query<{ has: boolean }>(
      `select has_table_privilege('anon','mv_lot_cost','select') as has;`,
    );
    expect(a[0].has).toBe(false);
    expect(b[0].has).toBe(false);
  });

  it("cogs_per_lot / cogs_per_plot are executable by authenticated, not anon", async () => {
    const auth = await h.query<{ l: boolean; p: boolean }>(
      `select has_function_privilege('authenticated','cogs_per_lot(text)','execute') as l,
              has_function_privilege('authenticated','cogs_per_plot(text)','execute') as p;`,
    );
    const an = await h.query<{ l: boolean; p: boolean }>(
      `select has_function_privilege('anon','cogs_per_lot(text)','execute') as l,
              has_function_privilege('anon','cogs_per_plot(text)','execute') as p;`,
    );
    expect(auth[0].l).toBe(true);
    expect(auth[0].p).toBe(true);
    expect(an[0].l).toBe(false);
    expect(an[0].p).toBe(false);
  });

  it("anon cannot read cost_entry rows through the live role posture", async () => {
    await expect(
      asAnon(h, (hh) => hh.query(`select * from cost_entry limit 1;`)),
    ).rejects.toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 6. Per-rule breakdown RECONCILES to the headline (the D-COST review CRIT).
//    cogs_breakdown_per_lot must return the SAME allocation the headline divides:
//    Σ(allocated_cost over the 4 rules) / green_kg === cogs_per_lot. Before the
//    fix, the card read a lot-literal cost_entry ledger that omitted overhead,
//    agronomy, and walked source costs, so the build-up silently understated and
//    contradicted its own total. Hand-computed against the same four-rules seed.
// ──────────────────────────────────────────────────────────────────────────
describe("S7 COGS — per-rule breakdown reconciles to the headline", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(FIXTURE);
    await materializeGreens(h);
    // The same four bookings as the four-rules suite (all rules exercised).
    await h.query(
      `insert into cost_entry (driver, allocation_rule, target_kind, target_code, amount_usd) values
         ('worker-day',      'direct-labor','lot', 'JC-901', 300),
         ('processing-batch','processing',  'lot', 'JC-901', 150),
         ('task',            'agronomy',    'plot','p-A',   1000),
         ('worker-day',      'overhead',    'farm', null,    900);`,
    );
    await h.query(REFRESH);
  });
  afterAll(async () => h.close());

  /** The per-rule breakdown for a green lot as {rule: usd}. */
  async function breakdown(lot: string): Promise<Record<string, number>> {
    const rows = await h.query<{ allocation_rule: string; allocated_cost: number }>(
      `select allocation_rule, allocated_cost from cogs_breakdown_per_lot('${lot}');`,
    );
    return Object.fromEntries(rows.map((r) => [r.allocation_rule, Number(r.allocated_cost)]));
  }

  it("JC-901 breakdown carries ALL four rules (overhead + agronomy NOT $0)", async () => {
    const b = await breakdown("JC-901");
    // direct 300, processing 150, agronomy 600 (60% of 1000 walked down), overhead 300 (900*30/90)
    expect(b["direct-labor"]).toBeCloseTo(300, 6);
    expect(b["processing"]).toBeCloseTo(150, 6);
    expect(b["agronomy"]).toBeCloseTo(600, 6);
    expect(b["overhead"]).toBeCloseTo(300, 6);
  });

  it("Σ(breakdown) / green_kg === cogs_per_lot for JC-901 (build-up reconciles to headline)", async () => {
    const b = await breakdown("JC-901");
    const sum = Object.values(b).reduce((a, v) => a + v, 0); // 1350
    const headline = await cogs(h, "JC-901"); // 1350 / 30 = 45
    expect(sum / 30).toBeCloseTo(headline as number, 6);
    expect(sum).toBeCloseTo(1350, 6);
  });

  it("Σ(breakdown) / green_kg === cogs_per_lot for JC-911 (overhead+agronomy only)", async () => {
    const b = await breakdown("JC-911");
    // agronomy 400 (40% of 1000), overhead 600 (900*60/90); no direct/processing here.
    expect(b["agronomy"]).toBeCloseTo(400, 6);
    expect(b["overhead"]).toBeCloseTo(600, 6);
    const sum = Object.values(b).reduce((a, v) => a + v, 0); // 1000
    const headline = await cogs(h, "JC-911"); // 1000 / 60 = 16.6667
    expect(sum / 60).toBeCloseTo(headline as number, 6);
  });

  it("the breakdown total equals mv_lot_cost.total_cost (per-rule view is additive, not a 2nd SSOT)", async () => {
    const b = await breakdown("JC-901");
    const sum = Object.values(b).reduce((a, v) => a + v, 0);
    expect(sum).toBeCloseTo((await totalCost(h, "JC-901")) as number, 6);
  });

  it("AD-8: mv_lot_cost_by_rule_secure SELECT + cogs_breakdown_per_lot EXECUTE are authenticated-only", async () => {
    // P4-S0 (§6.1): raw mv_lot_cost_by_rule is owner-only (no RLS on a matview); the
    // authenticated read surface is the tenant-filtered _secure barrier view.
    const rawMv = await h.query<{ has: boolean }>(
      `select has_table_privilege('authenticated','mv_lot_cost_by_rule','select') as has;`,
    );
    expect(rawMv[0].has).toBe(false);
    const mv = await h.query<{ a: boolean; an: boolean }>(
      `select has_table_privilege('authenticated','mv_lot_cost_by_rule_secure','select') as a,
              has_table_privilege('anon','mv_lot_cost_by_rule_secure','select') as an;`,
    );
    const fn = await h.query<{ a: boolean; an: boolean }>(
      `select has_function_privilege('authenticated','cogs_breakdown_per_lot(text)','execute') as a,
              has_function_privilege('anon','cogs_breakdown_per_lot(text)','execute') as an;`,
    );
    expect(mv[0].a).toBe(true);
    expect(mv[0].an).toBe(false);
    expect(fn[0].a).toBe(true);
    expect(fn[0].an).toBe(false);
  });
});
