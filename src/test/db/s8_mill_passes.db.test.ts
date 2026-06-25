// P3-S8 — Machine-pass chain + byproducts + the CLOSED mass balance.
//
// These tests replay the REAL migrations in PGlite (AD-9) and prove the dry-milling
// pass-chain slice's data-layer invariants against HAND-COMPUTED seeds — written RED
// first per the spec (PHASE3-DESIGN.md lines 279–286 + the P3-SPIKE-MILL note).
//
//   (1) PER-PASS MASS BALANCE (the table CHECK) — a pass can NEVER output+reject more
//       than it took in (output_kg + reject_kg <= input_kg + 1e-9). record_mill_pass
//       RAISES on a violating row.
//   (2) CROSS-PASS CONTINUITY (in-RPC) — pass N's input MUST equal pass N-1's output
//       (and pass 1's input the run's parchment_kg_in); a broken chain RAISES.
//   (3) BYPRODUCT = ITS OWN CONSERVED NODE — record_mill_byproduct mints a fresh
//       lots node (a JC-NNN at stage='byproduct') and routes a `kind='byproduct'` lot_edge from the parchment
//       lot, so the SHIPPED lot_edges_conserve_mass() trigger guards it FOR FREE
//       (the mass guarantee is REUSED, never re-implemented). Over-routing more
//       byproduct than the parchment holds RAISES on the conservation trigger.
//   (4) THE CLOSED OUTTURN MASS BALANCE (the SPIKE) — mill_run_balance.balance_ok is
//       TRUE for a realistic 82% run (green + husk byproduct + moisture-delta loss all
//       account for the parchment), and FALSE for an 18%-vanished run (mass disappears
//       with no byproduct/reject record). The unaccounted-loss ceiling is derived from
//       lot_yield_curve(parchment→green), NEVER a hardcoded magic number.
//   (5) AD-8 GRANTS — authenticated reads every new table/view; anon reads/executes
//       NOTHING; every command RPC's EXECUTE is revoked from public + anon.
//   (6) TENANT ISOLATION — a pass/byproduct row in tenant A is invisible to tenant B.
//   (7) APPEND-ONLY — mill_passes + mill_byproducts reject UPDATE/DELETE and carry no
//       client UPDATE/DELETE/INSERT grant (RPC-only write door).
//   (8) NO OVERSELL TOUCH — recording passes/byproducts consumes PARCHMENT; it never
//       inserts a lot_reservations/lot_shipments row (no parallel counter).
//   (9) AUDIT — record_mill_pass / record_mill_byproduct append lot_events on the chain.
//  (10) IDEMPOTENCY — replaying a command on the same key returns the same id/code, one row.
//
// All thresholds are hand-checked in comments next to each assertion.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asTenant, freshDb, type Harness } from "./pgliteHarness";

/**
 * Seed an OPEN milling run for a parchment lot, bypassing the S7 reposo/open gate
 * (owner/superuser inserts) — this slice exercises the PASS chain, not the open gate.
 * The parchment lot holds 100 kg; a passing-readiness row (moisture 11.0%) is seeded so
 * the balance view's accounted-moisture-loss path is exercised (11.0 → 10.5 ⇒ 0.5 kg).
 */
async function seedOpenRun(
  h: Harness,
  lot: string,
  parchmentKg = 100,
  moisture = 11.0,
): Promise<number> {
  await h.query(
    `insert into lots (code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
       values ('${lot}', 'parchment', 'Geisha', ${parchmentKg}, ${parchmentKg}, true, now());`,
  );
  await h.query(
    `insert into mill_readiness (parchment_lot_code, moisture_pct, water_activity_aw, reposo_ready)
       values ('${lot}', ${moisture}, 0.55, true);`,
  );
  const r = await h.query<{ id: number }>(
    `insert into milling_runs (parchment_lot_code, parchment_kg_in, status)
       values ('${lot}', ${parchmentKg}, 'open') returning id;`,
  );
  return Number(r[0].id);
}

