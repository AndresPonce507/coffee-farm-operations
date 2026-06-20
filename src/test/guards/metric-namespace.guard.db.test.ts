/**
 * Metric-namespace LINT GUARD  (S4 — derived-metrics semantic layer, ADR-003)
 * ===========================================================================
 * A build-failing LOCAL guard (this project runs no CI — see CLAUDE.md). It is
 * the enforcement teeth behind the S4 seam: the four derived metric views are
 * the *only* sanctioned source the data-access getters may read for harvest
 * aggregates. The hand-authored raw aggregate tables that pre-date the views
 * (`daily_cherries`, `weekly_harvest`, `variety_shares`, `season_summary`)
 * still physically exist in the init migration (left in place, harmless), so
 * nothing stops a future edit from quietly pointing a getter back at the stale
 * seeded numbers instead of the live-computed view — re-introducing the exact
 * "dashboard doesn't reflect real writes" bug the views were built to kill
 * (AD-4 honest provenance). This guard greps the getters and fails loudly if
 * that ever happens.
 *
 * What it FAILS on (a getter `.from()`-ing any of these in src/lib/db/*.ts):
 *   1. A RAW AGGREGATE COUNTERPART of a sanctioned metric view — i.e. the
 *      stem of a `*_view` that is a pure hand-authored aggregate table
 *      (daily_cherries / weekly_harvest / variety_shares / season_summary).
 *      The getter must read `<name>_view`, never the raw `<name>`.
 *   2. Any `*__deprecated` table name (a renamed-aside table reappearing).
 *   3. Any explicitly dropped / renamed-aside aggregate name.
 *
 * What it deliberately does NOT flag: legitimate raw reads of anchor /
 * operational tables that are not metric aggregates — `plots` (geo.ts reads
 * raw plot coordinates for the map), `processing_batches`, `lots`, `weather`,
 * `activity`, etc. Those have no derived-view counterpart in the metric
 * namespace, so reading them raw is correct.
 *
 * Runs under the `db` vitest project (node env): it reads source files off
 * disk and greps them — no jsdom, no Supabase client. Named `*.db.test.ts` so
 * the existing vitest projects config (which only includes
 * `src/**\/__tests__/**` for ui and `src/**\/*.db.test.ts` for db) actually
 * picks it up; the guard logic is path-agnostic.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

const DB_DIR = fileURLToPath(new URL("../../lib/db", import.meta.url));

/**
 * The sanctioned derived-metric views: the S4 aggregate seam. These are the
 * ONLY names a getter may read for harvest aggregates. (plots_view /
 * workers_view / harvests_view / tasks_view are also sanctioned views, but
 * their *raw* stems are real anchor/operational tables with legitimate raw
 * reads elsewhere, so they are not part of the forbidden-raw set below.)
 */
const SANCTIONED_METRIC_VIEWS = [
  "daily_cherries_view",
  "weekly_harvest_view",
  "variety_shares_view",
  "season_summary_view",
] as const;

/**
 * Raw aggregate counterparts derived from the sanctioned metric views (strip
 * the `_view` suffix). Reading any of these directly = bypassing the view =
 * stale seeded numbers. This is the core forbidden set.
 */
const RAW_AGGREGATE_COUNTERPARTS = SANCTIONED_METRIC_VIEWS.map((v) =>
  v.replace(/_view$/, ""),
);

/**
 * Names that were dropped / renamed aside and must never reappear as a
 * `.from()` target. Kept as an explicit, extensible blocklist so a future
 * rename-aside (e.g. `season_summary__old`) is caught the moment it lands.
 */
const RETIRED_AGGREGATE_NAMES = [
  // explicit historical / hypothetical retirements
  "season_summary_v1",
  "daily_cherries_old",
] as const;

