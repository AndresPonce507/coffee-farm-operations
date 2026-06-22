// P2-S6 — QC & cupping: SQL tests that replay the REAL migrations (Phase-1 spine +
// the QC slice) in PGlite and prove the cup-quality invariants of the slice
// (P2-S6 spec + AD-8 + the S3 SECURITY-DEFINER-grant lesson):
//
//   - QC-HOLD blocks commerce (THE teeth): a green lot with an OPEN qc_hold
//     CANNOT be reserved or shipped — the `prevent_held_lot_commit` trigger
//     (extending the Phase-1 prevent_oversell family) FAILS CLOSED. Releasing the
//     hold re-opens commerce. Written RED first per the spec.
//   - Cupping sessions + append-only scores: a session binds back to its
//     green_lot_code (cup-to-cause); scores are an append-only ledger (no
//     UPDATE/DELETE) bound to a session forever.
//   - v_cup_final_score: the protocol-correct total per session (SCA CVA vs legacy
//     100-pt), derived from the score rows (never a stored counter).
//   - Cupper-drift calibration: v_cupper_drift compares each cupper's score on a
//     SHARED calibration sample against the panel mean — a systematic +3 bias is
//     surfaced as evidence (never a hard block).
//   - Green defects: an append-only defect ledger keyed to a green lot, banded
//     primary/secondary; v_qc_status rolls hold + score + defect signal per lot.
//   - AD-8 grant posture: every new table/view SELECT-granted to authenticated,
//     never to anon; the claim/score/defect/hold tables grant only INSERT (or
//     nothing) — never UPDATE/DELETE; the definer RPCs revoke public + grant
//     authenticated.
//
// Runs the authenticated role via the harness so it exercises the live posture.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, freshDb, type Harness } from "./pgliteHarness";

// ── fixtures ────────────────────────────────────────────────────────────────
// A milled source lot the green node is materialized FROM (100 kg routable mass),
// then a green lot materialized off it via the Phase-1 writer. Cupping/QC bind to
// the GREEN lot code.
const SEED_SOURCE = `insert into lots (code, stage, variety, origin_kg, current_kg, minted_at)
  values ('JC-900', 'milled', 'Geisha', 100, 100, now());`;

// A cupper is a worker row (cupper_id → workers.id). workers.id is a text PK.
const SEED_CUPPER = `insert into workers (id, name, role, daily_rate_usd, attendance, started_year, phone, crew)
  values ('w-cup-1','Marisol','Agronomist',20,'present',2018,'+507','crew-qc'),
         ('w-cup-2','Diego','Agronomist',20,'present',2019,'+507','crew-qc'),
         ('w-cup-3','Elena','Agronomist',20,'present',2020,'+507','crew-qc');`;

function materialize(
  h: Harness,
  sourceCode: string,
  greenCode: string,
  kg: number,
  grade = 84.5,
) {
  return h.query(
    `select materialize_green_lot('${sourceCode}','${greenCode}',${kg},${grade},'Warehouse-A',now()) as code;`,
  );
}

// A per-test monotonic device_seq minter — the (device_id, device_seq) UNIQUE
// (replay safety, D4) means every session/score write in one DB needs a distinct
// seq. Tests share device_id 'srv', so we hand out a fresh seq per session here and
// the per-call score seqs are passed explicitly above 100.
let SESSION_SEQ = 1000;

