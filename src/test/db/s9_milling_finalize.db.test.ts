// P3-S9 — Finalize milling + green grade + COGS flow.
//
// These tests replay the REAL migrations in PGlite (AD-9) and prove the finalize
// slice's load-bearing invariants against HAND-COMPUTED seeds — written RED first.
// The keystone: a milling run can only be FINALIZED when its CLOSED OUTTURN MASS
// BALANCE holds (the "weight-loss mystery" the spike flags is physically rejected);
// finalize then CALLS the existing materialize_green_lot to mint the green node via
// the existing conserved 'process' edge, posts a processing cost_entry so milling
// cost folds into cogs_per_lot, and auto-grades the green (SCA prep GENERATED from
// defects, so the grade can never drift from the counts).
//
//   (1) CLOSED MASS BALANCE — finalize ACCEPTS a realistic ~82% run and REJECTS an
//       18%-vanished run (unaccounted loss over the lot_yield_curve-derived ceiling).
//   (2) GREEN MINT REUSE — finalize calls materialize_green_lot (the canonical
//       caller): a green lots node at stage='green' + a conserved 'process' lot_edge.
//   (3) COGS FLOW — a processing-batch cost_entry is posted to the minted green lot,
//       so cogs_per_lot(green) instantly reflects the milling cost (HARD dep on
//       Phase-1 cost_entry/refresh_lot_cost/cogs_per_lot).
//   (4) GRADE CAN'T DRIFT — mill_grade.sca_prep is GENERATED from cat1/cat2 defects;
//       a contradicting grade is physically un-storable; the ledger is append-only.
//   (5) IDEMPOTENT on the green code — a replayed finalize returns the SAME code and
//       posts NO second cost_entry.
//   (6) AD-8 GRANTS — authenticated reads every new table/view; anon reads/executes
//       NOTHING; every RPC's EXECUTE is revoked from public.
//   (7) TENANT ISOLATION — a mill_grade row in tenant A is invisible to tenant B.
//
// All money/mass math is hand-computed in the comments next to each assertion.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asTenant, freshDb, type Harness } from "./pgliteHarness";

/**
 * Build a milling run end-to-end through the REAL S7/S8 RPC chain, ready to finalize.
 * A passing mill_readiness is inserted DIRECTLY (the reposo upstream needs drying
 * history we don't model here; the gate itself is S7's test, not S9's), then the run
 * is opened + a pass + byproducts recorded through the canonical RPCs.
 */
async function buildRun(
  h: Harness,
  opts: {
    parchment: string;
    parchmentKg: number;
    passOut: number;
    moisture: number;
    byproducts?: Array<{ kind: string; kg: number }>;
  },
): Promise<number> {
  await h.query(
    `insert into lots (code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
       values ('${opts.parchment}', 'parchment', 'Geisha', ${opts.parchmentKg}, ${opts.parchmentKg}, true, now());`,
  );
  // A passing readiness (in-spec moisture + aw + reposo-cleared) inserted directly.
  await h.query(
    `insert into mill_readiness (parchment_lot_code, moisture_pct, water_activity_aw, reposo_ready, measured_at, idempotency_key)
       values ('${opts.parchment}', ${opts.moisture}, 0.55, true, now(), 'rdy-${opts.parchment}');`,
  );
  const run = await h.query<{ id: number }>(
    `select open_milling_run('${opts.parchment}', ${opts.parchmentKg}, 'open-${opts.parchment}') as id;`,
  );
  const runId = Number(run[0].id);
  await h.query(
    `select record_mill_pass(${runId}, 1, 'huller', ${opts.parchmentKg}, ${opts.passOut}, 0, 'pass-${opts.parchment}-1');`,
  );
  for (const [i, b] of (opts.byproducts ?? []).entries()) {
    await h.query(
      `select record_mill_byproduct(${runId}, '${b.kind}', ${b.kg}, 'byp-${opts.parchment}-${i}');`,
    );
  }
  return runId;
}

