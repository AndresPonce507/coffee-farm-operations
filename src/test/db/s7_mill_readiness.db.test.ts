// P3-S7 — Mill readiness + run skeleton: THE no-mill-out-of-spec gate.
//
// These tests replay the REAL migrations in PGlite (AD-9) and prove the dry-milling
// readiness slice's data-layer invariants against HAND-COMPUTED seeds — written RED
// first per the spec (PHASE3-DESIGN.md lines 269–278). The keystone (invariant 2):
// a parchment lot CANNOT open a milling run unless it has a passing mill_readiness
// row — moisture 10.5–11.5%, water-activity aw < 0.60, AND the Phase-2 reposo
// clearance is `ready`. The single biggest outturn-killer is blocked at the door,
// at the DATABASE, not just the UI.
//
//   (1) THE GATE — open_milling_run RAISES (check_violation) unless a passing
//       mill_readiness row exists. Out-of-spec moisture, high aw, or an unrested
//       lot (reposo not ready) all keep the door shut.
//   (2) REPOSO UPSTREAM GATE — record_mill_readiness snapshots reposo_status().ready
//       into reposo_ready; a perfect moisture/aw reading on an UNRESTED lot is NOT
//       `passed` (the reposo clearance is folded into the generated `passed`).
//   (3) outturn_pct GENERATED — green_kg_out / parchment_kg_in (NULL until finalized).
//   (4) IDEMPOTENCY — replaying open_milling_run on the same key returns the same id.
//   (5) APPEND-ONLY — mill_readiness rejects UPDATE/DELETE; milling_runs carries no
//       client UPDATE/DELETE grant (status transitions flow through future RPCs).
//   (6) AD-8 GRANTS — authenticated reads every new table/view; anon reads/executes
//       NOTHING; every command RPC's EXECUTE is revoked from public.
//   (7) TENANT ISOLATION — a mill_readiness row in tenant A is invisible to tenant B.
//   (8) NO OVERSELL TOUCH — opening a run consumes PARCHMENT; it never inserts a
//       lot_reservations/lot_shipments row, so the shared prevent_oversell money seam
//       is left entirely untouched (no parallel counter is introduced).
//   (9) AUDIT — open_milling_run appends a 'mill_run_opened' lot_event on the chain.
//
// All thresholds are hand-checked in comments next to each assertion.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asTenant, freshDb, type Harness } from "./pgliteHarness";

/**
 * Seed a parchment lot whose Phase-2 reposo gate reads `ready` — two in-band
 * moisture readings + a drying→parchment stage_advance event recorded 6 days ago
 * (min_reposo_days = 5). reposo_status(lot).ready ⇒ true.
 */
async function seedReposoReadyLot(h: Harness, code: string) {
  await h.query(
    `insert into lots (code, stage, variety, origin_kg, current_kg, minted_at)
       values ('${code}', 'parchment', 'Geisha', 100, 100, now());`,
  );
  // two moisture readings inside the 10.5–11.5 band (window = 2) ⇒ moisture_stable.
  await h.query(
    `insert into moisture_readings (lot_code, moisture_pct, occurred_at, device_id, device_seq)
       values ('${code}', 11.0, now() - interval '2 days', 'seed-${code}', 1),
              ('${code}', 11.0, now() - interval '1 day',  'seed-${code}', 2);`,
  );
  // the drying→parchment advance, recorded 6 days ago ⇒ rest_days 6 ≥ 5 ⇒ rest_met.
  await h.query(
    `insert into lot_event (stream_key, kind, payload, occurred_at, recorded_at, device_id, device_seq)
       values ('${code}', 'stage_advance', '{"to_stage":"parchment"}'::jsonb,
               now() - interval '6 days', now() - interval '6 days', 'seed-${code}', 3);`,
  );
}

/** A parchment lot with NO drying/moisture history ⇒ reposo_status().ready = false. */
async function seedUnrestedLot(h: Harness, code: string) {
  await h.query(
    `insert into lots (code, stage, variety, origin_kg, current_kg, minted_at)
       values ('${code}', 'parchment', 'Geisha', 100, 100, now());`,
  );
}

