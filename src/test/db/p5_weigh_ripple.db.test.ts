// P5-L0 — Walking-skeleton reactive-spine guards (slice-01 weigh-ripple proof).
//
// These replay the REAL migrations in PGlite and prove the J1 propagation spine the
// walking skeleton SURFACES (it does not build it — facet-01 §0/§5). They are the
// load-bearing guards the whole 100-agent Phase-5 fleet rests on: if the reactive
// graph is NOT actually reactive, the proof panel would be a pretty lie.
//
//   - weigh-ripples-to-two-consumers: ONE record_weigh_in raises BOTH the per-picker
//     weigh tally (v_weigh_today_by_picker.kg_today) AND the Dashboard "today"
//     headline (season_summary_view.today_kg) by the same kg — from the SAME append,
//     no re-entry (registry checkpoint #2; facet-01 §1.2).
//   - season-derives-from-harvests: the Dashboard "today" figure is Σ harvests, so the
//     per-weigh harvests INSERT is LOAD-BEARING — inserting a harvests row directly
//     moves the headline by exactly that kg (proves the view is reactive-on-read).
//   - exactly-once-replay: a replayed weigh on the same idempotency_key applies the
//     today-kg delta ONCE (no double-count) — exactly-once is a DB property the proof
//     panel may trust offline (facet-01 §1.5/§4).
//   - no-deprecated-read: no src/lib/db/* getter selects from a *__deprecated relation
//     (propagation invariant #4 — a getter on a stale aggregate would silently
//     disagree with the harvests truth). Static grep over the real source.
//
// Substrate: the PGlite migration-replay harness (replays the REAL migrations).

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { freshDb, type Harness } from "./pgliteHarness";

// ── Fixtures (mirrors p2s2_weigh_capture.db.test.ts: a plot with a centroid + an
// active-crew picker via _backfill_people). ───────────────────────────────────
const CENTROID = `'{"type":"Point","coordinates":[-82.640344,8.777835]}'::jsonb`;
const PLOT = `insert into plots (id, ord, name, block, variety, area_ha, altitude_masl, trees,
  shade_pct, established_year, status, last_inspected, expected_yield_kg, harvested_kg, geom, centroid)
  values ('p-ripple', 91, 'Ripple Plot', 'Block R', 'Geisha', 4.2, 1690, 14800, 55, 2014, 'healthy',
    '2026-06-18', 18600, 12120,
    '{"type":"Polygon","coordinates":[[[-82.641276,8.776908],[-82.639413,8.776908],[-82.639413,8.778761],[-82.641276,8.778761],[-82.641276,8.776908]]]}'::jsonb,
    ${CENTROID});`;
const WORKERS = `insert into workers (id, name, role, daily_rate_usd, attendance, started_year, phone, today_kg, crew) values
  ('w-rip','Lupita Quintero','Picker',22,'present',2019,'+507 9',0,'Crew Tizingal');`;

const NEAR_LAT = 8.777835;
const NEAR_LNG = -82.640344;

let SEQ = 41000;
const seq = () => SEQ++;

async function seedFarm(h: Harness): Promise<void> {
  await h.query(PLOT);
  await h.query(WORKERS);
  await h.query(`select _backfill_people();`);
}

// "Today" in UTC — the v_weigh_today_by_picker view filters occurred_at::date =
// now()::date, so a weigh that should appear in the per-picker tally MUST occur on
// the real current date (a fixed past date would silently fall out of the view).
const TODAY_UTC = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

/** One weigh-in via the live RPC; returns the bound lot_code. */
async function weigh(
  h: Harness,
  args: { kg: number; occurredAt?: string; seq?: number; key: string },
): Promise<string> {
  const occ = args.occurredAt ?? `${TODAY_UTC}T15:00:00Z`;
  const s = args.seq ?? seq();
  const rows = await h.query<{ lot: string }>(
    `select record_weigh_in('w-rip','p-ripple',${args.kg},'ripe'::ripeness,null,
       'manual',${NEAR_LAT},${NEAR_LNG},'${occ}'::timestamptz,'dev-rip',${s},'${args.key}') as lot;`,
  );
  return rows[0].lot;
}

/** The Dashboard "today" headline figure (season_summary_view.today_kg). */
async function dashboardTodayKg(h: Harness): Promise<number> {
  const r = await h.query<{ today_kg: string }>(
    `select today_kg from season_summary_view where id = 1;`,
  );
  return Number(r[0].today_kg);
}

/** The per-picker weigh tally for w-rip (v_weigh_today_by_picker.kg_today). */
async function pickerTallyKg(h: Harness): Promise<number> {
  const r = await h.query<{ kg_today: string | null }>(
    `select coalesce(sum(kg_today),0)::text as kg_today
       from v_weigh_today_by_picker where worker_id = 'w-rip';`,
  );
  return Number(r[0].kg_today);
}

