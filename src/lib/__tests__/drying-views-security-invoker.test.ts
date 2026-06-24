import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Cross-tenant safety guard — the drying-station dossier reads three VIEWS and relies
 * ENTIRELY on RLS for tenant isolation. That only holds if each view is
 * `security_invoker = on` (runs under the CALLER's RLS); a default view runs as owner
 * and BYPASSES RLS → a silent cross-tenant leak (a user opening another tenant's
 * station id would see its name/capacity/lots).
 *
 * This guard fails the suite if any `create view <name>` for these three drops the
 * `security_invoker = on` clause — making the security invariant regression-proof.
 * (Flagged by the drying-station security review as the single point of failure.)
 */
const VIEWS = ["station_occupancy", "v_drying_weather_risk", "v_reposo_status"];

function allMigrationSql(): string {
  const dir = join(process.cwd(), "supabase", "migrations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");
}

describe("drying dossier views are security_invoker (RLS-respecting)", () => {
  const sql = allMigrationSql();

  it.each(VIEWS)("view %s is created with security_invoker = on (never owner-RLS-bypassing)", (view) => {
    // every `create [or replace] view <view>` must carry a `with (... security_invoker = on ...)`
    const creates = [
      ...sql.matchAll(
        new RegExp(
          `create\\s+(?:or\\s+replace\\s+)?view\\s+(?:public\\.)?${view}\\b([\\s\\S]*?)\\bas\\b`,
          "gi",
        ),
      ),
    ];
    expect(creates.length, `no create-view found for ${view}`).toBeGreaterThan(0);
    for (const m of creates) {
      const head = m[1];
      expect(
        /with\s*\([^)]*security_invoker\s*=\s*on[^)]*\)/i.test(head),
        `create view ${view} must declare "with (security_invoker = on)" — else it bypasses caller RLS (cross-tenant leak)`,
      ).toBe(true);
    }
  });
});