// ──────────────────────────────────────────────────────────────────────────
// 1. THE NO-MILL-OUT-OF-SPEC GATE — the keystone (invariant 2).
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S7 no-mill-out-of-spec gate — a run cannot open without a passing readiness", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedReposoReadyLot(h, "JC-300"); // rested + (will be) in-spec
    await seedReposoReadyLot(h, "JC-310"); // rested, but we'll record OUT-of-spec moisture
    await seedUnrestedLot(h, "JC-320"); // perfect moisture/aw but NOT rested
    await seedReposoReadyLot(h, "JC-350"); // rested but NEVER gets a readiness row
    await seedReposoReadyLot(h, "JC-360"); // passes, then re-measures FAILING (stale-pass regression)
  });
  afterAll(async () => h.close());

  it("reposo_status reads `ready` for the rested, in-band lot (the upstream gate)", async () => {
    const r = await h.query<{ ready: boolean }>(
      `select ready from reposo_status('JC-300');`,
    );
    expect(r[0].ready).toBe(true);
  });

  it("record_mill_readiness passes for moisture 11.0% + aw 0.55 on a rested lot", async () => {
    await h.query(
      `select record_mill_readiness('JC-300', 11.0, 0.55, now(), 'rdy-300');`,
    );
    const r = await h.query<{ passed: boolean; reposo: boolean }>(
      `select passed, reposo_ready as reposo from mill_readiness
         where parchment_lot_code = 'JC-300';`,
    );
    expect(r[0].reposo).toBe(true);
    expect(r[0].passed).toBe(true);
  });

  it("OPENS a milling run once a passing readiness exists", async () => {
    const r = await h.query<{ id: number }>(
      `select open_milling_run('JC-300', 90, 'run-300') as id;`,
    );
    expect(Number(r[0].id)).toBeGreaterThan(0);
    const run = await h.query<{ status: string; kg_in: number }>(
      `select status, parchment_kg_in as kg_in from milling_runs where id = ${Number(r[0].id)};`,
    );
    expect(run[0].status).toBe("open");
    expect(Number(run[0].kg_in)).toBeCloseTo(90, 6);
  });

  it("REJECTS opening a run for a lot whose readiness FAILED on moisture (12.5% out of band)", async () => {
    // rested lot, but moisture 12.5% is above the 11.5% ceiling ⇒ passed=false.
    await h.query(
      `select record_mill_readiness('JC-310', 12.5, 0.55, now(), 'rdy-310');`,
    );
    const passed = await h.query<{ passed: boolean }>(
      `select passed from mill_readiness where parchment_lot_code = 'JC-310';`,
    );
    expect(passed[0].passed).toBe(false);
    await expect(
      h.query(`select open_milling_run('JC-310', 90, 'run-310');`),
    ).rejects.toThrow(/no-mill-out-of-spec|readiness|spec/i);
  });

  it("REJECTS opening a run for an UNRESTED lot even with perfect moisture/aw (reposo upstream gate)", async () => {
    // moisture 11.0% + aw 0.55 are perfect, but the lot never rested ⇒ reposo_ready=false ⇒ passed=false.
    await h.query(
      `select record_mill_readiness('JC-320', 11.0, 0.55, now(), 'rdy-320');`,
    );
    const r = await h.query<{ passed: boolean; reposo: boolean }>(
      `select passed, reposo_ready as reposo from mill_readiness where parchment_lot_code = 'JC-320';`,
    );
    expect(r[0].reposo).toBe(false);
    expect(r[0].passed).toBe(false);
    await expect(
      h.query(`select open_milling_run('JC-320', 90, 'run-320');`),
    ).rejects.toThrow(/no-mill-out-of-spec|readiness|spec/i);
  });

  it("REJECTS opening a run for a lot with NO readiness row at all", async () => {
    await expect(
      h.query(`select open_milling_run('JC-350', 90, 'run-350');`),
    ).rejects.toThrow(/no-mill-out-of-spec|readiness|spec/i);
  });

  it("REJECTS opening a run when the LATEST re-measure FAILS, even though an earlier reading PASSED (stale-pass cannot reopen the gate)", async () => {
    // mill_readiness is append-only and re-measurement is the correction path: a lot
    // that passed, then degraded (e.g. moisture re-absorbed → 12.5% out of band) and
    // got a NEW failing re-measure must NOT mill — the gate reads the LATEST row, not
    // "any historical pass". v_mill_readiness already shows only the latest (FAIL), so
    // the gate must agree with the panel.
    await h.query(
      `select record_mill_readiness('JC-360', 11.0, 0.55, now() - interval '2 hours', 'rdy-360-pass');`,
    );
    const firstPass = await h.query<{ passed: boolean }>(
      `select passed from mill_readiness
         where parchment_lot_code = 'JC-360' order by measured_at desc, id desc limit 1;`,
    );
    expect(firstPass[0].passed).toBe(true); // earlier reading PASSED

    // later re-measure: moisture re-absorbed to 12.5% (out of the 11.5% ceiling) ⇒ FAIL.
    await h.query(
      `select record_mill_readiness('JC-360', 12.5, 0.55, now(), 'rdy-360-fail');`,
    );
    const latest = await h.query<{ passed: boolean }>(
      `select passed from mill_readiness
         where parchment_lot_code = 'JC-360' order by measured_at desc, id desc limit 1;`,
    );
    expect(latest[0].passed).toBe(false); // latest reading FAILS

    // the gate must read the LATEST (FAIL), not the stale PASS.
    await expect(
      h.query(`select open_milling_run('JC-360', 90, 'run-360');`),
    ).rejects.toThrow(/no-mill-out-of-spec|readiness|spec/i);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2. GENERATED outturn + idempotency + audit + no-oversell-touch.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S7 run skeleton — outturn, idempotency, audit, money-seam untouched", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedReposoReadyLot(h, "JC-330");
    await h.query(`select record_mill_readiness('JC-330', 11.0, 0.55, now(), 'rdy-330');`);
  });
  afterAll(async () => h.close());

  it("outturn_pct is NULL at open (green_kg_out not yet known) and computes on finalize-fill", async () => {
    const r = await h.query<{ id: number }>(
      `select open_milling_run('JC-330', 100, 'run-330') as id;`,
    );
    const runId = Number(r[0].id);
    const before = await h.query<{ outturn: number | null }>(
      `select outturn_pct as outturn from milling_runs where id = ${runId};`,
    );
    expect(before[0].outturn).toBeNull(); // no green_kg_out yet
    // Simulate the future finalize (owner/superuser bypass — there is no S7 RPC for it):
    await h.query(`update milling_runs set green_kg_out = 80 where id = ${runId};`);
    const after = await h.query<{ outturn: number | null }>(
      `select outturn_pct as outturn from milling_runs where id = ${runId};`,
    );
    expect(Number(after[0].outturn)).toBeCloseTo(0.8, 6); // 80 / 100 = 0.80 dry-mill outturn
  });

  it("open_milling_run is idempotent on its key (replay returns the same id, one row)", async () => {
    const a = await h.query<{ id: number }>(
      `select open_milling_run('JC-330', 100, 'run-330') as id;`,
    );
    // same key as the test above ⇒ same row
    expect(Number(a[0].id)).toBeGreaterThan(0);
    const n = await h.query<{ n: number }>(
      `select count(*)::int as n from milling_runs where idempotency_key like '%run-330';`,
    );
    expect(n[0].n).toBe(1);
  });

  it("appends a 'mill_run_opened' lot_event keyed on the parchment lot code", async () => {
    const r = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_event
         where stream_key = 'JC-330' and kind = 'mill_run_opened';`,
    );
    expect(r[0].n).toBeGreaterThanOrEqual(1);
  });

  it("opening a run NEVER claims green inventory — the prevent_oversell money seam is untouched", async () => {
    // Milling CONSUMES parchment; it does not commit green inventory. No lot_reservations
    // / lot_shipments row is created (no parallel counter, the shared oversell seam stands).
    const res = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_reservations where green_lot_code = 'JC-330';`,
    );
    const ship = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_shipments where green_lot_code = 'JC-330';`,
    );
    expect(res[0].n).toBe(0);
    expect(ship[0].n).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. APPEND-ONLY posture.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S7 append-only posture", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedReposoReadyLot(h, "JC-340");
    await h.query(`select record_mill_readiness('JC-340', 11.0, 0.55, now(), 'rdy-340');`);
  });
  afterAll(async () => h.close());

  it("rejects an UPDATE to mill_readiness (the spec gate is append-only)", async () => {
    await expect(
      h.query(`update mill_readiness set moisture_pct = 11.2 where parchment_lot_code = 'JC-340';`),
    ).rejects.toThrow(/append-only|not permitted/i);
  });

  it("rejects a DELETE from mill_readiness", async () => {
    await expect(
      h.query(`delete from mill_readiness where parchment_lot_code = 'JC-340';`),
    ).rejects.toThrow(/append-only|not permitted/i);
  });

  it("milling_runs grants NO update/delete to authenticated or anon", async () => {
    const r = await h.query<{ au: boolean; ad: boolean; anu: boolean }>(
      `select has_table_privilege('authenticated','milling_runs','update') as au,
              has_table_privilege('authenticated','milling_runs','delete') as ad,
              has_table_privilege('anon','milling_runs','update') as anu;`,
    );
    expect(r[0].au).toBe(false);
    expect(r[0].ad).toBe(false);
    expect(r[0].anu).toBe(false);
  });

  it("mill_machines is a read-only registry — no insert/update grant to authenticated", async () => {
    const r = await h.query<{ ins: boolean; upd: boolean }>(
      `select has_table_privilege('authenticated','mill_machines','insert') as ins,
              has_table_privilege('authenticated','mill_machines','update') as upd;`,
    );
    expect(r[0].ins).toBe(false);
    expect(r[0].upd).toBe(false);
  });

  it("seeds the 5-machine dry-mill chain registry", async () => {
    const r = await h.query<{ n: number }>(`select count(*)::int as n from mill_machines;`);
    expect(r[0].n).toBeGreaterThanOrEqual(5);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 4. AD-8 GRANTS — authenticated reads; anon reads/executes NOTHING.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S7 AD-8 grant posture", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
  });
  afterAll(async () => h.close());

  const TABLES = ["mill_machines", "milling_runs", "mill_readiness"];
  const VIEWS = ["v_milling_runs", "v_mill_readiness"];

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
      "record_mill_readiness(text, numeric, numeric, timestamptz, text)",
      "open_milling_run(text, numeric, text)",
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

  it("anon cannot read mill_readiness through the live role posture", async () => {
    await expect(
      asAnon(h, (hh) => hh.query(`select * from mill_readiness limit 1;`)),
    ).rejects.toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 5. TENANT ISOLATION — a mill_readiness row in tenant A is invisible to tenant B.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S7 tenant isolation — readiness does not leak cross-tenant", () => {
  const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(
      `insert into tenants (id, slug, name) values
         ('${A}','tenant-a','Estate A'),('${B}','tenant-b','Estate B');`,
    );
    // With >1 tenant, the default is NULL — stamp tenant_id LITERALLY on every owner insert.
    await h.query(
      `insert into lots (tenant_id, code, stage, variety, origin_kg, current_kg, minted_at) values
         ('${A}','JC-101','parchment','Geisha',100,100, now()),
         ('${B}','JC-201','parchment','Geisha',100,100, now());`,
    );
    await h.query(
      `insert into mill_readiness (tenant_id, parchment_lot_code, moisture_pct, water_activity_aw, reposo_ready)
         values ('${A}','JC-101', 11.0, 0.55, true),
                ('${B}','JC-201', 11.0, 0.55, true);`,
    );
  });
  afterAll(async () => h.close());

  it("as tenant A, only A's readiness row is visible", async () => {
    const rows = await asTenant(h, A, (hh) =>
      hh.query<{ tenant_id: string; lot: string }>(
        `select tenant_id, parchment_lot_code as lot from mill_readiness;`,
      ),
    );
    expect(rows.length).toBe(1);
    expect(rows[0].tenant_id).toBe(A);
    expect(rows[0].lot).toBe("JC-101");
  });

  it("as tenant B, A's readiness row is invisible (no cross-tenant read)", async () => {
    const aVisible = await asTenant(h, B, (hh) =>
      hh.query(`select 1 from mill_readiness where tenant_id = '${A}';`),
    );
    expect(aVisible).toHaveLength(0);
  });
});