describe("P5-L0 — weigh-ripples-to-two-consumers (the walking-skeleton ripple)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedFarm(h);
  });
  afterAll(async () => h.close());

  it("ONE record_weigh_in raises BOTH the picker tally AND the Dashboard 'today' by the same kg", async () => {
    const tallyBefore = await pickerTallyKg(h);
    const dashBefore = await dashboardTodayKg(h);

    await weigh(h, { kg: 18.4, key: "p5-r1" }); // defaults to today (lands in the tally view)

    const tallyAfter = await pickerTallyKg(h);
    const dashAfter = await dashboardTodayKg(h);

    // both downstream consumers moved by the SAME 18.4 kg, from the SAME append.
    expect(tallyAfter - tallyBefore).toBeCloseTo(18.4, 3);
    expect(dashAfter - dashBefore).toBeCloseTo(18.4, 3);
  });
});

describe("P5-L0 — season-derives-from-harvests (the per-weigh harvests INSERT is load-bearing)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedFarm(h);
    // mint a lot so a direct harvests row has a valid lot_code FK target (today).
    await weigh(h, { kg: 5.0, key: "p5-seed" });
  });
  afterAll(async () => h.close());

  it("inserting a harvests row on the latest day raises season_summary_view.today_kg by exactly that kg", async () => {
    // the lot the seed weigh minted today.
    const lotRow = await h.query<{ code: string }>(
      `select code from lots where stage = 'cherry' order by code desc limit 1;`,
    );
    const lot = lotRow[0].code;

    const before = await dashboardTodayKg(h);

    // a direct harvests INSERT on the SAME (max) date the view sums over (today).
    await h.query(
      `insert into harvests (id, date, plot_id, worker_id, cherries_kg, ripeness_pct, brix_avg, lot_code)
         values ('h-derive-1', '${TODAY_UTC}', 'p-ripple', 'w-rip', 9.3, 100, 18, '${lot}');`,
    );

    const after = await dashboardTodayKg(h);
    // the headline is Σ harvests for max(date) → it moved by exactly the inserted kg.
    expect(after - before).toBeCloseTo(9.3, 3);
  });

  it("the headline equals Σ cherries_kg over harvests on the latest date (no hidden source)", async () => {
    const view = await dashboardTodayKg(h);
    const sum = await h.query<{ s: string }>(
      `select coalesce(sum(cherries_kg),0)::text as s from harvests
         where date = (select max(date) from harvests);`,
    );
    expect(view).toBeCloseTo(Number(sum[0].s), 3);
  });
});

describe("P5-L0 — exactly-once-replay (a replayed weigh does not double-count the headline)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedFarm(h);
  });
  afterAll(async () => h.close());

  it("draining the same idempotency_key twice moves the Dashboard 'today' by the kg ONCE", async () => {
    const before = await dashboardTodayKg(h);

    // first apply
    const lot1 = await weigh(h, { kg: 12.0, key: "p5-replay", seq: 42001 });
    // an outbox replay of the SAME envelope (same key + seq) — exactly-once at the DB.
    const lot2 = await weigh(h, { kg: 12.0, key: "p5-replay", seq: 42001 });
    expect(lot2).toBe(lot1); // same bound lot

    const after = await dashboardTodayKg(h);
    // +12, NOT +24 — the replay no-op'd the today-kg side-effect.
    expect(after - before).toBeCloseTo(12.0, 3);

    // and exactly one weigh_event / one harvests row landed for the key/lot.
    const counts = (
      await h.query<{ we: number; ha: number }>(
        `select
           (select count(*)::int from weigh_event where idempotency_key = 'p5-replay') as we,
           (select count(*)::int from harvests where lot_code = '${lot1}') as ha;`,
      )
    )[0];
    expect(counts.we).toBe(1);
    expect(counts.ha).toBe(1);
  });
});

describe("P5-L0 — no-deprecated-read (no getter reads a *__deprecated relation)", () => {
  // Propagation invariant #4: a getter on a stale hand-authored aggregate would
  // silently disagree with the harvests truth. The deprecated tables were renamed
  // aside (…093000) precisely so a stray read FAILS loud — this guard asserts no
  // src/lib/db/* getter selects from one. Static grep over the REAL source (no DB).
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const DB_DIR = join(__dirname, "..", "..", "lib", "db");

  /** Recursively collect every .ts source file under src/lib/db. */
  function tsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...tsFiles(full));
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        out.push(full);
      }
    }
    return out;
  }

  it("no src/lib/db getter references a '__deprecated' relation", () => {
    const offenders: string[] = [];
    for (const file of tsFiles(DB_DIR)) {
      const src = readFileSync(file, "utf8");
      if (/__deprecated/.test(src)) offenders.push(file);
    }
    expect(offenders, `getters reading a *__deprecated relation: ${offenders.join(", ")}`).toEqual(
      [],
    );
  });

  it("the guard actually exercises its target (the deprecated relations exist to be avoided)", async () => {
    // Guardrail discipline (global Rule 5): prove the guard isn't dead — the
    // *__deprecated relations really were renamed aside in the migrations, so the
    // grep above is checking against a real hazard, not nothing.
    const h = await freshDb();
    try {
      const r = await h.query<{ n: number }>(
        `select count(*)::int as n from pg_class
           where relname like '%\\_\\_deprecated';`,
      );
      expect(r[0].n).toBeGreaterThan(0);
    } finally {
      await h.close();
    }
  });
});
