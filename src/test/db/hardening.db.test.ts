// 20260621100000_db_hardening verification — closes two gaps the earlier
// migrations left:
//   (1) the dead `grant select … to anon` on the six computed-aggregate views
//       (20260620170000). anon is already blocked by security_invoker + revoked
//       table grants — verified 401 in prod — but the grant is misleading, so we
//       revoke it. The migration also belt-and-suspenders revokes anon on the two
//       init-era detail views (harvests_view, tasks_view); those already lost their
//       anon SELECT in 20260620140000, so that half is a harmless no-op — but we
//       assert all eight here so the whole revoke is locked. authenticated KEEPS
//       its SELECT on every view (the app reads as authenticated).
//   (2) CHECK-coverage holes write_foundation + plot_geometry never filled:
//       the season inputs (on farm_season_config via 20260621101000), the
//       plot-geometry columns (slope/aspect/elevation ordering — currently all
//       NULL, so these are forward guards), plots.harvested_kg and workers.today_kg.
//
// Replays the REAL migrations in PGlite (no DB round-trip), so the invariants are
// proven against the exact SQL that ships.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDb, type Harness } from "./pgliteHarness";

// All eight views the migration revokes anon from: the six computed-aggregate
// views (granted to anon in 20260620170000) plus the two init detail views.
const REVOKED_VIEWS = [
  "plots_view",
  "workers_view",
  "variety_shares_view",
  "daily_cherries_view",
  "weekly_harvest_view",
  "season_summary_view",
  "harvests_view",
  "tasks_view",
];

describe("DB hardening — dead anon view grants removed", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
  });
  afterAll(async () => {
    await h.close();
  });

  for (const v of REVOKED_VIEWS) {
    it(`anon holds NO SELECT on ${v}`, async () => {
      const [row] = await h.query<{ has: boolean }>(
        `select has_table_privilege('anon', '${v}', 'SELECT') as has`,
      );
      expect(row.has).toBe(false);
    });

    it(`authenticated KEEPS SELECT on ${v} (read path intact)`, async () => {
      const [row] = await h.query<{ has: boolean }>(
        `select has_table_privilege('authenticated', '${v}', 'SELECT') as has`,
      );
      expect(row.has).toBe(true);
    });
  }
});

describe("DB hardening — CHECK coverage holes filled", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
  });
  afterAll(async () => {
    await h.close();
  });

  // Season inputs now live in farm_season_config (S4 renamed season_summary aside);
  // the non-negative guards moved there in 20260621101000. The migration seeds the
  // id=1 singleton, so we probe the constraints by UPDATE-ing it.
  it("rejects a negative farm_season_config target", async () => {
    await expect(
      h.query(`update farm_season_config set target_kg = -1 where id = 1`),
    ).rejects.toThrow(/check|nonneg/i);
  });

  it("rejects a negative farm_season_config revenue", async () => {
    await expect(
      h.query(`update farm_season_config set ytd_revenue_usd = -1 where id = 1`),
    ).rejects.toThrow(/check|nonneg/i);
  });

  it("accepts a valid farm_season_config update (constraints aren't over-tight)", async () => {
    const rows = await h.query(
      `update farm_season_config set target_kg = 200000, ytd_revenue_usd = 500000
       where id = 1 returning id`,
    );
    expect(rows).toHaveLength(1);
  });

  it("rejects an out-of-range plot slope (geometry forward-guard)", async () => {
    await expect(
      h.query(
        `insert into plots
          (id, ord, name, block, variety, area_ha, altitude_masl, trees, shade_pct,
           established_year, status, last_inspected, expected_yield_kg, harvested_kg, slope_deg_mean)
         values
          ('p-slope', 1, 'S', 'B1', 'Geisha', 1.5, 1600, 800, 35, 2012,
           'healthy', '2026-01-01', 1500, 600, 200)`,
      ),
    ).rejects.toThrow(/check|slope/i);
  });

  it("rejects an out-of-range plot aspect (geometry forward-guard)", async () => {
    await expect(
      h.query(
        `insert into plots
          (id, ord, name, block, variety, area_ha, altitude_masl, trees, shade_pct,
           established_year, status, last_inspected, expected_yield_kg, harvested_kg, aspect_deg_mean)
         values
          ('p-aspect', 4, 'A', 'B1', 'Geisha', 1.5, 1600, 800, 35, 2012,
           'healthy', '2026-01-01', 1500, 600, 400)`,
      ),
    ).rejects.toThrow(/check|aspect/i);
  });

  it("rejects elevation columns out of order (min > max)", async () => {
    await expect(
      h.query(
        `insert into plots
          (id, ord, name, block, variety, area_ha, altitude_masl, trees, shade_pct,
           established_year, status, last_inspected, expected_yield_kg, harvested_kg,
           elevation_min_m, elevation_max_m)
         values
          ('p-elev', 3, 'E', 'B1', 'Geisha', 1.5, 1600, 800, 35, 2012,
           'healthy', '2026-01-01', 1500, 600, 1800, 1500)`,
      ),
    ).rejects.toThrow(/check|elev/i);
  });

  it("rejects elevation mean above max (inner sub-clause)", async () => {
    await expect(
      h.query(
        `insert into plots
          (id, ord, name, block, variety, area_ha, altitude_masl, trees, shade_pct,
           established_year, status, last_inspected, expected_yield_kg, harvested_kg,
           elevation_mean_m, elevation_max_m)
         values
          ('p-elev2', 5, 'E2', 'B1', 'Geisha', 1.5, 1600, 800, 35, 2012,
           'healthy', '2026-01-01', 1500, 600, 2000, 1500)`,
      ),
    ).rejects.toThrow(/check|elev/i);
  });

  it("accepts a plot with sane, ordered geometry", async () => {
    const rows = await h.query(
      `insert into plots
        (id, ord, name, block, variety, area_ha, altitude_masl, trees, shade_pct,
         established_year, status, last_inspected, expected_yield_kg, harvested_kg,
         slope_deg_mean, aspect_deg_mean, elevation_min_m, elevation_mean_m, elevation_max_m)
       values
        ('p-ok', 2, 'OK', 'B1', 'Geisha', 1.5, 1600, 800, 35, 2012,
         'healthy', '2026-01-01', 1500, 600, 18, 200, 1500, 1600, 1700)
       returning id`,
    );
    expect(rows).toHaveLength(1);
  });

  it("rejects negative workers.today_kg", async () => {
    await expect(
      h.query(
        `insert into workers
          (id, name, role, daily_rate_usd, attendance, started_year, phone, today_kg, crew)
         values
          ('w-neg', 'X', 'Picker', 20, 'present', 2012, '000', -5, 'A')`,
      ),
    ).rejects.toThrow(/check|nonneg/i);
  });
});
