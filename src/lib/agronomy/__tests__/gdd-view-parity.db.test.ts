// P2-S8 review MED idx 22 — the "same numbers" contract, ENFORCED (not asserted in
// a comment). gdd.ts's own header promises that "the v_harvest_readiness SQL view,
// the /plan UI, and S5 dispatch can all reason about the same numbers." That promise
// was previously unmet: readiness/predicted-ready math is implemented TWICE — once in
// the SQL view (migration 20260622100000) which the UI + S5 dispatch actually read,
// and once in the pure-TS gdd.ts which had zero production callers — and the two had
// already DRIFTED on the predicted-ready-date formula (TS used the FULL gdd_to_cherry
// over a caller rate; SQL used the REMAINING gdd over a nominal /50, plus a ceil'd
// stagger). This test replays the REAL migration in PGlite, reads readiness +
// predicted_ready_date off v_harvest_readiness, runs the SAME inputs through gdd.ts,
// and asserts they agree — turning the contract into an enforced equivalence so the
// two implementations can never silently diverge again. A future tweak to one side
// that isn't mirrored in the other now fails THIS test rather than shipping a /plan
// page that shows different numbers than the unit tests "prove".
//
// Runs in the `db` project (node + PGlite). On the PRE-FIX gdd.ts (full-gdd numerator,
// fractional stagger, ISO-floor) the predicted-date assertions FAIL — verified by
// running this against the parent revision.

import { describe, expect, it, beforeAll, afterAll } from "vitest";

import { predictReadyDate, readinessScore } from "@/lib/agronomy/gdd";
import { freshDb, type Harness } from "@/test/db/pgliteHarness";

/** Seed the gradient plots the view ranks (floor 1360 … ceiling 1700). */
async function seedPlots(h: Harness): Promise<void> {
  await h.query(`
    insert into plots (id, ord, name, block, variety, area_ha, altitude_masl, trees,
                       shade_pct, established_year, status, last_inspected,
                       expected_yield_kg, harvested_kg) values
      ('p-cuesta-piedra', 8, 'Cuesta de Piedra', 'Block E', 'Catuaí', 4.4, 1360, 16500, 33, 2010, 'watch',   '2026-06-13', 19800, 11200),
      ('p-talamanca',     2, 'Talamanca',        'Block B', 'Caturra',6.5, 1520, 24500, 40, 2009, 'healthy', '2026-06-19', 31000, 22800),
      ('p-las-lagunas',   6, 'Las Lagunas',      'Block D', 'Geisha', 2.6, 1700,  8600, 60, 2018, 'healthy', '2026-06-19',  9800,  6500)
    on conflict (id) do nothing;
  `);
}

interface ViewRow {
  plot_id: string;
  altitude_masl: number;
  bloom_date: string | null; // ISO yyyy-mm-dd via to_char
  gdd_accumulated: number;
  gdd_to_cherry: number;
  ndvi_latest: number | null;
  readiness: number;
  predicted_ready_date: string | null; // ISO yyyy-mm-dd via to_char
}

// PGlite returns `date` columns as JS Date objects, which stringify to a locale
// form ("Tue Feb 03"). The existing P2-S8 db tests read dates via to_char so the
// row carries a clean ISO string; mirror that so the comparison is apples-to-apples.
const VIEW_SELECT = `
  select plot_id, altitude_masl,
         to_char(bloom_date, 'YYYY-MM-DD')           as bloom_date,
         gdd_accumulated, gdd_to_cherry, ndvi_latest, readiness,
         to_char(predicted_ready_date, 'YYYY-MM-DD') as predicted_ready_date
    from v_harvest_readiness
   where plot_id in ('p-cuesta-piedra','p-talamanca','p-las-lagunas')`;

describe("P2-S8 — gdd.ts ↔ v_harvest_readiness 'same numbers' contract (review MED 22)", () => {
  let h: Harness;

  // A spread of fixtures so the equivalence holds across cases, not one lucky point:
  //  - floor plot, partially accrued, NDVI present  (remaining gdd > 0, NDVI nudge up)
  //  - mid plot, GDD met, no NDVI                    (remaining gdd = 0, GDD-only)
  //  - ceiling plot, short of GDD, NDVI present      (big stagger, NDVI nudge down)
  const FIXTURES = [
    { plotId: "p-cuesta-piedra", bloom: "2026-01-15", gddAcc: 1200, ndvi: 0.78 },
    { plotId: "p-talamanca", bloom: "2026-02-01", gddAcc: 2200, ndvi: null },
    { plotId: "p-las-lagunas", bloom: "2026-01-20", gddAcc: 600, ndvi: 0.35 },
  ] as const;

  beforeAll(async () => {
    h = await freshDb();
    await seedPlots(h);
    let seq = 0;
    for (const f of FIXTURES) {
      seq += 1;
      const ndvi = f.ndvi === null ? "null" : String(f.ndvi);
      // gdd_to_cherry left at its 2200 default so the SQL and TS share the same
      // requirement constant (the view's coalesce(...,2200) == GEISHA_BLOOM_TO_CHERRY_GDD).
      await h.query(
        `select record_maturation_signal(
           '${f.plotId}', '${f.bloom}', ${f.gddAcc}, ${ndvi},
           '2026-06-21T12:00:00Z', 'd', ${seq}, 'parity-${f.plotId}'
         );`,
      );
    }
  });
  afterAll(async () => h.close());

  it("readiness from the SQL view equals readinessScore() from gdd.ts (the GDD spine + NDVI nudge)", async () => {
    const rows = await h.query<ViewRow>(`${VIEW_SELECT};`);
    expect(rows.length).toBe(3);

    for (const r of rows) {
      const tsScore = readinessScore({
        gddAccumulated: Number(r.gdd_accumulated),
        gddToCherry: Number(r.gdd_to_cherry),
        altitudeMasl: Number(r.altitude_masl),
        ndviLatest: r.ndvi_latest === null ? null : Number(r.ndvi_latest),
        recentRipenessPct: null,
      });
      // identical math on both sides → agree to floating-point epsilon.
      expect(tsScore).toBeCloseTo(Number(r.readiness), 6);
    }
  });

  it("predicted_ready_date from the SQL view equals predictReadyDate() from gdd.ts (remaining-gdd / nominal-50 / ceil-stagger)", async () => {
    const rows = await h.query<ViewRow>(`${VIEW_SELECT};`);
    expect(rows.length).toBe(3);

    for (const r of rows) {
      // The SQL view's nominal accrual is a hardcoded 50 GDD/day — gdd.ts must be
      // fed the SAME rate to compute the SAME predicted date.
      const tsDate = predictReadyDate(
        r.bloom_date,
        50,
        Number(r.altitude_masl),
        Number(r.gdd_to_cherry),
        Number(r.gdd_accumulated),
      );
      // EXACT day agreement: both compute remaining-gdd/50 (rounded) + ceil(stagger).
      expect(tsDate).toBe(r.predicted_ready_date);
      expect(tsDate).not.toBeNull();
    }
  });
});
