// P2-S2 — Offline-first per-picker weigh capture (THE GENESIS FIELD EVENT).
// SQL tests that replay the REAL migrations in PGlite (including this slice's) and
// prove the slice's load-bearing data-layer invariants + the AD-8 grant posture.
//
//   - FEEDS FOUR SYSTEMS: one record_weigh_in produces (1) a weigh_event (PAY +
//     MILL-INTAKE source), (2) a clock-in attendance_event (ATTENDANCE proof),
//     (3) a harvests row + a minted JC-NNN lot (TRACEABILITY), all in one txn.
//   - APPEND-ONLY + EXACTLY-ONCE: a replay on the same idempotency_key is one row
//     (no second weigh_event / harvest / attendance / lot); UPDATE + DELETE on
//     weigh_event raise.
//   - kg CONSERVES INTO THE LOT: Σ weigh_event.kg for a plot/day lot reconciles to
//     lots.origin_kg (v_lot_weigh_reconciliation.reconciles = true); kg >= 0 is a
//     hard CHECK.
//   - GEOFENCE IS A SIGNAL, NEVER A GATE: an out-of-range GPS fix writes
//     geofence_ok=false but the weigh-in still SUCCEEDS; a missing fix → NULL.
//   - CREW-MEMBER GATE: a worker with no active crew membership is refused.
//   - AD-8 GRANTS: authenticated reads weigh_event + the views; anon reads NOTHING;
//     record_weigh_in executes for authenticated.
//
// Substrate: the PGlite migration-replay harness (replays the REAL migrations). No
// farm_id / multi-tenant scoping — the spine is authenticated-only RLS; this test
// mirrors that posture exactly.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asAuthenticated, freshDb, type Harness } from "./pgliteHarness";

// ──────────────────────────────────────────────────────────────────────────
// Fixtures. A plot WITH a centroid (so the geofence signal has a reference), two
// workers — one on an active crew (the picker), one with no membership (the gate
// negative). _backfill_people() promotes the seeded crew strings into crews +
// active memberships, exactly as prod's seed does.
// ──────────────────────────────────────────────────────────────────────────
const CENTROID = `'{"type":"Point","coordinates":[-82.640344,8.777835]}'::jsonb`;
const PLOT = `insert into plots (id, ord, name, block, variety, area_ha, altitude_masl, trees,
  shade_pct, established_year, status, last_inspected, expected_yield_kg, harvested_kg, geom, centroid)
  values ('p-weigh', 90, 'Weigh Plot', 'Block W', 'Geisha', 4.2, 1690, 14800, 55, 2014, 'healthy',
    '2026-06-18', 18600, 12120,
    '{"type":"Polygon","coordinates":[[[-82.641276,8.776908],[-82.639413,8.776908],[-82.639413,8.778761],[-82.641276,8.778761],[-82.641276,8.776908]]]}'::jsonb,
    ${CENTROID});`;
const WORKERS = `insert into workers (id, name, role, daily_rate_usd, attendance, started_year, phone, today_kg, crew) values
  ('w-pick','Lucía Morales','Picker',22,'present',2019,'+507 0',0,'Crew Tizingal'),
  ('w-loose','Ana Serrano','Picker',22,'present',2020,'+507 1',0,'Crew Tizingal');`;

// near the centroid (well within 500m) vs ~2km away (out of range but NOT rejected).
const NEAR_LAT = 8.777835,
  NEAR_LNG = -82.640344;
const FAR_LAT = 8.797835,
  FAR_LNG = -82.660344;

let SEQ = 5000;
const seq = () => SEQ++;

async function seedFarm(h: Harness): Promise<void> {
  await h.query(PLOT);
  await h.query(WORKERS);
  await h.query(`select _backfill_people();`);
  // make w-loose a non-member: close its active membership (membership history move).
  await h.query(
    `update crew_memberships set left_at = now() where worker_id = 'w-loose' and left_at is null;`,
  );
}

/** One weigh-in via the RPC; returns the bound lot_code. */
async function weigh(
  h: Harness,
  args: {
    worker?: string;
    plot?: string;
    kg: number;
    ripeness?: string;
    brix?: number | null;
    source?: string;
    lat?: number | null;
    lng?: number | null;
    occurredAt?: string;
    seq?: number;
    key: string;
  },
): Promise<string> {
  const w = args.worker ?? "w-pick";
  const p = args.plot ?? "p-weigh";
  const rip = args.ripeness ?? "ripe";
  const brix = args.brix === undefined ? "null" : args.brix === null ? "null" : args.brix;
  const src = args.source ?? "manual";
  const lat = args.lat === undefined ? NEAR_LAT : args.lat === null ? "null" : args.lat;
  const lng = args.lng === undefined ? NEAR_LNG : args.lng === null ? "null" : args.lng;
  const occ = args.occurredAt ?? "2026-06-21T15:00:00Z";
  const s = args.seq ?? seq();
  const rows = await h.query<{ lot: string }>(
    `select record_weigh_in('${w}','${p}',${args.kg},'${rip}'::ripeness,${brix},
       '${src}',${lat},${lng},'${occ}'::timestamptz,'dev-field',${s},'${args.key}') as lot;`,
  );
  return rows[0].lot;
}