// ──────────────────────────────────────────────────────────────────────────
// 1. CLOSED MASS BALANCE + GREEN MINT + COGS FLOW — the happy path keystone.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S9 finalize — closed mass balance, green mint, COGS folds in", () => {
  let h: Harness;
  let green: string;
  let runId: number;
  beforeAll(async () => {
    h = await freshDb();
    // parchment 1000 kg @ 11.0% moisture. Pass huller -> 820 clean stream.
    // byproducts husk 150 + screen_rejects 25 = 175. moisture loss = 1000*(11.0-10.5)/100 = 5.
    // green_out 820. unaccounted = 1000 - 820 - 175 - 0 - 5 = 0  (<= ceiling 20). BALANCES.
    runId = await buildRun(h, {
      parchment: "JC-700",
      parchmentKg: 1000,
      passOut: 820,
      moisture: 11.0,
      byproducts: [
        { kind: "husk", kg: 150 },
        { kind: "screen_rejects", kg: 25 },
      ],
    });
    // processing cost 1640 / 820 kg green = $2.00 / kg-green (clean).
    const r = await h.query<{ code: string }>(
      `select finalize_milling_run(${runId}, 820, 88.0, 'WH-A', 0, 3, 18, 1640, 'fin-700') as code;`,
    );
    green = r[0].code;
  });
  afterAll(async () => h.close());

  it("finalize returns a freshly minted JC-NNN green lot code", () => {
    expect(green).toMatch(/^JC-[0-9]{3,}$/);
  });

  it("the minted node is a green lot with a conserved 'process' edge from the parchment", async () => {
    const node = await h.query<{ stage: string; kg: number }>(
      `select stage, current_kg as kg from lots where code = '${green}';`,
    );
    expect(node[0].stage).toBe("green");
    expect(Number(node[0].kg)).toBeCloseTo(820, 6);
    const edge = await h.query<{ kg: number }>(
      `select kg from lot_edges where parent_code = 'JC-700' and child_code = '${green}' and kind = 'process';`,
    );
    expect(edge.length).toBe(1);
    expect(Number(edge[0].kg)).toBeCloseTo(820, 6);
  });

  it("the run is finalized with green_kg_out + outturn set", async () => {
    const r = await h.query<{ status: string; out: number; pct: number }>(
      `select status, green_kg_out as out, outturn_pct as pct from milling_runs where id = ${runId};`,
    );
    expect(r[0].status).toBe("finalized");
    expect(Number(r[0].out)).toBeCloseTo(820, 6);
    expect(Number(r[0].pct)).toBeCloseTo(0.82, 6); // 820 / 1000
  });

  it("mill_run_balance.balance_ok is TRUE for the finalized run", async () => {
    const r = await h.query<{ ok: boolean; unaccounted: number }>(
      `select balance_ok as ok, unaccounted_loss as unaccounted from mill_run_balance where run_id = ${runId};`,
    );
    expect(r[0].ok).toBe(true);
    expect(Number(r[0].unaccounted)).toBeCloseTo(0, 6);
  });

  it("cogs_per_lot folds the milling cost into cost-per-kg-green (1640 / 820 = 2.00)", async () => {
    const r = await h.query<{ v: number | null }>(
      `select cogs_per_lot('${green}') as v;`,
    );
    expect(Number(r[0].v)).toBeCloseTo(2.0, 6);
  });

  it("auto-grades the green lot EP-Specialty (cat1=0, cat2=3 -> Specialty band)", async () => {
    const r = await h.query<{ prep: string }>(
      `select sca_prep as prep from mill_grade where green_lot_code = '${green}';`,
    );
    expect(r[0].prep).toBe("EP-Specialty");
  });

  it("appends a 'mill_run_finalized' lot_event keyed on the parchment lot", async () => {
    const r = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_event
         where stream_key = 'JC-700' and kind = 'mill_run_finalized';`,
    );
    expect(r[0].n).toBe(1);
  });

  it("is idempotent on replay: same green code, NO second processing cost_entry", async () => {
    const again = await h.query<{ code: string }>(
      `select finalize_milling_run(${runId}, 820, 88.0, 'WH-A', 0, 3, 18, 1640, 'fin-700') as code;`,
    );
    expect(again[0].code).toBe(green);
    const c = await h.query<{ n: number }>(
      `select count(*)::int as n from cost_entry
         where target_kind = 'lot' and target_code = '${green}' and allocation_rule = 'processing';`,
    );
    expect(c[0].n).toBe(1);
    // cogs unchanged (no double-posted cost).
    const cogs = await h.query<{ v: number | null }>(
      `select cogs_per_lot('${green}') as v;`,
    );
    expect(Number(cogs[0].v)).toBeCloseTo(2.0, 6);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2. THE WEIGHT-LOSS MYSTERY — an 18%-vanished run is REJECTED (no silent loss).
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S9 finalize REJECTS the weight-loss mystery (unaccounted loss over ceiling)", () => {
  let h: Harness;
  let runId: number;
  beforeAll(async () => {
    h = await freshDb();
    // parchment 1000 @ 11.0%, pass -> 820, but NO byproducts recorded.
    // moisture loss = 5. unaccounted = 1000 - 820 - 0 - 0 - 5 = 175  >> ceiling 20.
    runId = await buildRun(h, {
      parchment: "JC-710",
      parchmentKg: 1000,
      passOut: 820,
      moisture: 11.0,
      byproducts: [],
    });
  });
  afterAll(async () => h.close());

  it("finalize RAISES on the unbalanced run", async () => {
    await expect(
      h.query(`select finalize_milling_run(${runId}, 820, 88.0, 'WH-A', 0, 3, 18, 1640, 'fin-710');`),
    ).rejects.toThrow(/balance|mass|loss|unaccounted|outturn/i);
  });

  it("the run is left OPEN and NO green lot was minted (the whole txn rolled back)", async () => {
    const r = await h.query<{ status: string; out: number | null }>(
      `select status, green_kg_out as out from milling_runs where id = ${runId};`,
    );
    expect(r[0].status).toBe("open");
    expect(r[0].out).toBeNull();
    const g = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_edges where parent_code = 'JC-710' and kind = 'process';`,
    );
    expect(g[0].n).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. GRADE CAN'T DRIFT FROM DEFECTS (GENERATED) + append-only ledger.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S9 mill_grade — SCA prep GENERATED from defects, append-only", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(
      `insert into lots (code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
         values ('JC-720', 'milled', 'Geisha', 900, 900, true, now());`,
    );
    await h.query(
      `select materialize_green_lot('JC-720', 'JC-721', 800, 88, 'WH-A', now());`,
    );
  });
  afterAll(async () => h.close());

  it("cat1=0, cat2=3 grades EP-Specialty", async () => {
    await h.query(
      `insert into mill_grade (green_lot_code, cat1_defects, cat2_defects, screen_size, idempotency_key)
         values ('JC-721', 0, 3, 18, 'g-ep');`,
    );
    const r = await h.query<{ prep: string }>(
      `select sca_prep as prep from mill_grade where idempotency_key like '%g-ep';`,
    );
    expect(r[0].prep).toBe("EP-Specialty");
  });

  it("a primary (cat1) defect demotes the grade out of the Specialty band", async () => {
    await h.query(
      `insert into mill_grade (green_lot_code, cat1_defects, cat2_defects, screen_size, idempotency_key)
         values ('JC-721', 4, 0, 16, 'g-ex');`,
    );
    const r = await h.query<{ prep: string }>(
      `select sca_prep as prep from mill_grade where idempotency_key like '%g-ex';`,
    );
    expect(r[0].prep).not.toBe("EP-Specialty");
    expect(r[0].prep).toBe("Exchange");
  });

  it("the grade is GENERATED — a row cannot store a contradicting sca_prep", async () => {
    await expect(
      h.query(
        `insert into mill_grade (green_lot_code, cat1_defects, cat2_defects, sca_prep)
           values ('JC-721', 9, 9, 'EP-Specialty');`,
      ),
    ).rejects.toThrow(/generated|cannot insert|sca_prep/i);
  });

  it("mill_grade is append-only: an UPDATE is rejected", async () => {
    await expect(
      h.query(`update mill_grade set cat2_defects = 0 where idempotency_key like '%g-ep';`),
    ).rejects.toThrow(/append-only|not permitted/i);
  });

  it("record_green_grade RPC appends a grade row and is idempotent", async () => {
    const a = await h.query<{ id: number }>(
      `select record_green_grade('JC-721', 0, 2, 17, 'rpc-grade') as id;`,
    );
    const b = await h.query<{ id: number }>(
      `select record_green_grade('JC-721', 0, 2, 17, 'rpc-grade') as id;`,
    );
    expect(Number(a[0].id)).toBe(Number(b[0].id)); // same row on replay
    const v = await h.query<{ prep: string }>(
      `select sca_prep as prep from v_green_grade where green_lot_code = 'JC-721';`,
    );
    expect(v[0].prep).toBe("EP-Specialty"); // latest grade (cat1=0,cat2=2)
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 4. AD-8 GRANTS — authenticated reads; anon reads/executes NOTHING.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S9 AD-8 grant posture", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
  });
  afterAll(async () => h.close());

  const OBJECTS = ["mill_grade", "v_green_grade"];

  it("authenticated holds SELECT on every new table/view", async () => {
    for (const t of OBJECTS) {
      const r = await h.query<{ has: boolean }>(
        `select has_table_privilege('authenticated','${t}','select') as has;`,
      );
      expect(r[0].has, `authenticated should read ${t}`).toBe(true);
    }
  });

  it("anon holds NO SELECT on any new table/view", async () => {
    for (const t of OBJECTS) {
      const r = await h.query<{ has: boolean }>(
        `select has_table_privilege('anon','${t}','select') as has;`,
      );
      expect(r[0].has, `anon must NOT read ${t}`).toBe(false);
    }
  });

  it("the command RPCs are executable by authenticated, not anon, not public", async () => {
    const fns = [
      "finalize_milling_run(bigint, numeric, numeric, text, integer, integer, integer, numeric, text)",
      "record_green_grade(text, integer, integer, integer, text)",
    ];
    for (const fn of fns) {
      const r = await h.query<{ a: boolean; an: boolean; pub: boolean }>(
        `select has_function_privilege('authenticated','${fn}','execute') as a,
                has_function_privilege('anon','${fn}','execute') as an,
                has_function_privilege('public','${fn}','execute') as pub;`,
      );
      expect(r[0].a, `authenticated should execute ${fn}`).toBe(true);
      expect(r[0].an, `anon must NOT execute ${fn}`).toBe(false);
      expect(r[0].pub, `public must NOT execute ${fn}`).toBe(false);
    }
  });

  it("anon cannot read mill_grade through the live role posture", async () => {
    await expect(
      asAnon(h, (hh) => hh.query(`select * from mill_grade limit 1;`)),
    ).rejects.toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 5. TENANT ISOLATION — a mill_grade row in tenant A is invisible to tenant B.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S9 tenant isolation — green grades do not leak cross-tenant", () => {
  const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(
      `insert into tenants (id, slug, name) values
         ('${A}','tenant-a','Estate A'),('${B}','tenant-b','Estate B');`,
    );
    for (const t of [A, B]) {
      await h.query(
        `insert into lots (tenant_id, code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
           values ('${t}','JC-700','green','Geisha',820,820,true,now());`,
      );
      await h.query(
        `insert into green_lots (tenant_id, lot_code, cupping_score, location)
           values ('${t}','JC-700',88,'WH-A');`,
      );
    }
    await h.query(
      `insert into mill_grade (tenant_id, green_lot_code, cat1_defects, cat2_defects, screen_size)
         values ('${A}','JC-700',0,3,18),('${B}','JC-700',2,1,16);`,
    );
  });
  afterAll(async () => h.close());

  it("as tenant A, only A's grade is visible", async () => {
    const rows = await asTenant(h, A, (hh) =>
      hh.query<{ tenant_id: string; prep: string }>(
        `select tenant_id, sca_prep as prep from mill_grade;`,
      ),
    );
    expect(rows.length).toBe(1);
    expect(rows[0].tenant_id).toBe(A);
    expect(rows[0].prep).toBe("EP-Specialty");
  });

  it("as tenant B, A's grade is invisible (no cross-tenant read)", async () => {
    const aVisible = await asTenant(h, B, (hh) =>
      hh.query(`select 1 from mill_grade where tenant_id = '${A}';`),
    );
    expect(aVisible).toHaveLength(0);
  });
});