/** Read every getter source file in src/lib/db. */
function readDbSources(): { file: string; text: string }[] {
  return readdirSync(DB_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
    .map((f) => ({
      file: path.join(DB_DIR, f),
      text: readFileSync(path.join(DB_DIR, f), "utf8"),
    }));
}

/**
 * Extract every `.from("<name>")` (or single-quoted / backtick) target from a
 * source string. Returns the bare table/view name strings.
 */
function extractFromTargets(text: string): string[] {
  const targets: string[] = [];
  const re = /\.from\(\s*(['"`])([^'"`]+)\1\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    targets.push(m[2]);
  }
  return targets;
}

/** Decide whether a `.from()` target is a forbidden metric-namespace read. */
function classifyTarget(target: string): string | null {
  if ((RAW_AGGREGATE_COUNTERPARTS as readonly string[]).includes(target)) {
    return `reads RAW aggregate table "${target}" — must read the sanctioned view "${target}_view" instead`;
  }
  if (/__deprecated$/.test(target)) {
    return `reads deprecated table "${target}" (a *__deprecated name must never be a getter source)`;
  }
  if ((RETIRED_AGGREGATE_NAMES as readonly string[]).includes(target)) {
    return `reads retired/renamed-aside aggregate table "${target}"`;
  }
  return null;
}

describe("metric-namespace guard (S4 derived-metrics seam)", () => {
  const sources = readDbSources();

  it("there are db getter sources to scan (the guard is not silently no-op'ing)", () => {
    expect(sources.length).toBeGreaterThan(0);
    // trends.ts holds the four metric getters; it MUST be present or the guard
    // is scanning the wrong place.
    expect(sources.map((s) => path.basename(s.file))).toContain("trends.ts");
  });

  it("every getter reads its sanctioned derived view, never a raw/deprecated aggregate table", () => {
    const violations: string[] = [];
    for (const { file, text } of sources) {
      for (const target of extractFromTargets(text)) {
        const why = classifyTarget(target);
        if (why) violations.push(`${path.basename(file)}: ${why}`);
      }
    }
    expect(
      violations,
      violations.length
        ? `Metric-namespace violations found:\n  - ${violations.join("\n  - ")}`
        : undefined,
    ).toEqual([]);
  });

  it("the four S4 metric getters specifically read the *_view names (positive lock on the seam)", () => {
    const trends =
      sources.find((s) => path.basename(s.file) === "trends.ts")?.text ?? "";
    const targets = extractFromTargets(trends);
    for (const view of SANCTIONED_METRIC_VIEWS) {
      expect(
        targets,
        `trends.ts must read "${view}" (the sanctioned derived view), not its raw counterpart`,
      ).toContain(view);
    }
    // and trends.ts must NOT read any raw counterpart
    for (const raw of RAW_AGGREGATE_COUNTERPARTS) {
      expect(
        targets,
        `trends.ts must NOT read the raw aggregate table "${raw}"`,
      ).not.toContain(raw);
    }
  });

  /**
   * GUARD SELF-CHECK — proves the classifier WOULD fail on a regression. This
   * is the "watch it fail for the right reason" evidence baked into the file:
   * the classifier flags a raw read, a __deprecated read, and a retired name,
   * and PASSES a legitimate raw operational read (plots, processing_batches).
   * If this ever goes green-by-accident (classifier neutered), it trips here
   * instead of silently letting a real getter regression through.
   */
  describe("classifier self-check (regression sentinels)", () => {
    it("flags a getter that reads a RAW aggregate counterpart", () => {
      expect(classifyTarget("season_summary")).toMatch(/RAW aggregate/);
      expect(classifyTarget("daily_cherries")).toMatch(/RAW aggregate/);
      expect(classifyTarget("weekly_harvest")).toMatch(/RAW aggregate/);
      expect(classifyTarget("variety_shares")).toMatch(/RAW aggregate/);
    });

    it("flags a *__deprecated table reappearing as a source", () => {
      expect(classifyTarget("season_summary__deprecated")).toMatch(
        /deprecated/,
      );
    });

    it("flags a retired / renamed-aside aggregate name", () => {
      expect(classifyTarget("season_summary_v1")).toMatch(/retired/);
    });

    it("does NOT flag legitimate raw operational/anchor reads", () => {
      expect(classifyTarget("plots")).toBeNull(); // geo.ts map coords
      expect(classifyTarget("processing_batches")).toBeNull();
      expect(classifyTarget("lots")).toBeNull();
      expect(classifyTarget("weather")).toBeNull();
      expect(classifyTarget("activity")).toBeNull();
    });

    it("does NOT flag the sanctioned views themselves", () => {
      for (const view of SANCTIONED_METRIC_VIEWS) {
        expect(classifyTarget(view)).toBeNull();
      }
      expect(classifyTarget("plots_view")).toBeNull();
      expect(classifyTarget("harvests_view")).toBeNull();
    });
  });
});