/** Record a cupping session via the command RPC; returns the session id (bigint). */
async function recordSession(
  h: Harness,
  greenCode: string,
  cupper: string,
  protocol: "sca-cva" | "legacy-100",
  opts: { isCalibration?: boolean; key?: string } = {},
): Promise<number> {
  const cal = opts.isCalibration ? "true" : "false";
  const key = (opts.key ?? `sess-${greenCode}-${cupper}-${protocol}`).replace(/'/g, "''");
  const seq = (SESSION_SEQ += 1);
  const r = await h.query<{ id: number }>(
    `select record_cupping_session(
       '${greenCode}','${cupper}','${protocol}',${cal}, now(),
       'srv', ${seq}, '${key}'
     ) as id;`,
  );
  return Number(r[0].id);
}

// ──────────────────────────────────────────────────────────────────────────
describe("P2-S6 QC — QC-HOLD blocks commerce (fail-closed, the teeth)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(SEED_SOURCE);
    await h.query(SEED_CUPPER);
    await materialize(h, "JC-900", "JC-9001", 100); // 100 kg green lot
  });
  afterAll(async () => h.close());

  it("accepts a reservation while there is NO hold", async () => {
    await h.query(
      `insert into lot_reservations (green_lot_code, buyer, kg) values ('JC-9001','Acme',20);`,
    );
    const r = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_reservations where green_lot_code='JC-9001';`,
    );
    expect(r[0].n).toBe(1);
  });

  // THE red assertion (written first): a held lot cannot be reserved.
  it("REJECTS a reservation once a QC-HOLD is placed on the lot", async () => {
    await h.query(`select place_qc_hold('JC-9001','off-flavor — re-cup', now(), 'srv', 2, 'hold-1');`);
    await expect(
      h.query(
        `insert into lot_reservations (green_lot_code, buyer, kg) values ('JC-9001','Bravo',10);`,
      ),
    ).rejects.toThrow(/qc[\s_-]?hold|held|quarantine|cannot.*reserv|on hold/i);
  });

  it("REJECTS a shipment while the QC-HOLD is open", async () => {
    await expect(
      h.query(
        `insert into lot_shipments (green_lot_code, destination, kg) values ('JC-9001','Port',10);`,
      ),
    ).rejects.toThrow(/qc[\s_-]?hold|held|quarantine|cannot.*ship|on hold/i);
  });

  it("RE-OPENS commerce once the hold is released", async () => {
    await h.query(`select release_qc_hold('JC-9001', now(), 'srv', 3, 'release-1');`);
    await h.query(
      `insert into lot_reservations (green_lot_code, buyer, kg) values ('JC-9001','Charlie',10);`,
    );
    const r = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_reservations where green_lot_code='JC-9001' and buyer='Charlie';`,
    );
    expect(r[0].n).toBe(1);
  });

  it("a fresh hold blocks again (hold ledger is the live source of truth)", async () => {
    await h.query(`select place_qc_hold('JC-9001','second look', now(), 'srv', 4, 'hold-2');`);
    await expect(
      h.query(
        `insert into lot_reservations (green_lot_code, buyer, kg) values ('JC-9001','Delta',1);`,
      ),
    ).rejects.toThrow(/qc[\s_-]?hold|held|quarantine|cannot.*reserv|on hold/i);
  });

  // The QC gate must cover UPDATE too — matching the prevent_oversell family it
  // extends (which fires BEFORE INSERT OR UPDATE). The grant posture (INSERT-only)
  // is the outer wall, so this UPDATE runs as the owner harness role to exercise the
  // trigger directly. Pins the gate symmetry so it can never silently reopen: if a
  // future refactor narrows _prevent_held_lot_commit's trigger to BEFORE INSERT only,
  // these go RED. Use a separate clear lot so the JC-9001 state above is untouched.
  it("REJECTS amending (UPDATE) an existing reservation once its lot is held", async () => {
    await h.query(
      `insert into lots (code, stage, variety, origin_kg, current_kg, minted_at)
         values ('JC-910', 'milled', 'Geisha', 40, 40, now());`,
    );
    await materialize(h, "JC-910", "JC-9101", 40);
    await h.query(
      `insert into lot_reservations (green_lot_code, buyer, kg) values ('JC-9101','Echo',10);`,
    );
    await h.query(`select place_qc_hold('JC-9101','off-flavor', now(), 'srv', 20, 'hold-9101');`);
    // a kg bump on the existing reservation re-validates against the now-held lot
    await expect(
      h.query(`update lot_reservations set kg = 20 where green_lot_code = 'JC-9101';`),
    ).rejects.toThrow(/qc[\s_-]?hold|held|quarantine|cannot.*reserv|on hold/i);
  });

  it("REJECTS re-pointing (UPDATE) a reservation onto a held lot", async () => {
    await h.query(
      `insert into lots (code, stage, variety, origin_kg, current_kg, minted_at)
         values ('JC-911', 'milled', 'Geisha', 40, 40, now());`,
    );
    await materialize(h, "JC-911", "JC-9111", 40);
    // a CLEAR lot we can put a reservation on, then re-point it onto the held JC-9101
    await h.query(
      `insert into lot_reservations (green_lot_code, buyer, kg) values ('JC-9111','Foxtrot',5);`,
    );
    await expect(
      h.query(
        `update lot_reservations set green_lot_code = 'JC-9101' where green_lot_code = 'JC-9111';`,
      ),
    ).rejects.toThrow(/qc[\s_-]?hold|held|quarantine|cannot.*reserv|on hold/i);
  });

  it("REJECTS amending (UPDATE) an existing shipment once its lot is held", async () => {
    await h.query(
      `insert into lots (code, stage, variety, origin_kg, current_kg, minted_at)
         values ('JC-912', 'milled', 'Geisha', 40, 40, now());`,
    );
    await materialize(h, "JC-912", "JC-9121", 40);
    await h.query(
      `insert into lot_shipments (green_lot_code, destination, kg) values ('JC-9121','Port',10);`,
    );
    await h.query(`select place_qc_hold('JC-9121','off-flavor', now(), 'srv', 21, 'hold-9121');`);
    await expect(
      h.query(`update lot_shipments set kg = 20 where green_lot_code = 'JC-9121';`),
    ).rejects.toThrow(/qc[\s_-]?hold|held|quarantine|cannot.*ship|on hold/i);
  });
});

