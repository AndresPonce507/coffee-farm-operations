// P2-S4 — Drying management + THE REPOSO GATE (migration 20260622094000).
//
// The load-bearing Phase-2 invariant proven here: a lot physically CANNOT advance
// `drying → milled` until moisture-stability (last N readings within 10.5–11.5%,
// trending flat) AND a minimum rest-days threshold are BOTH met. Enforced in two
// layers — a precondition INSIDE advance_processing_stage and a BEFORE-UPDATE
// trigger backstop on `lots` — so the gate cannot be bypassed by a direct UPDATE.
//
// This file ALSO re-proves the phase-1 advance guards (forward-only, no-mass-gain,
// idempotency, NULL-stage→'cherry') still hold after the RPC redefinition — the
// redefinition is purely additive, and these assertions are the regression net.
//
// Substrate: the PGlite migration-replay harness (replays the REAL migrations,
// including this slice's). No farm_id / multi-tenant scoping — the spine is
// authenticated-only RLS; this test mirrors that posture exactly.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAuthenticated, freshDb, type Harness } from "./pgliteHarness";

// ──────────────────────────────────────────────────────────────────────────
// Fixtures — a plot + worker so record_cherry_intake can mint a real cherry lot
// with a traceable origin (intake writes a harvests row → needs plot+worker).
// ──────────────────────────────────────────────────────────────────────────
const PLOT = `insert into plots (id, ord, name, block, variety, area_ha, altitude_masl, trees,
  shade_pct, established_year, status, last_inspected, expected_yield_kg, harvested_kg)
  values ('p-dry', 80, 'Drying Plot', 'Block D', 'Geisha', 1, 1650, 100, 50, 2015, 'healthy',
    '2026-06-01', 1000, 800);`;
const WORKER = `insert into workers (id, name, role, daily_rate_usd, attendance, started_year, phone, crew)
  values ('w-dry', 'D', 'Mill Operator', 22, 'present', 2015, '+507 0', 'Crew D');`;

// A process-global monotonic device_seq source so no two writes across this whole
// test file ever collide on the lot_event (device_id, device_seq) unique key
// (it spans the WHOLE table — fixed per-call seqs would clash across lots).
let SEQ = 1000;
const seq = () => SEQ++;

/** Mint a cherry lot, then drive it forward to 'drying' (the pre-mill resting state). */
async function seedDryingLot(h: Harness, idemBase: string): Promise<string> {
  const r = await h.query<{ code: string }>(
    `select record_cherry_intake('p-dry','w-dry',120,'Geisha'::coffee_variety, now() - interval '20 days','dev',${seq()},'${idemBase}-intake') as code;`,
  );
  const code = r[0].code;
  // cherry → fermentation → drying (forward, mass conserved/lost).
  await h.query(
    `select advance_processing_stage('${code}','fermentation',118, now() - interval '18 days','dev',${seq()},'${idemBase}-f');`,
  );
  await h.query(
    `select advance_processing_stage('${code}','drying',60, now() - interval '12 days','dev',${seq()},'${idemBase}-d');`,
  );
  // Record that drying completed long enough ago to clear min_reposo_days when moisture is OK.
  await h.query(
    `select assign_drying_station('${code}','st-bed-1', now() - interval '12 days');`,
  );
  return code;
}

