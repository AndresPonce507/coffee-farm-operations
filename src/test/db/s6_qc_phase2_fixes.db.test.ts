// P2-S6 QC — phase-2 FOUNDATION review regression tests (owner-31 MED/LOW sweep).
//
// These replay the REAL migrations in PGlite and pin the corrected behavior of the
// QC slice for the confirmed review defects. Each test was authored RED-first against
// the pre-fix migration (it must fail for the RIGHT reason on the old view/trigger),
// then made green by the minimal in-place fix to 20260622096000_qc_cupping.sql:
//
//   - #58  v_qc_status.latest_cup_score must ignore an OPENED-but-empty session and
//          report the real most-recent SCORED total (or NULL when none is scored) —
//          never a fabricated 0.
//   - #110 hold-vs-reserve TOCTOU: both _prevent_held_lot_commit AND place_qc_hold
//          must take the SAME per-lot advisory lock as prevent_oversell (structural
//          guard — a single-connection harness can't interleave, so we assert the
//          lock call is present in both function bodies, mirroring the oversell key).
//   - #111 / #140  the QC-HOLD gate triggers must fire BEFORE INSERT OR UPDATE (parity
//          with the prevent_oversell family it extends) so an UPDATE that lands/repoints
//          a claim onto a held lot is rejected too.
//   - #141 v_cup_final_score must be supersede-aware (latest-wins per (session,
//          attribute)) so a re-scored attribute is NOT double-counted into the band.
//   - #142 v_qc_status.latest_cup_score must be deterministic on a tied occurred_at —
//          id-desc tiebreaker returns the truly-latest-recorded session.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDb, type Harness } from "./pgliteHarness";

const SEED_SOURCE = `insert into lots (code, stage, variety, origin_kg, current_kg, minted_at)
  values ('JC-900', 'milled', 'Geisha', 100, 100, now());`;
const SEED_CUPPER = `insert into workers (id, name, role, daily_rate_usd, attendance, started_year, phone, crew)
  values ('w-cup-1','Marisol','Agronomist',20,'present',2018,'+507','crew-qc'),
         ('w-cup-2','Diego','Agronomist',20,'present',2019,'+507','crew-qc');`;

function materialize(h: Harness, sourceCode: string, greenCode: string, kg: number, grade = 84.5) {
  return h.query(
    `select materialize_green_lot('${sourceCode}','${greenCode}',${kg},${grade},'Warehouse-A',now()) as code;`,
  );
}

let SEQ = 5000;
async function recordSession(
  h: Harness,
  greenCode: string,
  cupper: string,
  protocol: "sca-cva" | "legacy-100",
  occurredAt: string,
  key: string,
): Promise<number> {
  const seq = (SEQ += 1);
  const r = await h.query<{ id: number }>(
    `select record_cupping_session(
       '${greenCode}','${cupper}','${protocol}',false, '${occurredAt}'::timestamptz,
       'srv', ${seq}, '${key}'
     ) as id;`,
  );
  return Number(r[0].id);
}