// ──────────────────────────────────────────────────────────────────────────
describe("P2-S6 QC — qc_holds is an append-only ledger, place/release are idempotent", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(SEED_SOURCE);
    await h.query(SEED_CUPPER);
    await materialize(h, "JC-900", "JC-9001", 100);
  });
  afterAll(async () => h.close());

  it("place_qc_hold is exactly-once on idempotency_key (replay = one hold row)", async () => {
    await h.query(`select place_qc_hold('JC-9001','reason', now(), 'srv', 1, 'k-place');`);
    await h.query(`select place_qc_hold('JC-9001','reason', now(), 'srv', 1, 'k-place');`); // replay
    const r = await h.query<{ n: number }>(
      `select count(*)::int as n from qc_holds where green_lot_code='JC-9001';`,
    );
    expect(r[0].n).toBe(1);
  });

  it("release_qc_hold stamps released_at on the open hold (no UPDATE-from-client path)", async () => {
    await h.query(`select release_qc_hold('JC-9001', now(), 'srv', 2, 'k-release');`);
    const r = await h.query<{ open_n: number }>(
      `select count(*)::int as open_n from qc_holds where green_lot_code='JC-9001' and released_at is null;`,
    );
    expect(r[0].open_n).toBe(0);
  });

  it("v_qc_status reports the lot UN-held after release", async () => {
    const r = await h.query<{ held: boolean }>(
      `select held from v_qc_status where green_lot_code='JC-9001';`,
    );
    expect(r[0].held).toBe(false);
  });

  it("a client cannot UPDATE or DELETE a qc_holds row (append-only block)", async () => {
    await expect(
      h.query(`delete from qc_holds where green_lot_code='JC-9001';`),
    ).rejects.toThrow(/append-only|immutable|blocked|permission|denied/i);
  });

  // ── _qc_holds_guard_mutation branches (b)/(c)/(d) — the DELETE branch is pinned
  // above; these pin the one-way-release contract the migration's comment calls
  // "fragile" and load-bearing. They run as the table owner (the exact path the
  // DEFINER release RPC takes), so they hit the trigger directly — a future refactor
  // that drops the released_at check or the column-distinct comparison goes RED here
  // instead of silently letting quarantine history be rewritten/reverted.

  // (b) re-stamp/re-open of an ALREADY-released hold is rejected. JC-9001's hold was
  // released in an earlier test in this block. Re-stamp released_at to a NEW non-null
  // value (a null value would trip branch (d) first, never reaching branch (b)).
  it("blocks re-stamping an already-released qc_holds row (no re-open)", async () => {
    await expect(
      h.query(
        `update qc_holds set released_at = now() + interval '1 day', released_by = 'attacker'
           where green_lot_code = 'JC-9001';`,
      ),
    ).rejects.toThrow(/already released|re-open/i);
  });

  // (c) re-keying any identity column is rejected. Needs a STILL-OPEN hold (JC-9001's
  // is released, which would fire branch (b) first) — materialize a fresh lot + place
  // a fresh open hold so the column-distinct branch is the one that fires.
  it("blocks re-keying any column other than the release stamp on an open hold", async () => {
    await h.query(
      `insert into lots (code, stage, variety, origin_kg, current_kg, minted_at)
         values ('JC-901', 'milled', 'Geisha', 50, 50, now());`,
    );
    await materialize(h, "JC-901", "JC-9011", 50);
    await h.query(`select place_qc_hold('JC-9011','open look', now(), 'srv', 10, 'k-rekey');`);
    // Re-key a non-release column WHILE stamping a valid release, so it can only be
    // branch (c) (the column-distinct check) that rejects it — not branch (d). This
    // isolates branch (c): drop the column-distinct comparison and this UPDATE is
    // silently allowed (released_at is non-null, so branch (d) passes too).
    await expect(
      h.query(
        `update qc_holds set reason = 'rewritten', released_at = now(), released_by = 'x'
           where green_lot_code = 'JC-9011';`,
      ),
    ).rejects.toThrow(/only a release stamp|append-only/i);
  });

  // (d) an UPDATE that does NOT stamp a release (released_at) is rejected. Touch a
  // non-key column (released_by) WITHOUT setting released_at, on a still-open hold.
  it("blocks an UPDATE on an open hold that does not stamp a release", async () => {
    await h.query(
      `insert into lots (code, stage, variety, origin_kg, current_kg, minted_at)
         values ('JC-902', 'milled', 'Geisha', 50, 50, now());`,
    );
    await materialize(h, "JC-902", "JC-9021", 50);
    await h.query(`select place_qc_hold('JC-9021','open look', now(), 'srv', 11, 'k-nostamp');`);
    await expect(
      h.query(`update qc_holds set released_by = 'x' where green_lot_code = 'JC-9021';`),
    ).rejects.toThrow(/must stamp a release/i);
  });

  // place_qc_hold's in-function existence pre-check raises a CLEAN 'unknown green lot'
  // (errcode foreign_key_violation) BEFORE the table FK would. Assert on the clean
  // message specifically (not the broad FK fallback) so removing the pre-check — which
  // would degrade the error to a raw constraint message — goes RED. Use a key not
  // reused elsewhere so the idempotency short-circuit can't mask the existence check.
  it("rejects a hold on a non-existent green lot with the clean 'unknown green lot' message", async () => {
    await expect(
      h.query(`select place_qc_hold('JC-NOPE','off-flavor', now(), 'srv', 999, 'k-phantom');`),
    ).rejects.toThrow(/unknown green lot/i);
  });
});