describe("P2-S2 — the genesis weigh-in feeds four systems in one txn", () => {
  let h: Harness;
  let lot: string;
  beforeAll(async () => {
    h = await freshDb();
    await seedFarm(h);
    lot = await weigh(h, { kg: 12.4, key: "k-genesis-1" });
  });
  afterAll(async () => h.close());

  it("(2) PAY+MILL: appends exactly one weigh_event carrying kg/ripeness/lot/crew", async () => {
    const rows = await h.query<{
      n: number;
      kg: string;
      ripeness: string;
      crew_id: string;
      lot_code: string;
    }>(
      `select count(*)::int as n, max(kg) as kg, max(ripeness) as ripeness,
              max(crew_id) as crew_id, max(lot_code) as lot_code
         from weigh_event where worker_id = 'w-pick';`,
    );
    expect(rows[0].n).toBe(1);
    expect(Number(rows[0].kg)).toBeCloseTo(12.4, 3);
    expect(rows[0].ripeness).toBe("ripe");
    expect(rows[0].crew_id).toBeTruthy(); // stamped from the active crew
    expect(rows[0].lot_code).toBe(lot);
  });

  it("(3) TRACEABILITY: mints a JC-NNN lot and a harvests row bound to it", async () => {
    expect(lot).toMatch(/^JC-\d+$/);
    const lots = await h.query<{ n: number }>(
      `select count(*)::int as n from lots where code = '${lot}';`,
    );
    expect(lots[0].n).toBe(1);
    const harv = await h.query<{ n: number; kg: string }>(
      `select count(*)::int as n, max(cherries_kg) as kg
         from harvests where lot_code = '${lot}' and worker_id = 'w-pick';`,
    );
    expect(harv[0].n).toBe(1);
    expect(Number(harv[0].kg)).toBeCloseTo(12.4, 3);
  });

  it("(1) ATTENDANCE: stamps a clock-in presence proof for the picker today", async () => {
    const rows = await h.query<{ n: number; kind: string }>(
      `select count(*)::int as n, max(event_kind) as kind
         from attendance_event where worker_id = 'w-pick';`,
    );
    expect(rows[0].n).toBe(1);
    expect(rows[0].kind).toBe("clock-in");
    // and the derived Phase-1 column was resynced.
    const w = await h.query<{ attendance: string }>(
      `select attendance from workers where id = 'w-pick';`,
    );
    expect(w[0].attendance).toBe("present");
  });
});

describe("P2-S2 — exactly-once on the idempotency_key (replay is one row)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedFarm(h);
  });
  afterAll(async () => h.close());

  it("a replay (same key) returns the same lot and writes nothing twice", async () => {
    const first = await weigh(h, { kg: 9.0, key: "k-replay", seq: 7001 });
    // the outbox replays the SAME envelope — same key, same seq.
    const second = await weigh(h, { kg: 9.0, key: "k-replay", seq: 7001 });
    expect(second).toBe(first);

    const counts = (
      await h.query<{ we: number; ha: number; at: number }>(
        `select
           (select count(*)::int from weigh_event       where idempotency_key = 'k-replay') as we,
           (select count(*)::int from harvests          where lot_code = '${first}')        as ha,
           (select count(*)::int from attendance_event  where worker_id = 'w-pick')          as at;`,
      )
    )[0];
    expect(counts.we).toBe(1);
    expect(counts.ha).toBe(1); // the minter's origin harvest, once
    expect(counts.at).toBe(1);
  });
});