// ──────────────────────────────────────────────────────────────────────────
// #58 — an opened-but-empty newer session must not flip latest_cup_score to 0.
// ──────────────────────────────────────────────────────────────────────────
describe("P2-S6 #58 — v_qc_status.latest_cup_score ignores empty sessions", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(SEED_SOURCE);
    await h.query(SEED_CUPPER);
    await materialize(h, "JC-900", "JC-9001", 100);
  });
  afterAll(async () => h.close());

  it("reports the real prior SCORED total (17), not 0, when a newer session is empty", async () => {
    // Older, fully-scored session: total 17 (8 + 9).
    const scored = await recordSession(h, "JC-9001", "w-cup-1", "sca-cva", "2026-01-01T00:00:00Z", "f58-scored");
    await h.query(`select record_cup_score(${scored},'flavor',8,'srv',${(SEQ += 1)},'f58-a');`);
    await h.query(`select record_cup_score(${scored},'acidity',9,'srv',${(SEQ += 1)},'f58-b');`);
    // Newer session OPENED but with no attribute scores yet (the normal first step).
    await recordSession(h, "JC-9001", "w-cup-2", "sca-cva", "2026-01-08T00:00:00Z", "f58-empty");

    const r = await h.query<{ latest_cup_score: number | string | null }>(
      `select latest_cup_score from v_qc_status where green_lot_code='JC-9001';`,
    );
    // Pre-fix: returns 0 (the empty session wins the order-by). Post-fix: 17.
    expect(Number(r[0].latest_cup_score)).toBe(17);
  });

  it("yields SQL NULL (no fabricated 0) when the lot has ONLY empty sessions", async () => {
    await h.query(`insert into lots (code, stage, variety, origin_kg, current_kg, minted_at)
      values ('JC-902', 'milled', 'Geisha', 50, 50, now());`);
    await materialize(h, "JC-902", "JC-9002", 50);
    await recordSession(h, "JC-9002", "w-cup-1", "sca-cva", "2026-02-01T00:00:00Z", "f58-only-empty");
    const r = await h.query<{ latest_cup_score: number | string | null }>(
      `select latest_cup_score from v_qc_status where green_lot_code='JC-9002';`,
    );
    expect(r[0].latest_cup_score).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// #110 — symmetric per-lot advisory lock (structural guard, single-connection
// PGlite cannot interleave, so we assert the lock call is present in both bodies).
// ──────────────────────────────────────────────────────────────────────────
describe("P2-S6 #110 — hold/reserve TOCTOU advisory lock present on both sides", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
  });
  afterAll(async () => h.close());

  it("_prevent_held_lot_commit takes the per-lot advisory lock (matching prevent_oversell key)", async () => {
    const r = await h.query<{ def: string }>(
      `select pg_get_functiondef('_prevent_held_lot_commit'::regproc) as def;`,
    );
    expect(r[0].def).toMatch(/pg_advisory_xact_lock\s*\(\s*hashtext\s*\(\s*'green_lot:'/);
  });

  it("place_qc_hold takes the SAME per-lot advisory lock before inserting the hold", async () => {
    const r = await h.query<{ def: string }>(
      `select pg_get_functiondef('place_qc_hold'::regproc) as def;`,
    );
    expect(r[0].def).toMatch(/pg_advisory_xact_lock\s*\(\s*hashtext\s*\(\s*'green_lot:'/);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// #111 / #140 — the QC-HOLD gate must fire on UPDATE too (parity with oversell).
// ──────────────────────────────────────────────────────────────────────────
describe("P2-S6 #111/#140 — QC-HOLD gate covers UPDATE, not only INSERT", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(SEED_SOURCE);
    await h.query(SEED_CUPPER);
    await materialize(h, "JC-900", "JC-9001", 100); // un-held, gets a reservation
    await h.query(`insert into lots (code, stage, variety, origin_kg, current_kg, minted_at)
      values ('JC-901', 'milled', 'Geisha', 100, 100, now());`);
    await materialize(h, "JC-901", "JC-9011", 100); // the lot we will hold
  });
  afterAll(async () => h.close());

  it("an UPDATE that raises kg on a HELD lot's reservation is rejected (gate fires on UPDATE)", async () => {
    await h.query(`insert into lot_reservations (green_lot_code, buyer, kg) values ('JC-9001','Acme',10);`);
    await h.query(`select place_qc_hold('JC-9001','off-flavor', now(), 'srv', 1, 'f111-hold');`);
    await expect(
      h.query(`update lot_reservations set kg=50 where green_lot_code='JC-9001';`),
    ).rejects.toThrow(/qc[\s_-]?hold|held|quarantine/i);
  });

  it("an UPDATE that re-points an existing reservation ONTO a held lot is rejected", async () => {
    // JC-9011 reservation (un-held); then hold JC-9011 — wait, hold the TARGET.
    await h.query(`insert into lot_reservations (green_lot_code, buyer, kg) values ('JC-9011','Bravo',10);`);
    // JC-9001 is already held above; repoint JC-9011's reservation ONTO held JC-9001.
    await expect(
      h.query(`update lot_reservations set green_lot_code='JC-9001' where green_lot_code='JC-9011' and buyer='Bravo';`),
    ).rejects.toThrow(/qc[\s_-]?hold|held|quarantine/i);
  });

  it("the same UPDATE succeeds once the hold is released", async () => {
    await h.query(`select release_qc_hold('JC-9001', now(), 'srv', 2, 'f111-rel');`);
    await h.query(`update lot_reservations set kg=30 where green_lot_code='JC-9001' and buyer='Acme';`);
    const r = await h.query<{ kg: number }>(
      `select kg::int as kg from lot_reservations where green_lot_code='JC-9001' and buyer='Acme';`,
    );
    expect(Number(r[0].kg)).toBe(30);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// #141 — a re-scored attribute must NOT double-count into v_cup_final_score.
// ──────────────────────────────────────────────────────────────────────────
describe("P2-S6 #141 — v_cup_final_score is supersede-aware (latest-wins per attribute)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(SEED_SOURCE);
    await h.query(SEED_CUPPER);
    await materialize(h, "JC-900", "JC-9001", 100);
  });
  afterAll(async () => h.close());

  it("scoring the same attribute twice counts ONLY the latest value (no 16-from-two-8s)", async () => {
    const sid = await recordSession(h, "JC-9001", "w-cup-1", "sca-cva", "2026-03-01T00:00:00Z", "f141-sess");
    await h.query(`select record_cup_score(${sid},'flavor',8,'srv',${(SEQ += 1)},'f141-flavor-1');`);
    // A correction: re-enter flavor as 7 (append-only ledger → a superseding row).
    await h.query(`select record_cup_score(${sid},'flavor',7,'srv',${(SEQ += 1)},'f141-flavor-2');`);

    const r = await h.query<{ final_score: number | string; attribute_count: number | string }>(
      `select final_score::numeric as final_score, attribute_count::int as attribute_count
         from v_cup_final_score where session_id=${sid};`,
    );
    // Pre-fix: sum(8+7)=15, attribute_count=2. Post-fix: latest 7, attribute_count=1.
    expect(Number(r[0].final_score)).toBe(7);
    expect(Number(r[0].attribute_count)).toBe(1);
  });

  it("distinct attributes still sum normally (no regression on the happy path)", async () => {
    const sid = await recordSession(h, "JC-9001", "w-cup-2", "sca-cva", "2026-03-02T00:00:00Z", "f141-multi");
    await h.query(`select record_cup_score(${sid},'fragrance',8,'srv',${(SEQ += 1)},'f141-m-a');`);
    await h.query(`select record_cup_score(${sid},'flavor',9,'srv',${(SEQ += 1)},'f141-m-b');`);
    const r = await h.query<{ final_score: number | string; attribute_count: number | string }>(
      `select final_score::numeric as final_score, attribute_count::int as attribute_count
         from v_cup_final_score where session_id=${sid};`,
    );
    expect(Number(r[0].final_score)).toBe(17);
    expect(Number(r[0].attribute_count)).toBe(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// #142 — latest_cup_score deterministic on tied occurred_at (id-desc tiebreaker).
// ──────────────────────────────────────────────────────────────────────────
describe("P2-S6 #142 — latest_cup_score deterministic on tied occurred_at", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(SEED_SOURCE);
    await h.query(SEED_CUPPER);
    await materialize(h, "JC-900", "JC-9001", 100);
  });
  afterAll(async () => h.close());

  it("returns the higher-id (truly-latest-recorded) session's score on a tie", async () => {
    const tied = "2026-01-01T00:00:00Z";
    // session A inserted first (lower id), total 5.
    const sa = await recordSession(h, "JC-9001", "w-cup-1", "sca-cva", tied, "f142-a");
    await h.query(`select record_cup_score(${sa},'flavor',5,'srv',${(SEQ += 1)},'f142-a-s');`);
    // session B inserted second (higher id, the truly-later session), total 9.
    const sb = await recordSession(h, "JC-9001", "w-cup-2", "sca-cva", tied, "f142-b");
    await h.query(`select record_cup_score(${sb},'flavor',9,'srv',${(SEQ += 1)},'f142-b-s');`);

    const r = await h.query<{ latest_cup_score: number | string | null }>(
      `select latest_cup_score from v_qc_status where green_lot_code='JC-9001';`,
    );
    // Pre-fix: unspecified (observed 5). Post-fix: deterministically 9 (id desc).
    expect(Number(r[0].latest_cup_score)).toBe(9);
  });
});