// ──────────────────────────────────────────────────────────────────────────
describe("P2-S6 QC — cupping sessions + append-only scores + cup-to-cause binding", () => {
  let h: Harness;
  let sessionId: number;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(SEED_SOURCE);
    await h.query(SEED_CUPPER);
    await materialize(h, "JC-900", "JC-9001", 100);
    sessionId = await recordSession(h, "JC-9001", "w-cup-1", "sca-cva");
  });
  afterAll(async () => h.close());

  it("a session binds back to its green_lot_code (cup-to-cause)", async () => {
    const r = await h.query<{ green_lot_code: string; protocol: string; cupper_id: string }>(
      `select green_lot_code, protocol, cupper_id from cupping_sessions where id=${sessionId};`,
    );
    expect(r[0].green_lot_code).toBe("JC-9001");
    expect(r[0].protocol).toBe("sca-cva");
    expect(r[0].cupper_id).toBe("w-cup-1");
  });

  it("records cup scores via the command RPC, bound to the session", async () => {
    await h.query(`select record_cup_score(${sessionId},'fragrance',8.0,'srv',10,'sc-1');`);
    await h.query(`select record_cup_score(${sessionId},'flavor',8.5,'srv',11,'sc-2');`);
    const r = await h.query<{ n: number }>(
      `select count(*)::int as n from cupping_scores where session_id=${sessionId};`,
    );
    expect(r[0].n).toBe(2);
  });

  it("record_cup_score is exactly-once on idempotency_key (replay = no second row)", async () => {
    await h.query(`select record_cup_score(${sessionId},'flavor',8.5,'srv',11,'sc-2');`); // replay
    const r = await h.query<{ n: number }>(
      `select count(*)::int as n from cupping_scores where session_id=${sessionId};`,
    );
    expect(r[0].n).toBe(2);
  });

  it("a cup score row cannot be UPDATEd or DELETEd (append-only ledger)", async () => {
    await expect(
      h.query(`update cupping_scores set score=1 where session_id=${sessionId};`),
    ).rejects.toThrow(/append-only|immutable|blocked|permission|denied/i);
  });

  it("rejects an out-of-range score (CHECK on the score column)", async () => {
    await expect(
      h.query(`select record_cup_score(${sessionId},'aftertaste',-5,'srv',12,'sc-bad');`),
    ).rejects.toThrow();
  });

  it("rejects an unknown protocol on a session (CHECK constraint)", async () => {
    await expect(
      h.query(
        `select record_cupping_session('JC-9001','w-cup-1','made-up-protocol',false,now(),'srv',99,'sess-bad');`,
      ),
    ).rejects.toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────
describe("P2-S6 QC — v_cup_final_score totals per protocol (derived, never stored)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(SEED_SOURCE);
    await h.query(SEED_CUPPER);
    await materialize(h, "JC-900", "JC-9001", 100);
  });
  afterAll(async () => h.close());

  it("SCA CVA: final = sum of attribute scores (the affective additive total)", async () => {
    const sid = await recordSession(h, "JC-9001", "w-cup-1", "sca-cva", { key: "cva-final" });
    // 8 attributes at known values; the CVA total is their sum.
    const attrs: [string, number][] = [
      ["fragrance", 8],
      ["flavor", 8],
      ["aftertaste", 7],
      ["acidity", 8],
      ["sweetness", 7],
      ["mouthfeel", 8],
      ["overall", 8],
      ["uniformity", 8],
    ];
    let seq = 20;
    for (const [a, v] of attrs) {
      await h.query(`select record_cup_score(${sid},'${a}',${v},'srv',${seq},'cva-${a}');`);
      seq += 1;
    }
    const r = await h.query<{ final_score: number }>(
      `select final_score::numeric as final_score from v_cup_final_score where session_id=${sid};`,
    );
    expect(Number(r[0].final_score)).toBeCloseTo(62, 6);
  });

  it("legacy 100-pt: final = sum of the 10-attribute scoresheet", async () => {
    const sid = await recordSession(h, "JC-9001", "w-cup-2", "legacy-100", { key: "leg-final" });
    // legacy 100-pt: 10 attributes. 8.5+8.75+8.25+8.5+8.5+8.5+10+10+10+5 = 86.
    const attrs: [string, number][] = [
      ["fragrance", 8.5],
      ["flavor", 8.75],
      ["aftertaste", 8.25],
      ["acidity", 8.5],
      ["body", 8.5],
      ["balance", 8.5],
      ["uniformity", 10],
      ["clean-cup", 10],
      ["sweetness", 10],
      ["overall", 5],
    ];
    let seq = 40;
    for (const [a, v] of attrs) {
      await h.query(`select record_cup_score(${sid},'${a}',${v},'srv',${seq},'leg-${a}');`);
      seq += 1;
    }
    const r = await h.query<{ final_score: number }>(
      `select final_score::numeric as final_score from v_cup_final_score where session_id=${sid};`,
    );
    expect(Number(r[0].final_score)).toBeCloseTo(86, 6);
  });

  // The final cup total is a VIEW (v_cup_final_score), NOT a column on green_lots.
  // green_lots.cupping_score is the materialize-time grade input that drives the
  // generated sca_grade band — a different number from the cup final. Recording a
  // session/scores must leave green_lots.cupping_score untouched. Pins the
  // view-not-column separation: a future change that writes the cup total back into
  // green_lots.cupping_score (silently flipping the commercial SCA grade) goes RED.
  it("a cupping session does not mutate green_lots.cupping_score (final is a VIEW, not a column)", async () => {
    const before = await h.query<{ cupping_score: number }>(
      `select cupping_score::numeric as cupping_score from green_lots where lot_code='JC-9001';`,
    );
    const sid = await recordSession(h, "JC-9001", "w-cup-1", "sca-cva", { key: "no-writeback" });
    let seq = 200;
    for (const [a, v] of [
      ["fragrance", 8],
      ["flavor", 7],
      ["acidity", 8],
    ] as [string, number][]) {
      await h.query(`select record_cup_score(${sid},'${a}',${v},'srv',${seq},'nw-${a}');`);
      seq += 1;
    }
    const after = await h.query<{ cupping_score: number }>(
      `select cupping_score::numeric as cupping_score from green_lots where lot_code='JC-9001';`,
    );
    // 84.5 (the fixture grade), unchanged — the final lives in v_cup_final_score.
    expect(Number(after[0].cupping_score)).toBe(Number(before[0].cupping_score));
  });
});