describe("P2-S2 — kg conserves into the lot (mill-intake reconciliation)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedFarm(h);
  });
  afterAll(async () => h.close());

  it("two weigh-ins on the same plot+day grow ONE lot whose origin_kg = Σ kg", async () => {
    const lot1 = await weigh(h, { kg: 12.4, key: "k-c1", seq: 8001 });
    const lot2 = await weigh(h, {
      worker: "w-pick",
      kg: 7.6,
      key: "k-c2",
      seq: 8002,
      occurredAt: "2026-06-21T16:00:00Z",
    });
    expect(lot2).toBe(lot1); // same plot+day → same lot

    const rec = await h.query<{ weigh_kg: string; origin_kg: string; reconciles: boolean }>(
      `select weigh_kg, origin_kg, reconciles
         from v_lot_weigh_reconciliation where lot_code = '${lot1}';`,
    );
    expect(Number(rec[0].weigh_kg)).toBeCloseTo(20.0, 3);
    expect(Number(rec[0].origin_kg)).toBeCloseTo(20.0, 3);
    expect(rec[0].reconciles).toBe(true);
  });

  it("rejects a negative kg (hard CHECK, fail-closed)", async () => {
    await expect(
      weigh(h, { kg: -1, key: "k-neg", seq: 8003 }),
    ).rejects.toThrow();
  });
});

describe("P2-S2 — geofence is a SIGNAL, never a gate", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedFarm(h);
  });
  afterAll(async () => h.close());

  it("an in-range fix flags geofence_ok=true", async () => {
    await weigh(h, { kg: 5, key: "k-near", seq: 9001, lat: NEAR_LAT, lng: NEAR_LNG });
    const r = await h.query<{ geofence_ok: boolean }>(
      `select geofence_ok from weigh_event where idempotency_key = 'k-near';`,
    );
    expect(r[0].geofence_ok).toBe(true);
  });

  it("an OUT-OF-RANGE fix still SUCCEEDS but flags geofence_ok=false (never rejected)", async () => {
    const lot = await weigh(h, { kg: 5, key: "k-far", seq: 9002, lat: FAR_LAT, lng: FAR_LNG });
    expect(lot).toMatch(/^JC-\d+$/); // the weigh-in landed
    const r = await h.query<{ geofence_ok: boolean }>(
      `select geofence_ok from weigh_event where idempotency_key = 'k-far';`,
    );
    expect(r[0].geofence_ok).toBe(false); // flagged, not blocked
  });

  it("a missing GPS fix leaves geofence_ok NULL (can't tell, don't pretend)", async () => {
    await weigh(h, { kg: 5, key: "k-nogps", seq: 9003, lat: null, lng: null });
    const r = await h.query<{ geofence_ok: boolean | null }>(
      `select geofence_ok from weigh_event where idempotency_key = 'k-nogps';`,
    );
    expect(r[0].geofence_ok).toBeNull();
  });
});

describe("P2-S2 — the crew-member gate + append-only immutability", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedFarm(h);
  });
  afterAll(async () => h.close());

  it("refuses a worker with no active crew membership", async () => {
    await expect(
      weigh(h, { worker: "w-loose", kg: 5, key: "k-loose", seq: 9101 }),
    ).rejects.toThrow(/not an active crew member/);
  });

  it("UPDATE on weigh_event raises (append-only)", async () => {
    await weigh(h, { kg: 5, key: "k-imm", seq: 9102 });
    await expect(
      h.query(`update weigh_event set kg = 999 where idempotency_key = 'k-imm';`),
    ).rejects.toThrow(/append-only|immutable/);
  });

  it("DELETE on weigh_event raises (append-only)", async () => {
    await expect(
      h.query(`delete from weigh_event where idempotency_key = 'k-imm';`),
    ).rejects.toThrow(/append-only|immutable/);
  });
});

describe("P2-S2 — AD-8 grant posture (authenticated reads; anon reads nothing)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedFarm(h);
    await weigh(h, { kg: 5, key: "k-grant", seq: 9201 });
  });
  afterAll(async () => h.close());

  it("authenticated reads weigh_event + the views", async () => {
    await asAuthenticated(h, async (hh) => {
      const a = await hh.query<{ n: number }>(`select count(*)::int as n from weigh_event;`);
      expect(a[0].n).toBeGreaterThan(0);
      const b = await hh.query<{ n: number }>(
        `select count(*)::int as n from v_weigh_today_by_picker;`,
      );
      expect(b[0].n).toBeGreaterThanOrEqual(0);
    });
  });

  it("anon cannot read weigh_event (SELECT grant never issued)", async () => {
    await asAnon(h, async (hh) => {
      await expect(hh.query(`select 1 from weigh_event;`)).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  it("record_weigh_in executes for authenticated", async () => {
    await asAuthenticated(h, async (hh) => {
      const r = await hh.query<{ lot: string }>(
        `select record_weigh_in('w-pick','p-weigh',3.3,'ripe'::ripeness,null,'manual',
           ${NEAR_LAT},${NEAR_LNG},'2026-06-21T17:00:00Z'::timestamptz,'dev-field',9202,'k-auth') as lot;`,
      );
      expect(r[0].lot).toMatch(/^JC-\d+$/);
    });
  });
});
