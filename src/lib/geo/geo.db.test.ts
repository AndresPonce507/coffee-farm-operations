// DB substrate proof for the plot-geometry slice (S1).
//
// Replays the REAL migrations in PGlite (no PostGIS — geometry lives in plain
// jsonb GeoJSON, see 20260621090000_plot_geometry.sql) and proves:
//   1. the migration set replays cleanly,
//   2. plots gained geom/centroid/DEM columns (geom is valid GeoJSON Polygon),
//   3. reserve_zones exists, holds the 200-ha reserve, and follows the
//      authenticated-only RLS+grant posture: authenticated can SELECT it, anon
//      cannot (its grant was never given / RLS gates it).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  asAnon,
  asAuthenticated,
  freshDb,
  type Harness,
} from "@/test/db/pgliteHarness";

const here = dirname(fileURLToPath(import.meta.url));
// src/lib/geo -> repo root -> supabase/seed.sql
const SEED_SQL = join(here, "..", "..", "..", "supabase", "seed.sql");

let h: Harness;

beforeAll(async () => {
  // Replay migrations (schema + reserve seed + idempotent plot-geom fix-up), then
  // apply the generated seed.sql — the realistic fresh-DB flow (migrations first,
  // then seed). The seed carries plot rows WITH placeholder geom.
  h = await freshDb();
  await h.db.exec(readFileSync(SEED_SQL, "utf8"));
});

afterAll(async () => {
  await h?.close();
});

describe("plot geometry migration", () => {
  it("adds the geometry + DEM columns to plots", async () => {
    const cols = await h.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'plots'`,
    );
    const names = cols.map((c) => c.column_name);
    for (const c of [
      "geom",
      "centroid",
      "elevation_min_m",
      "elevation_mean_m",
      "elevation_max_m",
      "slope_deg_mean",
      "aspect_deg_mean",
    ]) {
      expect(names).toContain(c);
    }
  });

  it("seeds a valid GeoJSON Polygon geom for every plot", async () => {
    const rows = await h.query<{
      id: string;
      gtype: string;
      ncoords: number;
      ctype: string;
    }>(
      `select id,
              geom->>'type'            as gtype,
              jsonb_array_length(geom->'coordinates'->0) as ncoords,
              centroid->>'type'        as ctype
       from plots`,
    );
    expect(rows.length).toBe(10);
    for (const r of rows) {
      expect(r.gtype).toBe("Polygon");
      // closed ring => 5 vertices (4 corners + repeated first)
      expect(Number(r.ncoords)).toBe(5);
      expect(r.ctype).toBe("Point");
    }
  });

  it("DEM scalar columns are left null (derived offline later)", async () => {
    const [row] = await h.query<{ nulls: number }>(
      `select count(*)::int as nulls from plots
       where elevation_mean_m is not null or slope_deg_mean is not null`,
    );
    expect(Number(row.nulls)).toBe(0);
  });
});

describe("migration geom fix-up (live-DB path)", () => {
  // The migration's `update plots set geom=…` statements exist to backfill a live
  // DB that was seeded BEFORE this migration (in a fresh replay they no-op because
  // plots aren't seeded yet). Prove they actually set geom and are idempotent.
  it("backfills geom on a plot and is idempotent on re-run", async () => {
    const stmt =
      `update plots set geom = '{"type":"Polygon","coordinates":[[[-82.641276,8.776908],[-82.639413,8.776908],[-82.639413,8.778761],[-82.641276,8.778761],[-82.641276,8.776908]]]}'::jsonb, centroid = '{"type":"Point","coordinates":[-82.640344,8.777835]}'::jsonb where id = 'p-tizingal-alto';`;

    // wipe geom to simulate a pre-migration row, then apply the fix-up twice.
    await h.db.exec(
      "update plots set geom = null, centroid = null where id = 'p-tizingal-alto';",
    );
    await h.db.exec(stmt);
    await h.db.exec(stmt); // idempotent

    const [row] = await h.query<{ gtype: string; ctype: string }>(
      `select geom->>'type' as gtype, centroid->>'type' as ctype
       from plots where id = 'p-tizingal-alto'`,
    );
    expect(row.gtype).toBe("Polygon");
    expect(row.ctype).toBe("Point");
  });
});

describe("reserve_zones", () => {
  it("exists and holds the ~200-ha reserve row", async () => {
    const rows = await h.query<{
      id: string;
      kind: string;
      area_ha: string;
      gtype: string;
    }>(
      `select id, kind, area_ha, geom->>'type' as gtype from reserve_zones`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0].gtype).toBe("Polygon");
    expect(Number(rows[0].area_ha)).toBeGreaterThan(150);
    expect(Number(rows[0].area_ha)).toBeLessThan(260);
  });

  it("authenticated may SELECT reserve_zones", async () => {
    const rows = await asAuthenticated(h, (hh) =>
      hh.query<{ n: number }>("select count(*)::int as n from reserve_zones"),
    );
    expect(Number(rows[0].n)).toBe(1);
  });

  it("anon may NOT SELECT reserve_zones (no grant / RLS gate)", async () => {
    await expect(
      asAnon(h, (hh) => hh.query("select * from reserve_zones")),
    ).rejects.toThrow();
  });
});