// ──────────────────────────────────────────────────────────────────────────
describe("P2-S6 QC — cupper-drift calibration (evidence, not a block)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(SEED_SOURCE);
    await h.query(SEED_CUPPER);
    await materialize(h, "JC-900", "JC-9001", 100);
    // Shared CALIBRATION sample: three cuppers score the SAME attribute on the
    // same lot. cup-2 runs +3 on acidity vs the others.
    const s1 = await recordSession(h, "JC-9001", "w-cup-1", "sca-cva", { isCalibration: true, key: "cal-1" });
    const s2 = await recordSession(h, "JC-9001", "w-cup-2", "sca-cva", { isCalibration: true, key: "cal-2" });
    const s3 = await recordSession(h, "JC-9001", "w-cup-3", "sca-cva", { isCalibration: true, key: "cal-3" });
    await h.query(`select record_cup_score(${s1},'acidity',7,'srv',60,'cal-a-1');`);
    await h.query(`select record_cup_score(${s2},'acidity',10,'srv',61,'cal-a-2');`); // +3 bias
    await h.query(`select record_cup_score(${s3},'acidity',7,'srv',62,'cal-a-3');`);
  });
  afterAll(async () => h.close());

  it("surfaces the +3 acidity drift for the biased cupper vs the panel mean", async () => {
    const r = await h.query<{ cupper_id: string; drift: number }>(
      `select cupper_id, drift::numeric as drift from v_cupper_drift
        where attribute='acidity' and cupper_id='w-cup-2';`,
    );
    expect(r.length).toBe(1);
    // panel mean over the calibration sample = (7+10+7)/3 = 8; cup-2 drift = +2.
    expect(Number(r[0].drift)).toBeCloseTo(2, 6);
  });

  it("an unbiased cupper drifts near zero", async () => {
    const r = await h.query<{ drift: number }>(
      `select drift::numeric as drift from v_cupper_drift
        where attribute='acidity' and cupper_id='w-cup-1';`,
    );
    expect(Number(r[0].drift)).toBeCloseTo(-1, 6); // 7 - 8 = -1
  });

  it("does NOT count non-calibration sessions in the panel mean", async () => {
    // a regular (non-calibration) session must not move the calibration baseline.
    const sn = await recordSession(h, "JC-9001", "w-cup-1", "sca-cva", { key: "non-cal" });
    await h.query(`select record_cup_score(${sn},'acidity',1,'srv',70,'noncal-a');`);
    const r = await h.query<{ drift: number }>(
      `select drift::numeric as drift from v_cupper_drift
        where attribute='acidity' and cupper_id='w-cup-2';`,
    );
    expect(Number(r[0].drift)).toBeCloseTo(2, 6); // unchanged
  });
});

