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

/**
 * Mint a cherry lot, drive it forward to 'drying', commit it to a station, then
 * mark it as having FINISHED drying `restDays` ago — i.e. it has been RESTING as
 * parchment for that long. The rest clock is anchored to the drying→parchment
 * stage_advance event's SERVER `recorded_at` (drying COMPLETE, not drying START,
 * and immune to a back-dated client occurred_at), so the helper seeds that event
 * directly with a back-dated `recorded_at` to simulate elapsed reposo without
 * waiting real wall-time. The lot is left at stage 'parchment' (pergamino rest).
 *
 * Pass restDays=0 (or omit + advanceToParchment=false) to keep it at 'drying'
 * with NO rest anchor — used by the "too fresh" / bypass cases.
 */
async function seedDryingLot(
  h: Harness,
  idemBase: string,
  opts: { restDays?: number; toParchment?: boolean } = {},
): Promise<string> {
  const restDays = opts.restDays ?? 12;
  const toParchment = opts.toParchment ?? true;
  const r = await h.query<{ code: string }>(
    `select record_cherry_intake('p-dry','w-dry',120,'Geisha'::coffee_variety, now() - interval '25 days','dev',${seq()},'${idemBase}-intake') as code;`,
  );
  const code = r[0].code;
  // cherry → fermentation → drying (forward, mass conserved/lost).
  await h.query(
    `select advance_processing_stage('${code}','fermentation',118, now() - interval '23 days','dev',${seq()},'${idemBase}-f');`,
  );
  await h.query(
    `select advance_processing_stage('${code}','drying',60, now() - interval '${restDays + 6} days','dev',${seq()},'${idemBase}-d');`,
  );
  // Commit to a station (capacity tracking; assigned_at no longer feeds the gate).
  await h.query(
    `select assign_drying_station('${code}','st-bed-1', now() - interval '${restDays + 6} days');`,
  );
  if (toParchment) {
    // Mark drying COMPLETE `restDays` ago: seed the drying→parchment stage_advance
    // event directly with a back-dated SERVER recorded_at (the rest anchor), then
    // move the lot into 'parchment'. Direct insert is needed because the RPC would
    // stamp recorded_at=now(); the append-only block trigger only guards UPDATE/DELETE.
    await h.query(
      `insert into lot_event (idempotency_key, stream_key, kind, payload, occurred_at, recorded_at, device_id, device_seq)
       values ('${idemBase}-parch', '${code}', 'stage_advance',
               jsonb_build_object('lot_code','${code}','to_stage','parchment','current_kg',55),
               now() - interval '${restDays} days', now() - interval '${restDays} days', 'dev', ${seq()});`,
    );
    await h.query(`update lots set stage = 'parchment' where code = '${code}';`);
  }
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
    // And the lot is still resting at 'parchment' (the failed advance left no trace).
    const s = await h.query<{ stage: string }>(
      `select stage from lots where code = '${lot}';`,
    );
    expect(s[0].stage).toBe("parchment");
  });

  it("RPC RAISES when rest-days threshold is NOT met (stable moisture, too fresh)", async () => {
    // Drying completed only 1 day ago (below the default min_reposo_days).
    const lot = await seedDryingLot(h, "fresh", { restDays: 1 });
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
    expect(s[0].stage).toBe("parchment");
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

  it("NULL-stage lot is treated as 'cherry' (a backward move from a forward stage still raises)", async () => {
    // A bare lot with NULL stage is treated as 'cherry'. Advancing to a sub-mill
    // stage is ungated (no milling boundary crossed); a backward move still raises.
    await h.db.exec(`insert into lots (code) values ('JC-960');`); // stage NULL
    await h.query(`select advance_processing_stage('JC-960','fermentation',null, now(),'dev',1,'null-ferm');`);
    await expect(
      h.query(`select advance_processing_stage('JC-960','cherry',null, now(),'dev',2,'null-back');`),
    ).rejects.toThrow(/backward/i);
  });

  it("FAIL-CLOSED: a seed-shaped NULL-stage lot WITH a 'drying' processing_batch is gated to milled (#164)", async () => {
    // Mirrors supabase/seed.sql: lots inserted with code only (stage NULL), the
    // physical drying state living in processing_batches.stage. The gate must NOT
    // silently disable because lots.stage is NULL — the evidence-based boundary
    // predicate catches the physical drying batch and FAILS CLOSED. Pre-fix this
    // jumped to 'milled' freely (fail-open, the exact lots the gate exists to protect).
    await h.db.exec(`insert into lots (code) values ('JC-962');`); // stage NULL
    await h.db.exec(
      `insert into processing_batches (id, lot_code, variety, method, stage, started_date, cherries_kg, current_kg, moisture_pct, patio, progress_pct)
       values ('pb-962', 'JC-962', 'Geisha', 'Washed', 'drying', '2026-06-11', 120, 60, 18.5, 'Patio Norte', 60);`,
    );
    await expect(
      h.query(`select advance_processing_stage('JC-962','milled',55, now(),'dev',4,'null-mill-962');`),
    ).rejects.toThrow(/reposo gate/i);
    // The trigger backstop fails closed on a direct UPDATE too.
    await expect(
      h.query(`update lots set stage = 'milled' where code = 'JC-962';`),
    ).rejects.toThrow(/reposo gate/i);
  });

  it("FAIL-CLOSED: a NULL-stage lot with a moisture reading (drying evidence) is gated to green (#164)", async () => {
    // Even without a processing_batch, a recorded moisture reading is drying evidence:
    // the lot was on the bed. A jump to 'green' (past milled) must fail closed.
    await h.db.exec(`insert into lots (code) values ('JC-963');`); // stage NULL
    await h.query(`select record_moisture_reading('JC-963', 18.0, now(),'dev',${seq()},'null-ev-963');`);
    await expect(
      h.query(`select advance_processing_stage('JC-963','green',null, now(),'dev',${seq()},'null-green-963');`),
    ).rejects.toThrow(/reposo gate/i);
  });

  it("a never-dried synthetic lot (no drying evidence) reaches milled ungated (green-lot fixture path)", async () => {
    // A lot minted as cherry and jumped straight to milled with NO drying assignment,
    // moisture reading, or drying processing_batch never dried — reposo is N/A, so the
    // gate correctly does not fire (this is the green-lot materialization fixture path).
    await h.db.exec(`insert into lots (code, stage, origin_kg, current_kg) values ('JC-964','cherry',100,100);`);
    await h.query(`select advance_processing_stage('JC-964','milled',90, now(),'dev',${seq()},'synth-mill-964');`);
    const s = await h.query<{ stage: string }>(`select stage from lots where code = 'JC-964';`);
    expect(s[0].stage).toBe("milled");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// THE STABILITY CONTRACT — the predicate halves the gate is BUILT from must each
// be pinned in isolation, or a "simplification" could silently gut the gate while
// the suite stays green. Two predicates define moisture_stable (migration sql:241):
//   (a) cnt           >= reposo_stable_window  — need ≥ N readings AT ALL
//   (b) in_band_cnt   >= reposo_stable_window  — and ≥ N of the recent ones in-band
// plus the band itself is the inclusive `between` at sql:230. The existing
// success/blocking tests all use 3 in-band readings vs out-of-band/too-fresh, so
// NONE of them distinguish these clauses. These tests do. (Findings #94/#98/#93.)
// ══════════════════════════════════════════════════════════════════════════
describe("P2-S4 reposo gate — the moisture-stability contract, clause by clause", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(PLOT);
    await h.db.exec(WORKER);
  });
  afterAll(async () => h.close());

  // ── #94/#98 — the count floor (one perfect reading is NOT enough rest evidence) ──
  it("ONE in-band reading is NOT enough rest evidence (reposo_stable_window count floor)", async () => {
    const lot = await seedDryingLot(h, "single"); // already rest-met (12d ≥ 5)
    // Exactly ONE perfectly in-band reading.
    await h.query(
      `select record_moisture_reading('${lot}', 11.0, now() - interval '1 day','dev',${seq()},'single-m1');`,
    );
    // Rested, but NOT moisture-stable (default window=2 unmet by a single reading)
    // → fail-closed: not ready. Asserting rest_met isolates the count floor as the
    // sole reason it's blocked (rest is NOT the cause).
    const st = await h.query<{
      ready: boolean;
      moisture_stable: boolean;
      reading_count: number;
      rest_met: boolean;
    }>(
      `select ready, moisture_stable, reading_count, rest_met from v_reposo_status where lot_code = '${lot}';`,
    );
    expect(st[0].rest_met).toBe(true);
    expect(st[0].moisture_stable).toBe(false);
    expect(st[0].reading_count).toBe(1);
    expect(st[0].ready).toBe(false);
    // The gate blocks parchment→milled on a single lucky in-band reading.
    await expect(
      h.query(`select advance_processing_stage('${lot}','milled',55, now(),'dev',${seq()},'single-adv');`),
    ).rejects.toThrow(/reposo gate/i);
    // Add a SECOND in-band reading → window satisfied → ready, advance succeeds.
    // This pins the >=N boundary from BOTH sides (1 blocks, 2 clears).
    await h.query(
      `select record_moisture_reading('${lot}', 11.0, now() - interval '12 hours','dev',${seq()},'single-m2');`,
    );
    const ok = await h.query<{ code: string }>(
      `select advance_processing_stage('${lot}','milled',55, now(),'dev',${seq()},'single-adv2') as code;`,
    );
    expect(ok[0].code).toBe(lot);
  });

  // ── #93 — the inclusive band boundaries (10.5 / 11.5), the off-by-one surface ──
  it("upper-band boundary 11.5 is IN band (inclusive `between`) — ready", async () => {
    const lot = await seedDryingLot(h, "edge-hi-ok"); // rested 12d
    // Two readings EXACTLY at the 11.5 ceiling — window=2 satisfied, both in-band.
    await h.query(
      `select record_moisture_reading('${lot}', 11.5, now() - interval '3 days','dev',${seq()},'edge-hi-ok-m1');`,
    );
    await h.query(
      `select record_moisture_reading('${lot}', 11.5, now() - interval '1 day','dev',${seq()},'edge-hi-ok-m2');`,
    );
    const st = await h.query<{ ready: boolean }>(
      `select ready from v_reposo_status where lot_code = '${lot}';`,
    );
    expect(st[0].ready).toBe(true);
  });

  it("just over the ceiling (11.51) is OUT of band — blocked", async () => {
    const lot = await seedDryingLot(h, "edge-hi-bad");
    await h.query(
      `select record_moisture_reading('${lot}', 11.51, now() - interval '3 days','dev',${seq()},'edge-hi-bad-m1');`,
    );
    await h.query(
      `select record_moisture_reading('${lot}', 11.51, now() - interval '1 day','dev',${seq()},'edge-hi-bad-m2');`,
    );
    await expect(
      h.query(`select advance_processing_stage('${lot}','milled',55, now(),'dev',${seq()},'edge-hi-bad-adv');`),
    ).rejects.toThrow(/reposo gate/i);
  });

  it("lower-band boundary 10.5 is IN band (inclusive `between`) — ready", async () => {
    const lot = await seedDryingLot(h, "edge-lo-ok");
    await h.query(
      `select record_moisture_reading('${lot}', 10.5, now() - interval '3 days','dev',${seq()},'edge-lo-ok-m1');`,
    );
    await h.query(
      `select record_moisture_reading('${lot}', 10.5, now() - interval '1 day','dev',${seq()},'edge-lo-ok-m2');`,
    );
    const st = await h.query<{ ready: boolean }>(
      `select ready from v_reposo_status where lot_code = '${lot}';`,
    );
    expect(st[0].ready).toBe(true);
  });

  it("just under the floor (10.49) is OUT of band — blocked", async () => {
    const lot = await seedDryingLot(h, "edge-lo-bad");
    await h.query(
      `select record_moisture_reading('${lot}', 10.49, now() - interval '3 days','dev',${seq()},'edge-lo-bad-m1');`,
    );
    await h.query(
      `select record_moisture_reading('${lot}', 10.49, now() - interval '1 day','dev',${seq()},'edge-lo-bad-m2');`,
    );
    await expect(
      h.query(`select advance_processing_stage('${lot}','milled',55, now(),'dev',${seq()},'edge-lo-bad-adv');`),
    ).rejects.toThrow(/reposo gate/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// DEFENSE-IN-DEPTH, PROVEN — the gate's "two independent layers" claim (header
// lines 6-13) is only real if EACH layer blocks ALONE. The direct-UPDATE test
// above (line ~166) already isolates layer 2 (the trigger) by bypassing the RPC.
// This pins layer 1 (the in-RPC precondition) by DISABLING the trigger and proving
// the RPC still fail-closes — so dropping either layer turns the suite red. (#91.)
// ══════════════════════════════════════════════════════════════════════════
describe("P2-S4 reposo gate — layer 1 (in-RPC precondition) blocks in isolation", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(PLOT);
    await h.db.exec(WORKER);
  });
  afterAll(async () => h.close());

  it("with the BEFORE-UPDATE trigger DISABLED, the RPC still blocks an unrested advance", async () => {
    const lot = await seedDryingLot(h, "l1");
    // One out-of-band reading — clearly not rest-stable.
    await h.query(
      `select record_moisture_reading('${lot}', 13.8, now() - interval '2 days','dev',${seq()},'l1-m1');`,
    );
    // Remove layer 2 so ONLY layer 1 (the precondition inside advance_processing_stage)
    // can stop the advance. Re-enable in finally so later tests are unaffected.
    await h.query(`alter table lots disable trigger lots_enforce_reposo_gate;`);
    try {
      await expect(
        h.query(`select advance_processing_stage('${lot}','milled',55, now(),'dev',${seq()},'l1-adv');`),
      ).rejects.toThrow(/reposo gate/i);
      const s = await h.query<{ stage: string }>(`select stage from lots where code = '${lot}';`);
      expect(s[0].stage).toBe("parchment");
    } finally {
      await h.query(`alter table lots enable trigger lots_enforce_reposo_gate;`);
    }
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
// CAPACITY GUARD — the UPDATE branch (re-open / correct-kg) is latent today (no
// RPC drives it) but the trigger fires `before insert OR UPDATE` and carries an
// UPDATE-specific self-exclusion clause `not (tg_op='UPDATE' and id=new.id)`
// (migration sql:112) — a classic off-by-self surface. The committed capacity test
// only exercises INSERT. These pin the UPDATE branch for the future move-back
// feature: a fresh DB per case so the shared-station state never leaks. (#99.)
// ══════════════════════════════════════════════════════════════════════════
describe("P2-S4 — capacity guard, the UPDATE branch (self-exclusion + re-open)", () => {
  // st-small capacity = 80 kg. These drive drying_assignments directly because no
  // RPC currently mutates committed_kg on an open row or re-opens a released one.

  it("self-exclusion: raising an OPEN row's own committed_kg within capacity SUCCEEDS (70→75 on a cap-80 station)", async () => {
    // If a degrade dropped `not (tg_op='UPDATE' and id=new.id)`, the row's own prior
    // 70 would be double-counted (70+75 > 80) and this would FALSELY raise.
    const h = await freshDb();
    try {
      await h.db.exec(PLOT);
      await h.db.exec(WORKER);
      await h.db.exec(
        `insert into lots (code, stage, origin_kg, current_kg) values ('JC-801','drying',75,75);`,
      );
      const ins = await h.query<{ id: number }>(
        `insert into drying_assignments (lot_code, station_id, committed_kg, assigned_at)
           values ('JC-801','st-small',70, now()) returning id;`,
      );
      const id = ins[0].id;
      // 70 → 75 still fits cap-80 ONLY because the row's own 70 is excluded from the sum.
      await h.query(`update drying_assignments set committed_kg = 75 where id = ${id};`);
      const row = await h.query<{ committed_kg: number }>(
        `select committed_kg::float8 as committed_kg from drying_assignments where id = ${id};`,
      );
      expect(row[0].committed_kg).toBe(75);
    } finally {
      await h.close();
    }
  });

  it("over-cap UPDATE: raising an OPEN row's committed_kg past capacity RAISES (70→85 on a cap-80 station)", async () => {
    const h = await freshDb();
    try {
      await h.db.exec(PLOT);
      await h.db.exec(WORKER);
      await h.db.exec(
        `insert into lots (code, stage, origin_kg, current_kg) values ('JC-802','drying',85,85);`,
      );
      const ins = await h.query<{ id: number }>(
        `insert into drying_assignments (lot_code, station_id, committed_kg, assigned_at)
           values ('JC-802','st-small',70, now()) returning id;`,
      );
      await expect(
        h.query(`update drying_assignments set committed_kg = 85 where id = ${ins[0].id};`),
      ).rejects.toThrow(/capacity|overcapac/i);
    } finally {
      await h.close();
    }
  });

  it("re-open: flipping a RELEASED row back to open beyond capacity RAISES (two 70kg rows on a cap-80 station)", async () => {
    const h = await freshDb();
    try {
      await h.db.exec(PLOT);
      await h.db.exec(WORKER);
      await h.db.exec(
        `insert into lots (code, stage, origin_kg, current_kg) values ('JC-803','drying',70,70),('JC-804','drying',70,70);`,
      );
      // One OPEN 70kg row consumes 70/80.
      await h.query(
        `insert into drying_assignments (lot_code, station_id, committed_kg, assigned_at)
           values ('JC-803','st-small',70, now());`,
      );
      // A second 70kg row inserted RELEASED — released rows don't consume capacity, so
      // it inserts fine (proves the early-return at sql:99 for released_at not null).
      const rel = await h.query<{ id: number }>(
        `insert into drying_assignments (lot_code, station_id, committed_kg, assigned_at, released_at)
           values ('JC-804','st-small',70, now(), now()) returning id;`,
      );
      // Re-opening it (released_at → null) would make 70+70=140 > 80 → MUST raise via the UPDATE branch.
      await expect(
        h.query(`update drying_assignments set released_at = null where id = ${rel[0].id};`),
      ).rejects.toThrow(/capacity|overcapac/i);
    } finally {
      await h.close();
    }
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

// Mint a lot and drive it to 'drying' WET and UN-RESTED (no parchment anchor, one
// out-of-band reading) — the substrate for the multi-hop / skip bypass cases.
async function seedWetDryingLot(h: Harness, idemBase: string, moisture = 20.0): Promise<string> {
  const code = await seedDryingLot(h, idemBase, { toParchment: false });
  await h.query(
    `select record_moisture_reading('${code}', ${moisture}, now() - interval '1 day','dev',${seq()},'${idemBase}-wetm');`,
  );
  return code;
}

// ══════════════════════════════════════════════════════════════════════════
// THE REPOSO GATE — boundary-crossing: NO route into milled/green dodges it
// (#118/#129/#163/#169/#171 — the parchment two-step; #104/#119 — drying→green)
// ══════════════════════════════════════════════════════════════════════════
describe("P2-S4 reposo gate — every route into the mill boundary is gated", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(PLOT);
    await h.db.exec(WORKER);
  });
  afterAll(async () => h.close());

  it("MULTI-HOP BYPASS: drying→parchment then parchment→milled RAISES on the 2nd hop (#129/#163/#171)", async () => {
    const lot = await seedWetDryingLot(h, "byp-parch");
    // hop 1: drying→parchment is a legitimate ungated move (resting begins).
    await h.query(`select advance_processing_stage('${lot}','parchment',55, now(),'dev',${seq()},'byp-parch-1');`);
    const mid = await h.query<{ stage: string }>(`select stage from lots where code='${lot}';`);
    expect(mid[0].stage).toBe("parchment");
    // hop 2: parchment→milled crosses the milling boundary on a wet/un-rested lot → MUST raise.
    await expect(
      h.query(`select advance_processing_stage('${lot}','milled',50, now(),'dev',${seq()},'byp-parch-2');`),
    ).rejects.toThrow(/reposo gate/i);
    const after = await h.query<{ stage: string }>(`select stage from lots where code='${lot}';`);
    expect(after[0].stage).toBe("parchment");
  });

  it("MULTI-HOP BYPASS via direct UPDATEs is blocked by the trigger backstop (#118/#163)", async () => {
    const lot = await seedWetDryingLot(h, "byp-trig");
    await h.query(`update lots set stage = 'parchment' where code = '${lot}';`); // ungated (below boundary)
    await expect(
      h.query(`update lots set stage = 'milled' where code = '${lot}';`),
    ).rejects.toThrow(/reposo gate/i);
    const s = await h.query<{ stage: string }>(`select stage from lots where code='${lot}';`);
    expect(s[0].stage).toBe("parchment");
  });

  it("SKIP BYPASS: drying→green directly (milled never visited) RAISES (#104/#119)", async () => {
    const lot = await seedWetDryingLot(h, "byp-green");
    await expect(
      h.query(`select advance_processing_stage('${lot}','green',50, now(),'dev',${seq()},'byp-green-adv');`),
    ).rejects.toThrow(/reposo gate/i);
    const s = await h.query<{ stage: string }>(`select stage from lots where code='${lot}';`);
    expect(s[0].stage).toBe("drying");
  });

  it("SKIP BYPASS: direct UPDATE drying→green RAISES via the trigger backstop (#119)", async () => {
    const lot = await seedWetDryingLot(h, "byp-green-trig");
    await expect(
      h.query(`update lots set stage = 'green' where code = '${lot}';`),
    ).rejects.toThrow(/reposo gate/i);
  });

  it("LEGIT: a rest-stable lot still completes drying→parchment→milled→green (no false block)", async () => {
    const lot = await seedDryingLot(h, "byp-ok"); // rested 12d at parchment
    await h.query(`select record_moisture_reading('${lot}', 11.2, now() - interval '5 days','dev',${seq()},'byp-ok-m1');`);
    await h.query(`select record_moisture_reading('${lot}', 11.0, now() - interval '1 day','dev',${seq()},'byp-ok-m2');`);
    // parchment→milled (crosses boundary; rested+stable → allowed).
    await h.query(`select advance_processing_stage('${lot}','milled',50, now(),'dev',${seq()},'byp-ok-mill');`);
    // milled→green is PAST the boundary and must NOT be re-gated.
    await h.query(`select advance_processing_stage('${lot}','green',48, now(),'dev',${seq()},'byp-ok-green');`);
    const s = await h.query<{ stage: string }>(`select stage from lots where code='${lot}';`);
    expect(s[0].stage).toBe("green");
  });

  it("REGRESSION-NET: sub-milling moves (cherry→fermentation, drying→parchment) stay free", async () => {
    const lot = await seedWetDryingLot(h, "byp-free");
    // drying→parchment is ungated even on a wet lot (rest happens IN parchment).
    await h.query(`select advance_processing_stage('${lot}','parchment',55, now(),'dev',${seq()},'byp-free-p');`);
    const s = await h.query<{ stage: string }>(`select stage from lots where code='${lot}';`);
    expect(s[0].stage).toBe("parchment");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// MOISTURE EVIDENCE INTEGRITY — out-of-order / future-dated readings can't forge
// a "rest-stable" verdict (#92/#97 backdated window; #120 future-dated)
// ══════════════════════════════════════════════════════════════════════════
describe("P2-S4 reposo gate — moisture evidence cannot be timestamp-gamed", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(PLOT);
    await h.db.exec(WORKER);
  });
  afterAll(async () => h.close());

  it("BACKDATED WET READING: a 13% re-wet reading recorded LAST still blocks the gate (#92/#97)", async () => {
    const lot = await seedDryingLot(h, "ood"); // rested 12d at parchment
    // Two in-band afternoon readings...
    await h.query(`select record_moisture_reading('${lot}', 11.0, now() - interval '2 days','dev',${seq()},'ood-m1');`);
    await h.query(`select record_moisture_reading('${lot}', 11.0, now() - interval '1 day','dev',${seq()},'ood-m2');`);
    // ...then a panic re-wet 13% reading whose FIELD occurred_at is backdated 10 days
    // (the offline-replay / wrong-clock case) but which is physically the NEWEST (recorded last).
    await h.query(`select record_moisture_reading('${lot}', 13.0, now() - interval '10 days','dev',${seq()},'ood-m3');`);
    const st = await h.query<{ ready: boolean }>(`select ready from v_reposo_status where lot_code='${lot}';`);
    expect(st[0].ready).toBe(false);
    await expect(
      h.query(`select advance_processing_stage('${lot}','milled',50, now(),'dev',${seq()},'ood-adv');`),
    ).rejects.toThrow(/reposo gate/i);
  });

  it("CONTROL: the same 13% reading recorded NEWEST also blocks (both orderings closed) (#92/#97)", async () => {
    const lot = await seedDryingLot(h, "ood2");
    await h.query(`select record_moisture_reading('${lot}', 11.0, now() - interval '2 days','dev',${seq()},'ood2-m1');`);
    await h.query(`select record_moisture_reading('${lot}', 13.0, now() - interval '1 hour','dev',${seq()},'ood2-m2');`);
    const st = await h.query<{ ready: boolean }>(`select ready from v_reposo_status where lot_code='${lot}';`);
    expect(st[0].ready).toBe(false);
  });

  it("FUTURE-DATED READING is rejected at the write door (#120)", async () => {
    const lot = await seedDryingLot(h, "fut");
    await expect(
      h.query(`select record_moisture_reading('${lot}', 11.0, now() + interval '2 days','dev',${seq()},'fut-m1');`),
    ).rejects.toThrow(/future/i);
  });

  it("FUTURE-DATED in-band readings cannot mask a current wet reading (#120)", async () => {
    const lot = await seedDryingLot(h, "fut2");
    // The honest current reading is 19% (wet). Two future-dated 11% readings are rejected
    // outright, so they cannot outrank it in the window.
    await h.query(`select record_moisture_reading('${lot}', 19.0, now(),'dev',${seq()},'fut2-now');`);
    await expect(
      h.query(`select record_moisture_reading('${lot}', 11.0, now() + interval '2 days','dev',${seq()},'fut2-a');`),
    ).rejects.toThrow(/future/i);
    const st = await h.query<{ ready: boolean }>(`select ready from v_reposo_status where lot_code='${lot}';`);
    expect(st[0].ready).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// REST CLOCK — anchored at drying COMPLETE on the SERVER clock, not drying START
// and not a client-supplied timestamp (#105 START-vs-COMPLETE; #170/#172 back-date)
// ══════════════════════════════════════════════════════════════════════════
describe("P2-S4 reposo gate — rest clock measures real post-drying reposo", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(PLOT);
    await h.db.exec(WORKER);
  });
  afterAll(async () => h.close());

  it("a lot that JUST finished drying has ~0 rest days and is NOT rest-met (#105)", async () => {
    // Drive through drying→parchment via the RPC (recorded_at = now()): the lot has
    // been on the bed 18 days but has only NOW finished drying — zero reposo.
    const r = await h.query<{ code: string }>(
      `select record_cherry_intake('p-dry','w-dry',120,'Geisha'::coffee_variety, now() - interval '20 days','dev',${seq()},'rc-intake') as code;`,
    );
    const lot = r[0].code;
    await h.query(`select advance_processing_stage('${lot}','drying',60, now() - interval '18 days','dev',${seq()},'rc-d');`);
    await h.query(`select assign_drying_station('${lot}','st-bed-1', now() - interval '18 days');`);
    // moisture in-band, but it only just transitioned out of drying.
    await h.query(`select record_moisture_reading('${lot}', 11.0, now() - interval '2 hours','dev',${seq()},'rc-m1');`);
    await h.query(`select record_moisture_reading('${lot}', 11.0, now() - interval '1 hour','dev',${seq()},'rc-m2');`);
    await h.query(`select advance_processing_stage('${lot}','parchment',55, now(),'dev',${seq()},'rc-p');`);
    const st = await h.query<{ rest_days_elapsed: number; rest_met: boolean; ready: boolean }>(
      `select rest_days_elapsed::float8 as rest_days_elapsed, rest_met, ready from v_reposo_status where lot_code='${lot}';`,
    );
    expect(st[0].rest_days_elapsed).toBeLessThan(1); // ~0, NOT ~18 (drying duration)
    expect(st[0].rest_met).toBe(false);
    expect(st[0].ready).toBe(false);
    await expect(
      h.query(`select advance_processing_stage('${lot}','milled',50, now(),'dev',${seq()},'rc-mill');`),
    ).rejects.toThrow(/reposo gate/i);
  });

  it("BACK-DATED ASSIGNMENT cannot satisfy min-rest-days — rest clock ignores assigned_at (#170/#172)", async () => {
    // Lot dried & finished TODAY, but the assignment is back-dated 60 days.
    const r = await h.query<{ code: string }>(
      `select record_cherry_intake('p-dry','w-dry',120,'Geisha'::coffee_variety, now(),'dev',${seq()},'bd-intake') as code;`,
    );
    const lot = r[0].code;
    await h.query(`select advance_processing_stage('${lot}','drying',60, now(),'dev',${seq()},'bd-d');`);
    await h.query(`select assign_drying_station('${lot}','st-bed-1', now() - interval '60 days');`); // back-dated
    await h.query(`select record_moisture_reading('${lot}', 11.0, now() - interval '2 hours','dev',${seq()},'bd-m1');`);
    await h.query(`select record_moisture_reading('${lot}', 11.0, now() - interval '1 hour','dev',${seq()},'bd-m2');`);
    await h.query(`select advance_processing_stage('${lot}','parchment',55, now(),'dev',${seq()},'bd-p');`);
    const st = await h.query<{ rest_met: boolean; ready: boolean }>(
      `select rest_met, ready from v_reposo_status where lot_code='${lot}';`,
    );
    expect(st[0].rest_met).toBe(false); // back-dated assigned_at must NOT count as rest
    expect(st[0].ready).toBe(false);
    await expect(
      h.query(`select advance_processing_stage('${lot}','milled',50, now(),'dev',${seq()},'bd-mill');`),
    ).rejects.toThrow(/reposo gate/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// LEDGER + RPC HYGIENE — moisture evidence on the lot_event chain (#130);
// unknown-lot error mapping (#133); NULL idempotency key (#132)
// ══════════════════════════════════════════════════════════════════════════
describe("P2-S4 — moisture RPC ledger + validation hygiene", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(PLOT);
    await h.db.exec(WORKER);
  });
  afterAll(async () => h.close());

  it("record_moisture_reading appends exactly one 'moisture_reading' lot_event (#130)", async () => {
    const lot = await seedDryingLot(h, "ev", { toParchment: false });
    await h.query(`select record_moisture_reading('${lot}', 11.2, now(),'dev',${seq()},'ev-m1');`);
    const ev = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_event where kind='moisture_reading' and stream_key='${lot}';`,
    );
    expect(ev[0].n).toBe(1);
    // a replay on the same idempotency key adds NO further event.
    await h.query(`select record_moisture_reading('${lot}', 11.2, now(),'dev',999001,'ev-m1');`);
    const ev2 = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_event where kind='moisture_reading' and stream_key='${lot}';`,
    );
    expect(ev2[0].n).toBe(1);
  });

  it("assign_drying_station on an unknown lot raises foreign_key_violation, not 'no declared mass' (#133)", async () => {
    let code: string | undefined;
    try {
      await h.query(`select assign_drying_station('JC-NOPE','st-bed-1', now());`);
    } catch (e) {
      code = (e as { code?: string }).code;
    }
    expect(code).toBe("23503"); // foreign_key_violation, not 23514 check_violation
  });

  it("record_moisture_reading rejects a NULL idempotency_key (#132)", async () => {
    const lot = await seedDryingLot(h, "nik", { toParchment: false });
    await expect(
      h.query(`select record_moisture_reading('${lot}', 11.0, now(),'dev',${seq()}, null);`),
    ).rejects.toThrow(/idempotency/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// PHASE-1 MIRROR — record_moisture_reading has a SECOND, cross-table side effect:
// it mirrors the new reading onto the flat Phase-1 column processing_batches.
// moisture_pct (migration sql:366) so legacy reads see the latest value. This is
// the one non-append-only write the RPC makes, and it crosses into a Phase-1 table,
// so it must be fenced. These pin: (a) the mirror fires onto the matching lot's
// batch, (b) it targets ONLY that lot (the WHERE lot_code clause), (c) a pure
// idempotency-key replay does NOT re-fire it (early return precedes the mirror),
// and (d) the CHOSEN last-write-wins-by-recording-order semantics — an out-of-order
// (back-dated occurred_at) reading recorded LATER updates the flat column to its
// value, while the safety-critical reposo gate stays order-correct (it reads
// moisture_readings ordered by recorded_at, NOT the flat column). Pinning the
// semantics makes the behavior intentional and fenced. (#96/#100.)
// ══════════════════════════════════════════════════════════════════════════
describe("P2-S4 — record_moisture_reading mirrors moisture_pct onto processing_batches", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(PLOT);
    await h.db.exec(WORKER);
    // Two Phase-1 batch rows on two distinct lots — the second is the control that
    // must stay untouched, fencing the WHERE lot_code targeting.
    await h.db.exec(`insert into lots (code, stage, origin_kg, current_kg) values ('JC-811','drying',60,60),('JC-812','drying',60,60);`);
    await h.db.exec(
      `insert into processing_batches (id, lot_code, variety, method, stage, started_date, cherries_kg, current_kg, moisture_pct, patio, progress_pct)
       values ('pb-mir1','JC-811','Geisha'::coffee_variety,'Washed'::process_method,'drying'::batch_stage,'2026-06-11',120,60,18.5,'Patio Norte',60),
              ('pb-mir2','JC-812','Geisha'::coffee_variety,'Washed'::process_method,'drying'::batch_stage,'2026-06-11',120,60,18.5,'Patio Norte',60);`,
    );
  });
  afterAll(async () => h.close());

  it("mirrors the reading onto the matching lot's batch, and ONLY that lot's batch", async () => {
    await h.query(`select record_moisture_reading('JC-811', 11.0, now() - interval '2 hours','dev',${seq()},'mir1-m1');`);
    const target = await h.query<{ moisture_pct: number }>(
      `select moisture_pct::float8 as moisture_pct from processing_batches where id = 'pb-mir1';`,
    );
    expect(target[0].moisture_pct).toBe(11.0); // mirror fired onto JC-811
    const other = await h.query<{ moisture_pct: number }>(
      `select moisture_pct::float8 as moisture_pct from processing_batches where id = 'pb-mir2';`,
    );
    expect(other[0].moisture_pct).toBe(18.5); // JC-812 untouched (WHERE lot_code fenced)
  });

  it("a pure idempotency-key replay does NOT re-fire the mirror (early return precedes it)", async () => {
    // First in-order reading sets the flat mirror to 11.2.
    await h.query(`select record_moisture_reading('JC-812', 11.2, now() - interval '2 hours','dev',${seq()},'mir2-key');`);
    const after1 = await h.query<{ moisture_pct: number }>(
      `select moisture_pct::float8 as moisture_pct from processing_batches where id = 'pb-mir2';`,
    );
    expect(after1[0].moisture_pct).toBe(11.2);
    // Replay the SAME idempotency key with a different value — the RPC short-circuits
    // at the early return BEFORE the mirror UPDATE, so the flat column does NOT change.
    await h.query(`select record_moisture_reading('JC-812', 9.9, now() - interval '1 hour','dev',999500,'mir2-key');`);
    const after2 = await h.query<{ moisture_pct: number }>(
      `select moisture_pct::float8 as moisture_pct from processing_batches where id = 'pb-mir2';`,
    );
    expect(after2[0].moisture_pct).toBe(11.2); // unchanged — replay skipped the mirror
  });

  it("CHOSEN SEMANTICS: the flat mirror is last-write-by-recording-order; the gate reads by ingest clock and isn't fooled by a back-dated occurred_at", async () => {
    // Fresh lot + batch so prior tests don't interfere. Seed it fully rested so the
    // gate would clear IF the readings were stable — isolating the moisture verdict.
    await h.db.exec(`insert into lots (code, stage, origin_kg, current_kg) values ('JC-813','parchment',60,60);`);
    await h.db.exec(
      `insert into processing_batches (id, lot_code, variety, method, stage, started_date, cherries_kg, current_kg, moisture_pct, patio, progress_pct)
       values ('pb-mir3','JC-813','Geisha'::coffee_variety,'Washed'::process_method,'drying'::batch_stage,'2026-06-11',120,60,18.5,'Patio Norte',60);`,
    );
    // Anchor the rest clock 12 days back so rest IS met (isolate moisture as the variable).
    await h.db.exec(
      `insert into lot_event (idempotency_key, stream_key, kind, payload, occurred_at, recorded_at, device_id, device_seq)
       values ('mir3-parch','JC-813','stage_advance',
               jsonb_build_object('lot_code','JC-813','to_stage','parchment','current_kg',55),
               now() - interval '12 days', now() - interval '12 days', 'dev', ${seq()});`,
    );
    // First, the honest in-band reading 11.0 (recorded first, mirror → 11.0).
    await h.query(`select record_moisture_reading('JC-813', 11.0, now() - interval '1 hour','dev',${seq()},'mir3-good');`);
    const flat1 = await h.query<{ moisture_pct: number }>(
      `select moisture_pct::float8 as moisture_pct from processing_batches where id = 'pb-mir3';`,
    );
    expect(flat1[0].moisture_pct).toBe(11.0);
    // Then a DISTINCT panic re-wet 13.0 reading whose FIELD occurred_at is back-dated 5h
    // (the offline-replay / wrong-clock case) but which is recorded LAST. The flat mirror
    // is last-write-wins-by-recording-order, so it takes 13.0 — the documented, intentional
    // Phase-1-display behavior (pinned here so a future refactor can't change it unnoticed).
    await h.query(`select record_moisture_reading('JC-813', 13.0, now() - interval '5 hours','dev',${seq()},'mir3-rewet');`);
    const flat2 = await h.query<{ moisture_pct: number }>(
      `select moisture_pct::float8 as moisture_pct from processing_batches where id = 'pb-mir3';`,
    );
    expect(flat2[0].moisture_pct).toBe(13.0); // last write wins on the flat mirror (chosen semantics)
    // The SAFETY-CRITICAL gate reads moisture_readings by recorded_at (server ingest clock),
    // NOT the field occurred_at, so the back-dated 13.0 — last-ingested and out of band —
    // is correctly seen as the current value and the lot is NOT ready (gate not fooled).
    const st = await h.query<{ latest_moisture: number; ready: boolean }>(
      `select latest_moisture::float8 as latest_moisture, ready from v_reposo_status where lot_code = 'JC-813';`,
    );
    expect(st[0].latest_moisture).toBe(13.0); // by recorded_at the 13.0 is genuinely last-ingested
    expect(st[0].ready).toBe(false); // wet → blocked despite the back-dated occurred_at
  });
});