// ══════════════════════════════════════════════════════════════════════════
// THE REPOSO GATE — the critical invariant
// ══════════════════════════════════════════════════════════════════════════
describe("P2-S4 reposo gate — drying → milled is blocked until rest-stable", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(PLOT);
    await h.db.exec(WORKER);
  });
  afterAll(async () => h.close());

  it("RPC RAISES when moisture is OUT of the stable band (too wet)", async () => {
    const lot = await seedDryingLot(h, "wet");
    // A single high reading: 13.8% — well above the 11.5% ceiling.
    await h.query(
      `select record_moisture_reading('${lot}', 13.8, now() - interval '2 days','dev',10,'wet-m1');`,
    );
    await expect(
      h.query(
        `select advance_processing_stage('${lot}','milled',55, now(),'dev',11,'wet-adv');`,
      ),
    ).rejects.toThrow(/reposo gate/i);
    // The blocked advance must roll back cleanly — NO stage_advance event written.
    const ev = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_event where idempotency_key = 'wet-adv';`,
    );
    expect(ev[0].n).toBe(0);
    // And the lot is still at 'drying' (the failed advance left no trace).
    const s = await h.query<{ stage: string }>(
      `select stage from lots where code = '${lot}';`,
    );
    expect(s[0].stage).toBe("drying");
  });

  it("RPC RAISES when rest-days threshold is NOT met (stable moisture, too fresh)", async () => {
    // Drying completed only 1 day ago (below the default min_reposo_days).
    const r = await h.query<{ code: string }>(
      `select record_cherry_intake('p-dry','w-dry',120,'Geisha'::coffee_variety, now() - interval '3 days','dev',20,'fresh-intake') as code;`,
    );
    const lot = r[0].code;
    await h.query(`select advance_processing_stage('${lot}','drying',60, now() - interval '1 day','dev',21,'fresh-d');`);
    await h.query(`select assign_drying_station('${lot}','st-bed-1', now() - interval '1 day');`);
    // Three readings ALL in band, flat — moisture is stable, but the rest is too fresh.
    await h.query(`select record_moisture_reading('${lot}', 11.2, now() - interval '20 hours','dev',22,'fresh-m1');`);
    await h.query(`select record_moisture_reading('${lot}', 11.1, now() - interval '10 hours','dev',23,'fresh-m2');`);
    await h.query(`select record_moisture_reading('${lot}', 11.0, now() - interval '1 hour','dev',24,'fresh-m3');`);
    await expect(
      h.query(`select advance_processing_stage('${lot}','milled',55, now(),'dev',25,'fresh-adv');`),
    ).rejects.toThrow(/reposo gate/i);
  });

  it("RPC SUCCEEDS when moisture is stable IN band AND rest-days are met", async () => {
    const lot = await seedDryingLot(h, "ok");
    // Three readings all inside [10.5, 11.5], flat — moisture-stable.
    await h.query(`select record_moisture_reading('${lot}', 11.3, now() - interval '5 days','dev',30,'ok-m1');`);
    await h.query(`select record_moisture_reading('${lot}', 11.1, now() - interval '3 days','dev',31,'ok-m2');`);
    await h.query(`select record_moisture_reading('${lot}', 11.0, now() - interval '1 day','dev',32,'ok-m3');`);
    const adv = await h.query<{ code: string }>(
      `select advance_processing_stage('${lot}','milled',55, now(),'dev',33,'ok-adv') as code;`,
    );
    expect(adv[0].code).toBe(lot);
    const s = await h.query<{ stage: string }>(`select stage from lots where code = '${lot}';`);
    expect(s[0].stage).toBe("milled");
    // The reposo status view reports ready.
    const st = await h.query<{ ready: boolean }>(
      `select ready from v_reposo_status where lot_code = '${lot}';`,
    );
    expect(st[0].ready).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// THE TRIGGER BACKSTOP — a direct UPDATE can't bypass the gate either
// ══════════════════════════════════════════════════════════════════════════
describe("P2-S4 reposo gate — BEFORE-UPDATE trigger backstop on lots", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(PLOT);
    await h.db.exec(WORKER);
  });
  afterAll(async () => h.close());

  it("a DIRECT update lots set stage='milled' on an unrested lot RAISES (bypass blocked)", async () => {
    const lot = await seedDryingLot(h, "trig-wet");
    await h.query(`select record_moisture_reading('${lot}', 14.0, now() - interval '1 day','dev',40,'trig-wet-m1');`);
    // Bypass the RPC entirely — the trigger must still fire.
    await expect(
      h.query(`update lots set stage = 'milled' where code = '${lot}';`),
    ).rejects.toThrow(/reposo gate/i);
    const s = await h.query<{ stage: string }>(`select stage from lots where code = '${lot}';`);
    expect(s[0].stage).toBe("drying");
  });

  it("a DIRECT update to 'milled' SUCCEEDS once the lot is rest-stable", async () => {
    const lot = await seedDryingLot(h, "trig-ok");
    await h.query(`select record_moisture_reading('${lot}', 11.2, now() - interval '4 days','dev',50,'trig-ok-m1');`);
    await h.query(`select record_moisture_reading('${lot}', 11.1, now() - interval '2 days','dev',51,'trig-ok-m2');`);
    await h.query(`select record_moisture_reading('${lot}', 11.0, now() - interval '6 hours','dev',52,'trig-ok-m3');`);
    await h.query(`update lots set stage = 'milled' where code = '${lot}';`);
    const s = await h.query<{ stage: string }>(`select stage from lots where code = '${lot}';`);
    expect(s[0].stage).toBe("milled");
  });

  it("the trigger does NOT block non-drying→milled transitions (cherry→fermentation is free)", async () => {
    const r = await h.query<{ code: string }>(
      `select record_cherry_intake('p-dry','w-dry',120,'Geisha'::coffee_variety, now(),'dev',60,'free-intake') as code;`,
    );
    const lot = r[0].code;
    // No moisture readings, no station — but this transition isn't gated.
    await h.query(`select advance_processing_stage('${lot}','fermentation',118, now(),'dev',61,'free-adv');`);
    const s = await h.query<{ stage: string }>(`select stage from lots where code = '${lot}';`);
    expect(s[0].stage).toBe("fermentation");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// NO REGRESSION — the phase-1 advance guards still hold after the redefinition
// ══════════════════════════════════════════════════════════════════════════
describe("P2-S4 — advance_processing_stage preserves all phase-1 guards", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(PLOT);
    await h.db.exec(WORKER);
  });
  afterAll(async () => h.close());

  it("forward-only still holds (a backward move from milled raises)", async () => {
    // Build a fully-rested, milled lot first.
    const lot = await seedDryingLot(h, "fwd");
    await h.query(`select record_moisture_reading('${lot}', 11.1, now() - interval '4 days','dev',70,'fwd-m1');`);
    await h.query(`select record_moisture_reading('${lot}', 11.0, now() - interval '2 days','dev',71,'fwd-m2');`);
    await h.query(`select record_moisture_reading('${lot}', 11.0, now() - interval '6 hours','dev',72,'fwd-m3');`);
    await h.query(`select advance_processing_stage('${lot}','milled',55, now(),'dev',73,'fwd-mill');`);
    await expect(
      h.query(`select advance_processing_stage('${lot}','drying',50, now(),'dev',74,'fwd-back');`),
    ).rejects.toThrow(/backward/i);
  });

  it("no-mass-gain still holds (current_kg cannot increase)", async () => {
    const r = await h.query<{ code: string }>(
      `select record_cherry_intake('p-dry','w-dry',100,'Geisha'::coffee_variety, now(),'dev',80,'mass-intake') as code;`,
    );
    const lot = r[0].code;
    await expect(
      h.query(`select advance_processing_stage('${lot}','fermentation',150, now(),'dev',81,'mass-gain');`),
    ).rejects.toThrow(/cannot increase/i);
  });

  it("idempotency short-circuit still holds (a replay is a no-op returning the code)", async () => {
    const r = await h.query<{ code: string }>(
      `select record_cherry_intake('p-dry','w-dry',100,'Geisha'::coffee_variety, now(),'dev',90,'idem-intake') as code;`,
    );
    const lot = r[0].code;
    const a = await h.query<{ code: string }>(
      `select advance_processing_stage('${lot}','fermentation',95, now(),'dev',91,'idem-adv') as code;`,
    );
    const b = await h.query<{ code: string }>(
      `select advance_processing_stage('${lot}','fermentation',95, now(),'dev',92,'idem-adv') as code;`,
    );
    expect(a[0].code).toBe(lot);
    expect(b[0].code).toBe(lot);
    const n = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_event where kind = 'stage_advance' and (payload->>'lot_code') = '${lot}';`,
    );
    expect(n[0].n).toBe(1); // exactly one stage_advance event despite two calls
  });

  it("NULL-stage lot is treated as 'cherry' (a backward move from milled still raises)", async () => {
    // A bare lot with NULL stage advanced straight to milled (no gate path — it
    // never passed through 'drying', so the reposo gate's drying→milled boundary
    // doesn't apply; the NULL-stage→cherry guard does).
    await h.db.exec(`insert into lots (code) values ('JC-960');`); // stage NULL
    await h.query(`select advance_processing_stage('JC-960','milled',null, now(),'dev',1,'null-mill');`);
    await expect(
      h.query(`select advance_processing_stage('JC-960','drying',null, now(),'dev',2,'null-back');`),
    ).rejects.toThrow(/backward/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// DRYING STATIONS — capacity never oversubscribed (fail-closed)
// ══════════════════════════════════════════════════════════════════════════
describe("P2-S4 — drying stations + capacity guard", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(PLOT);
    await h.db.exec(WORKER);
  });
  afterAll(async () => h.close());

  it("seeds the raised-bed + patio stations with capacities", async () => {
    const rows = await h.query<{ id: string; capacity_kg: number }>(
      `select id, capacity_kg::float8 as capacity_kg from drying_stations order by id;`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("station_occupancy reports committed kg vs capacity", async () => {
    const lot = await seedDryingLot(h, "occ");
    const rows = await h.query<{ station_id: string; committed_kg: number; capacity_kg: number }>(
      `select station_id, committed_kg::float8 as committed_kg, capacity_kg::float8 as capacity_kg
         from station_occupancy where station_id = 'st-bed-1';`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0].committed_kg).toBeGreaterThan(0);
    expect(rows[0].committed_kg).toBeLessThanOrEqual(rows[0].capacity_kg);
  });

  it("overcapacity is fail-closed (committing past a station's capacity raises)", async () => {
    // st-small has a tiny capacity; commit a lot bigger than it.
    const r = await h.query<{ code: string }>(
      `select record_cherry_intake('p-dry','w-dry',5000,'Geisha'::coffee_variety, now(),'dev',100,'big-intake') as code;`,
    );
    const big = r[0].code;
    await h.query(`select advance_processing_stage('${big}','fermentation',5000, now(),'dev',101,'big-f');`);
    await h.query(`select advance_processing_stage('${big}','drying',5000, now(),'dev',102,'big-d');`);
    await expect(
      h.query(`select assign_drying_station('${big}','st-small', now());`),
    ).rejects.toThrow(/capacity|overcapac/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// APPEND-ONLY + GRANTS — moisture readings are immutable; posture mirrors phase-1
// ══════════════════════════════════════════════════════════════════════════
describe("P2-S4 — moisture readings append-only + RLS/grant posture", () => {
  let h: Harness;
  let lot: string;
  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(PLOT);
    await h.db.exec(WORKER);
    lot = await seedDryingLot(h, "ap");
    await h.query(`select record_moisture_reading('${lot}', 11.2, now(),'dev',110,'ap-m1');`);
  });
  afterAll(async () => h.close());

  it("a moisture_readings row cannot be UPDATEd (append-only block trigger)", async () => {
    await expect(
      h.query(`update moisture_readings set moisture_pct = 99 where lot_code = '${lot}';`),
    ).rejects.toThrow(/append-only|immutable/i);
  });

  it("a moisture_readings row cannot be DELETEd", async () => {
    await expect(
      h.query(`delete from moisture_readings where lot_code = '${lot}';`),
    ).rejects.toThrow(/append-only|immutable/i);
  });

  it("authenticated can read drying_stations / moisture_readings / v_reposo_status", async () => {
    const a = await asAuthenticated(h, async (hh) =>
      hh.query<{ n: number }>(`select count(*)::int as n from drying_stations;`),
    );
    expect(a[0].n).toBeGreaterThan(0);
    const b = await asAuthenticated(h, async (hh) =>
      hh.query<{ n: number }>(`select count(*)::int as n from moisture_readings;`),
    );
    expect(b[0].n).toBeGreaterThanOrEqual(1);
    const c = await asAuthenticated(h, async (hh) =>
      hh.query<{ n: number }>(`select count(*)::int as n from v_reposo_status;`),
    );
    expect(c[0].n).toBeGreaterThanOrEqual(0);
  });
});