// ──────────────────────────────────────────────────────────────────────────
describe("P2-S6 QC — green defect ledger (append-only, banded)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(SEED_SOURCE);
    await h.query(SEED_CUPPER);
    await materialize(h, "JC-900", "JC-9001", 100);
  });
  afterAll(async () => h.close());

  it("records defects via the command RPC, keyed to a green lot", async () => {
    await h.query(`select record_defect('JC-9001','full-black',2,'primary','srv',80,'d-1');`);
    await h.query(`select record_defect('JC-9001','broken',5,'secondary','srv',81,'d-2');`);
    const r = await h.query<{ n: number }>(
      `select count(*)::int as n from green_defects where green_lot_code='JC-9001';`,
    );
    expect(r[0].n).toBe(2);
  });

  it("rejects an unknown defect category (CHECK in ('primary','secondary'))", async () => {
    await expect(
      h.query(`select record_defect('JC-9001','x',1,'tertiary','srv',82,'d-bad');`),
    ).rejects.toThrow();
  });

  it("a defect row cannot be UPDATEd or DELETEd (append-only)", async () => {
    await expect(
      h.query(`delete from green_defects where green_lot_code='JC-9001';`),
    ).rejects.toThrow(/append-only|immutable|blocked|permission|denied/i);
  });

  it("v_qc_status rolls up the primary/secondary defect counts per lot", async () => {
    const r = await h.query<{ primary_defects: number; secondary_defects: number }>(
      `select primary_defects::int, secondary_defects::int from v_qc_status where green_lot_code='JC-9001';`,
    );
    expect(Number(r[0].primary_defects)).toBe(2);
    expect(Number(r[0].secondary_defects)).toBe(5);
  });
});