// ──────────────────────────────────────────────────────────────────────────
// 1. THE CLOSED OUTTURN MASS BALANCE — the keystone (invariant 1 + the SPIKE).
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S8 closed mass balance — honest 82% run balances; an 18%-vanished run does not", () => {
  let h: Harness;
  let honestRun: number;
  let vanishedRun: number;
  beforeAll(async () => {
    h = await freshDb();

    // HONEST RUN — parchment 100 kg → green 82 kg, husk byproduct 17.5 kg, moisture 0.5 kg.
    //   unaccounted = 100 − 82 − 17.5(byproduct) − 0(reject) − 0.5(moisture) = 0.0 kg.
    //   ceiling = 100 × (1 − 0.80 yield) × 0.10 = 2.0 kg.  0.0 ≤ 2.0 ⇒ balance_ok.
    honestRun = await seedOpenRun(h, "JC-200");
    await h.query(
      `select record_mill_pass(${honestRun}, 1, 'huller', 100, 82, 0, 'pass-700-1');`,
    );
    await h.query(
      `select record_mill_byproduct(${honestRun}, 'husk', 17.5, 'byp-700-husk');`,
    );

    // VANISHED RUN — same green 82 kg out, but NO byproduct recorded: 17.5 kg just gone.
    //   unaccounted = 100 − 82 − 0 − 0 − 0.5 = 17.5 kg > 2.0 ceiling ⇒ NOT balance_ok.
    vanishedRun = await seedOpenRun(h, "JC-201");
    await h.query(
      `select record_mill_pass(${vanishedRun}, 1, 'huller', 100, 82, 0, 'pass-701-1');`,
    );
  });
  afterAll(async () => h.close());

  it("mill_run_balance.balance_ok is TRUE for the fully-accounted 82% run", async () => {
    const r = await h.query<{
      ok: boolean;
      unacc: number;
      ceil: number;
      green: number;
      byp: number;
    }>(
      `select balance_ok as ok, unaccounted_loss as unacc, loss_ceiling as ceil,
              green_out as green, sum_byproduct as byp
         from mill_run_balance where run_id = ${honestRun};`,
    );
    expect(Number(r[0].green)).toBeCloseTo(82, 6);
    expect(Number(r[0].byp)).toBeCloseTo(17.5, 6);
    expect(Number(r[0].unacc)).toBeCloseTo(0, 6); // fully accounted
    expect(Number(r[0].ceil)).toBeCloseTo(2, 6); // 100 × 0.20 × 0.10
    expect(r[0].ok).toBe(true);
  });

  it("mill_run_balance.balance_ok is FALSE for the 18%-vanished run (mass disappeared)", async () => {
    const r = await h.query<{ ok: boolean; unacc: number; ceil: number }>(
      `select balance_ok as ok, unaccounted_loss as unacc, loss_ceiling as ceil
         from mill_run_balance where run_id = ${vanishedRun};`,
    );
    expect(Number(r[0].unacc)).toBeCloseTo(17.5, 6); // 100 − 82 − 0 − 0 − 0.5
    expect(Number(r[0].unacc)).toBeGreaterThan(Number(r[0].ceil));
    expect(r[0].ok).toBe(false);
  });

  it("the loss ceiling is DERIVED from lot_yield_curve(parchment→green), not hardcoded", async () => {
    // tune the curve to 0.70 outturn ⇒ ceiling = 100 × 0.30 × 0.10 = 3.0 kg.
    await h.query(
      `update lot_yield_curve set yield_factor = 0.70
         where from_stage = 'parchment' and to_stage = 'green';`,
    );
    const r = await h.query<{ ceil: number }>(
      `select loss_ceiling as ceil from mill_run_balance where run_id = ${honestRun};`,
    );
    expect(Number(r[0].ceil)).toBeCloseTo(3, 6);
    await h.query(
      `update lot_yield_curve set yield_factor = 0.80
         where from_stage = 'parchment' and to_stage = 'green';`,
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2. PER-PASS MASS BALANCE + CROSS-PASS CONTINUITY.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S8 pass chain — per-pass CHECK + cross-pass continuity", () => {
  let h: Harness;
  let run: number;
  beforeAll(async () => {
    h = await freshDb();
    run = await seedOpenRun(h, "JC-210");
  });
  afterAll(async () => h.close());

  it("records a valid first pass (input = parchment_kg_in)", async () => {
    const r = await h.query<{ id: number }>(
      `select record_mill_pass(${run}, 1, 'huller', 100, 82, 0, 'p710-1') as id;`,
    );
    expect(Number(r[0].id)).toBeGreaterThan(0);
  });

  it("REJECTS a pass whose output+reject exceeds input (per-pass mass CHECK)", async () => {
    // 80 output + 25 reject = 105 > 82 input ⇒ the table CHECK fires.
    await expect(
      h.query(`select record_mill_pass(${run}, 2, 'polisher', 82, 80, 25, 'p710-bad');`),
    ).rejects.toThrow(/mass|check|balance/i);
  });

  it("REJECTS a non-contiguous pass (input != prior pass output)", async () => {
    // prior (pass 1) output = 82; this pass claims 95 in ⇒ continuity broken.
    await expect(
      h.query(`select record_mill_pass(${run}, 2, 'polisher', 95, 90, 0, 'p710-gap');`),
    ).rejects.toThrow(/continuity|contiguous|input/i);
  });

  it("ACCEPTS a contiguous second pass (input = prior output 82)", async () => {
    const r = await h.query<{ id: number }>(
      `select record_mill_pass(${run}, 2, 'polisher', 82, 80, 1, 'p710-2') as id;`,
    );
    expect(Number(r[0].id)).toBeGreaterThan(0);
  });

  it("appends a 'mill_pass_recorded' lot_event keyed on the parchment lot", async () => {
    const r = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_event
         where stream_key = 'JC-210' and kind = 'mill_pass_recorded';`,
    );
    expect(r[0].n).toBeGreaterThanOrEqual(2);
  });

  it("record_mill_pass is idempotent on its key (replay returns same id, one row)", async () => {
    const a = await h.query<{ id: number }>(
      `select record_mill_pass(${run}, 1, 'huller', 100, 82, 0, 'p710-1') as id;`,
    );
    expect(Number(a[0].id)).toBeGreaterThan(0);
    const n = await h.query<{ n: number }>(
      `select count(*)::int as n from mill_passes where idempotency_key like '%p710-1';`,
    );
    expect(n[0].n).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. BYPRODUCT = ITS OWN CONSERVED NODE (mass guarantee REUSED).
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S8 byproducts — each its own lots node + conserved byproduct edge", () => {
  let h: Harness;
  let run: number;
  let bypCode: string;
  beforeAll(async () => {
    h = await freshDb();
    run = await seedOpenRun(h, "JC-220");
    await h.query(`select record_mill_pass(${run}, 1, 'huller', 100, 82, 0, 'p720-1');`);
    const r = await h.query<{ code: string }>(
      `select record_mill_byproduct(${run}, 'husk', 17.5, 'byp-720') as code;`,
    );
    bypCode = r[0].code;
  });
  afterAll(async () => h.close());

  it("mints a fresh lots node for the byproduct (stage='byproduct', carries variety)", async () => {
    const r = await h.query<{ stage: string; variety: string; kg: number }>(
      `select stage, variety, current_kg as kg from lots where code = '${bypCode}';`,
    );
    expect(r[0].stage).toBe("byproduct");
    expect(r[0].variety).toBe("Geisha");
    expect(Number(r[0].kg)).toBeCloseTo(17.5, 6);
  });

  it("routes a conserved kind='byproduct' lot_edge from the parchment lot", async () => {
    const r = await h.query<{ kind: string; kg: number; parent: string }>(
      `select kind, kg, parent_code as parent from lot_edges
         where child_code = '${bypCode}';`,
    );
    expect(r[0].kind).toBe("byproduct");
    expect(r[0].parent).toBe("JC-220");
    expect(Number(r[0].kg)).toBeCloseTo(17.5, 6);
  });

  it("the SHIPPED conservation trigger REJECTS over-routing byproduct beyond the parchment mass", async () => {
    // parchment holds 100 kg; 17.5 already routed; routing another 90 ⇒ 107.5 > 100.
    await expect(
      h.query(`select record_mill_byproduct(${run}, 'chaff', 90, 'byp-720-over');`),
    ).rejects.toThrow(/mass conservation|exceed|route/i);
  });

  it("record_mill_byproduct is idempotent on its key (replay returns same code, one node)", async () => {
    const a = await h.query<{ code: string }>(
      `select record_mill_byproduct(${run}, 'husk', 17.5, 'byp-720') as code;`,
    );
    expect(a[0].code).toBe(bypCode);
    const n = await h.query<{ n: number }>(
      `select count(*)::int as n from mill_byproducts where idempotency_key like '%byp-720';`,
    );
    expect(n[0].n).toBe(1);
  });

  it("appends a 'mill_byproduct_recorded' lot_event keyed on the parchment lot", async () => {
    const r = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_event
         where stream_key = 'JC-220' and kind = 'mill_byproduct_recorded';`,
    );
    expect(r[0].n).toBeGreaterThanOrEqual(1);
  });

  it("recording passes/byproducts NEVER claims green inventory — the oversell seam is untouched", async () => {
    const res = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_reservations;`,
    );
    const ship = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_shipments;`,
    );
    expect(res[0].n).toBe(0);
    expect(ship[0].n).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 4. APPEND-ONLY posture + no client write grant.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S8 append-only posture", () => {
  let h: Harness;
  let run: number;
  beforeAll(async () => {
    h = await freshDb();
    run = await seedOpenRun(h, "JC-230");
    await h.query(`select record_mill_pass(${run}, 1, 'huller', 100, 82, 0, 'p730-1');`);
    await h.query(`select record_mill_byproduct(${run}, 'husk', 17, 'byp-730');`);
  });
  afterAll(async () => h.close());

  it("rejects an UPDATE to mill_passes", async () => {
    await expect(
      h.query(`update mill_passes set output_kg = 1 where run_id = ${run};`),
    ).rejects.toThrow(/append-only|not permitted/i);
  });

  it("rejects a DELETE from mill_passes", async () => {
    await expect(
      h.query(`delete from mill_passes where run_id = ${run};`),
    ).rejects.toThrow(/append-only|not permitted/i);
  });

  it("rejects an UPDATE/DELETE to mill_byproducts", async () => {
    await expect(
      h.query(`update mill_byproducts set kg = 1 where run_id = ${run};`),
    ).rejects.toThrow(/append-only|not permitted/i);
    await expect(
      h.query(`delete from mill_byproducts where run_id = ${run};`),
    ).rejects.toThrow(/append-only|not permitted/i);
  });

  it("neither table grants insert/update/delete to authenticated (RPC-only write door)", async () => {
    for (const t of ["mill_passes", "mill_byproducts"]) {
      const r = await h.query<{ ins: boolean; upd: boolean; del: boolean }>(
        `select has_table_privilege('authenticated','${t}','insert') as ins,
                has_table_privilege('authenticated','${t}','update') as upd,
                has_table_privilege('authenticated','${t}','delete') as del;`,
      );
      expect(r[0].ins, `${t} insert`).toBe(false);
      expect(r[0].upd, `${t} update`).toBe(false);
      expect(r[0].del, `${t} delete`).toBe(false);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 5. AD-8 GRANTS — authenticated reads; anon reads/executes NOTHING.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S8 AD-8 grant posture", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
  });
  afterAll(async () => h.close());

  const TABLES = ["mill_passes", "mill_byproducts"];
  const VIEWS = ["mill_run_balance", "mill_outturn_by_variety"];

  it("authenticated holds SELECT on every new table and view", async () => {
    for (const t of [...TABLES, ...VIEWS]) {
      const r = await h.query<{ has: boolean }>(
        `select has_table_privilege('authenticated','${t}','select') as has;`,
      );
      expect(r[0].has, `authenticated should read ${t}`).toBe(true);
    }
  });

  it("anon holds NO SELECT on any new table or view", async () => {
    for (const t of [...TABLES, ...VIEWS]) {
      const r = await h.query<{ has: boolean }>(
        `select has_table_privilege('anon','${t}','select') as has;`,
      );
      expect(r[0].has, `anon must NOT read ${t}`).toBe(false);
    }
  });

  it("every command RPC is executable by authenticated, not anon, not public", async () => {
    const fns = [
      "record_mill_pass(bigint, integer, text, numeric, numeric, numeric, text)",
      "record_mill_byproduct(bigint, text, numeric, text)",
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

  it("anon cannot read mill_passes through the live role posture", async () => {
    await expect(
      asAnon(h, (hh) => hh.query(`select * from mill_passes limit 1;`)),
    ).rejects.toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 6. TENANT ISOLATION — passes/byproducts do not leak cross-tenant.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S8 tenant isolation", () => {
  const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(
      `insert into tenants (id, slug, name) values
         ('${A}','tenant-a','Estate A'),('${B}','tenant-b','Estate B');`,
    );
    // >1 tenant ⇒ default is NULL — stamp tenant_id LITERALLY on every owner insert.
    await h.query(
      `insert into lots (tenant_id, code, stage, variety, origin_kg, current_kg, minted_at) values
         ('${A}','JC-101','parchment','Geisha',100,100, now()),
         ('${B}','JC-201','parchment','Geisha',100,100, now());`,
    );
    await h.query(
      `insert into milling_runs (tenant_id, parchment_lot_code, parchment_kg_in, status) values
         ('${A}','JC-101',100,'open'),('${B}','JC-201',100,'open');`,
    );
    const ra = await h.query<{ id: number }>(
      `select id from milling_runs where tenant_id = '${A}';`,
    );
    const rb = await h.query<{ id: number }>(
      `select id from milling_runs where tenant_id = '${B}';`,
    );
    await h.query(
      `insert into mill_passes (tenant_id, run_id, pass_no, machine_kind, input_kg, output_kg, reject_kg)
         values ('${A}', ${Number(ra[0].id)}, 1, 'huller', 100, 82, 0),
                ('${B}', ${Number(rb[0].id)}, 1, 'huller', 100, 82, 0);`,
    );
  });
  afterAll(async () => h.close());

  it("as tenant A, only A's pass row is visible", async () => {
    const rows = await asTenant(h, A, (hh) =>
      hh.query<{ tenant_id: string }>(`select tenant_id from mill_passes;`),
    );
    expect(rows.length).toBe(1);
    expect(rows[0].tenant_id).toBe(A);
  });

  it("as tenant B, A's pass row is invisible", async () => {
    const aVisible = await asTenant(h, B, (hh) =>
      hh.query(`select 1 from mill_passes where tenant_id = '${A}';`),
    );
    expect(aVisible).toHaveLength(0);
  });
});