// ──────────────────────────────────────────────────────────────────────────
describe("P2-S6 QC — RPCs are authenticated-only (S3 lesson)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(SEED_SOURCE);
    await h.query(SEED_CUPPER);
    await materialize(h, "JC-900", "JC-9001", 100);
  });
  afterAll(async () => h.close());

  for (const call of [
    `select place_qc_hold('JC-9001','r',now(),'srv',1,'anon-hold');`,
    `select release_qc_hold('JC-9001',now(),'srv',2,'anon-rel');`,
    `select record_cupping_session('JC-9001','w-cup-1','sca-cva',false,now(),'srv',3,'anon-sess');`,
    `select record_defect('JC-9001','x',1,'primary','srv',4,'anon-def');`,
  ]) {
    it(`anon CANNOT call: ${call.slice(7, 30)}…`, async () => {
      await expect(
        asAnon(h, (hh) => hh.query(call)),
      ).rejects.toThrow(/permission denied|not.*authoriz|denied/i);
    });
  }
});

// ──────────────────────────────────────────────────────────────────────────
describe("P2-S6 QC — AD-8 grant posture", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
  });
  afterAll(async () => h.close());

  for (const obj of [
    "cupping_sessions",
    "cupping_scores",
    "green_defects",
    "qc_holds",
    "v_cup_final_score",
    "v_cupper_drift",
    "v_qc_status",
  ]) {
    it(`${obj} is SELECT-granted to authenticated, never to anon`, async () => {
      const rows = await h.query<{ grantee: string; privilege_type: string }>(
        `select grantee, privilege_type from information_schema.role_table_grants where table_name = '${obj}';`,
      );
      const authSelect = rows.some(
        (r) => r.grantee === "authenticated" && r.privilege_type === "SELECT",
      );
      expect(authSelect, `${obj} must grant SELECT to authenticated`).toBe(true);
      const anonAny = rows.some((r) => r.grantee === "anon");
      expect(anonAny, `${obj} must NOT grant anything to anon`).toBe(false);
    });
  }

  for (const tbl of ["cupping_sessions", "cupping_scores", "green_defects", "qc_holds"]) {
    it(`${tbl} grants NO UPDATE/DELETE to anon/authenticated (RPC-only / append-only)`, async () => {
      const rows = await h.query<{ grantee: string; privilege_type: string }>(
        `select grantee, privilege_type from information_schema.role_table_grants
          where table_name = '${tbl}' and grantee in ('anon','authenticated')
            and privilege_type in ('UPDATE','DELETE');`,
      );
      expect(rows.length, `${tbl} must not grant UPDATE/DELETE to client roles`).toBe(0);
    });
  }
});
