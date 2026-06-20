// S4 — derived-metrics semantic layer (ADR-003 + AD-4 honest provenance):
//
// The four derived views (daily/weekly/variety/season) already compute from the
// harvests the owner logs. S4 closes the last gap: the season HEADLINE still mixed
// genuine INPUTS (target_kg goal, ytd_revenue_usd) — which are real inputs, not
// derived numbers — with computed harvested/today figures by reading a hand-authored
// `season_summary` table. S4 moves those inputs into a `farm_season_config` singleton
// (a goal is an input, owned in ONE place), rewires season_summary_view to read the
// config for inputs while still SUMMING harvested/today from harvests, and renames
// aside (NOT drops — one-line rollback) every base aggregate table no view/getter
// reads anymore.
//
// These tests replay the REAL migrations in PGlite as the authenticated role, so they
// exercise the live posture. They prove:
//   - the getSeason()-shaped query == hand-summed seed (target from config; harvested
//     /today summed from harvests).
//   - TRUST REGRESSION (executable): a fixture where a deprecated base table DISAGREES
//     with harvests truth — the live view follows harvests and CANNOT show the stale
//     number. The defect is structurally dead.
//   - the renamed-aside base tables are gone under their OLD names (a getter .from() of
//     an old aggregate name would now error).
//   - AD-8 grant posture: config + view are SELECT-granted to authenticated, anon reads
//     nothing, no write grants leak.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asAuthenticated, freshDb, type Harness } from "./pgliteHarness";

// Minimal harvest fixture: 2 plots, 1 worker, lots, and harvests across three days.
// today = the max date in the fixture. Hand-summed truth:
//   harvested_kg = 100 + 50 + 80 = 230   (all harvests)
//   today_kg     = 80                     (only the 2026-06-20 harvest)
// PGlite's prepared-statement query() rejects multi-command SQL, so each insert is a
// separate statement run in order (mirrors the S3 test's fixture pattern).
const EXPECTED_HARVESTED = 230;
const EXPECTED_TODAY = 80;

// The genuine season INPUTS (the goal + modeled revenue) the config holds.
const CONFIG_TARGET = 190000;
const CONFIG_REVENUE = 486500;

async function seedHarvests(h: Harness): Promise<void> {
  await h.query(
    `insert into plots (id, ord, name, block, variety, area_ha, altitude_masl, trees,
       shade_pct, established_year, status, last_inspected, expected_yield_kg, harvested_kg)
     values ('p-a', 0, 'Plot A', 'Block A', 'Geisha', 1.0, 1600, 100, 50, 2015, 'healthy', '2026-06-19', 1000, 0);`,
  );
  await h.query(
    `insert into plots (id, ord, name, block, variety, area_ha, altitude_masl, trees,
       shade_pct, established_year, status, last_inspected, expected_yield_kg, harvested_kg)
     values ('p-b', 1, 'Plot B', 'Block A', 'Caturra', 1.0, 1500, 100, 40, 2016, 'healthy', '2026-06-19', 1000, 0);`,
  );
  await h.query(
    `insert into workers (id, name, role, daily_rate_usd, attendance, started_year, phone, crew)
     values ('w-1', 'Picker One', 'Picker', 22, 'present', 2018, '+507 6000-0001', 'Crew A');`,
  );
  await h.query(`insert into lots (code) values ('JC-101');`);
  await h.query(`insert into lots (code) values ('JC-102');`);
  await h.query(
    `insert into harvests (id, date, plot_id, worker_id, cherries_kg, ripeness_pct, brix_avg, lot_code)
     values ('h-1', '2026-06-18', 'p-a', 'w-1', 100, 95, 22.0, 'JC-101');`,
  );
  await h.query(
    `insert into harvests (id, date, plot_id, worker_id, cherries_kg, ripeness_pct, brix_avg, lot_code)
     values ('h-2', '2026-06-19', 'p-b', 'w-1', 50, 90, 20.0, 'JC-102');`,
  );
  await h.query(
    `insert into harvests (id, date, plot_id, worker_id, cherries_kg, ripeness_pct, brix_avg, lot_code)
     values ('h-3', '2026-06-20', 'p-a', 'w-1', 80, 96, 23.0, 'JC-101');`,
  );
}

async function seedConfig(h: Harness): Promise<void> {
  // The migration already seeds the id=1 config singleton; upsert so the test owns
  // its expected values regardless of the seeded defaults (here they coincide).
  await h.query(
    `insert into farm_season_config (id, target_kg, ytd_revenue_usd)
     values (1, ${CONFIG_TARGET}, ${CONFIG_REVENUE})
     on conflict (id) do update
       set target_kg = excluded.target_kg, ytd_revenue_usd = excluded.ytd_revenue_usd;`,
  );
}

describe("S4 derived metrics — season_summary_view reads config for inputs, harvests for totals", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedHarvests(h);
    await seedConfig(h);
  });
  afterAll(async () => h.close());

  it("getSeason()-shaped query == hand-summed seed (target from config, totals from harvests)", async () => {
    const rows = await asAuthenticated(h, (hh) =>
      hh.query<{
        id: number;
        target_kg: string;
        harvested_kg: string;
        today_kg: string;
        ytd_revenue_usd: string;
      }>(`select * from season_summary_view where id = 1;`),
    );
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.id).toBe(1);
    expect(Number(r.target_kg)).toBe(CONFIG_TARGET);
    expect(Number(r.ytd_revenue_usd)).toBe(CONFIG_REVENUE);
    expect(Number(r.harvested_kg)).toBe(EXPECTED_HARVESTED);
    expect(Number(r.today_kg)).toBe(EXPECTED_TODAY);
  });

  it("exposes EXACTLY the column set mapSeason expects (and the id=1 single() contract holds)", async () => {
    const cols = await h.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name = 'season_summary_view' order by column_name;`,
    );
    const names = cols.map((c) => c.column_name).sort();
    expect(names).toEqual(
      ["harvested_kg", "id", "target_kg", "today_kg", "ytd_revenue_usd"].sort(),
    );
  });
});

// ── EXECUTABLE TRUST REGRESSION (a genuine pre-fix/post-fix DELTA) ─────────────
//
// The defect S4 kills: the season HEADLINE inputs (target_kg, ytd_revenue_usd)
// were read from a HAND-AUTHORED `season_summary` table, so a stale/typo'd row in
// that table silently DROVE the headline — it could disagree with the truth and
// nobody would know. S4 moves those inputs into `farm_season_config` and rewires
// the view to read the config, so the season_summary table is structurally
// unreachable.
//
// A real regression test must demonstrate BOTH halves of that delta, on the SAME
// disagreeing fixture (the harness's freshDb({ only }) replays a subset of the
// migration stack — the same falsifiability technique rls-posture.db.test.ts uses):
//
//   1. PRE-S4 (replay through 20260620170000_computed_aggregates, NOT the S4
//      migration): seed the season_summary TABLE with a STALE target that
//      DISAGREES with what the config will later hold, and PROVE the pre-S4 view
//      RETURNS that stale number. This is the bug, reproduced — the test has SEEN
//      the defect, so a later "it's gone" assertion isn't vacuous.
//   2. POST-S4 (full migration stack): seed the renamed-aside season_summary
//      __deprecated table with that SAME disagreeing number and PROVE the live
//      view CANNOT show it — it reads farm_season_config instead.
//
// Watch-it-fail evidence: if step 2's assertions were pointed at the PRE-S4 view
// (which reads the table), they would FAIL — the table's stale number would show.
// Step 1 is exactly that failing read, run on purpose against the pre-fix schema.

// The pre-S4 stack = every migration EXCEPT the S4 derived_metrics one. Listed by
// the distinctive substring of each file so freshDb({ only }) includes them all
// and STOPS before 20260621093000_derived_metrics.
const PRE_S4_MIGRATIONS = [
  "20260620120000_init",
  "20260620140000_auth_required_rls",
  "20260620150000_grant_hygiene",
  "20260620160000_write_foundation",
  "20260620170000_computed_aggregates",
  "20260621090000_plot_geometry",
  "20260621092000_event_log_units_lot_graph",
];

// A target that DISAGREES with the genuine config input (190000). If the view ever
// reads the season_summary TABLE for its inputs, the headline shows THIS instead.
const STALE_TARGET = 111111;
const STALE_REVENUE = 222222;

describe("S4 trust regression — PRE-FIX: the season_summary TABLE DROVE the headline (the defect, reproduced)", () => {
  let h: Harness;
  beforeAll(async () => {
    // Replay ONLY the pre-S4 stack: season_summary_view still reads its inputs
    // from the season_summary TABLE (see 20260620170000_computed_aggregates).
    h = await freshDb({ only: PRE_S4_MIGRATIONS });
    await seedHarvests(h);
    // Seed the hand-authored table with a target that DISAGREES with the truth.
    await h.query(
      `insert into season_summary (id, target_kg, harvested_kg, today_kg, ytd_revenue_usd)
       values (1, ${STALE_TARGET}, 999999, 999999, ${STALE_REVENUE});`,
    );
  });
  afterAll(async () => h.close());

  it("sanity: the S4 migration did NOT run (no farm_season_config table exists yet)", async () => {
    const rows = await h.query<{ exists: boolean }>(
      `select exists (
         select 1 from information_schema.tables
         where table_schema = 'public' and table_name = 'farm_season_config'
       ) as exists;`,
    );
    expect(rows[0].exists).toBe(false);
  });

  it("the pre-S4 view RETURNS the stale table inputs (a typo here silently drove the headline)", async () => {
    const rows = await asAuthenticated(h, (hh) =>
      hh.query<{ target_kg: string; ytd_revenue_usd: string }>(
        `select target_kg, ytd_revenue_usd from season_summary_view where id = 1;`,
      ),
    );
    // THE BUG: the headline inputs come straight from the hand-authored table, so
    // the stale/disagreeing numbers leak through. (Post-S4 these assertions would
    // be 190000 / 486500 — the config — proving the rewire is what fixed it.)
    expect(Number(rows[0].target_kg)).toBe(STALE_TARGET);
    expect(Number(rows[0].ytd_revenue_usd)).toBe(STALE_REVENUE);
  });
});

describe("S4 trust regression — POST-FIX: the live view CANNOT show a stale base-table number (defect is dead)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedHarvests(h);
    await seedConfig(h);
  });
  afterAll(async () => h.close());

  it("the renamed-aside table seeded to DISAGREE does not move the live view", async () => {
    // Seed the renamed-aside table with the SAME disagreeing inputs the pre-fix
    // schema would have surfaced (STALE_TARGET / STALE_REVENUE) plus bogus totals.
    // Post-S4 the view reads farm_season_config for inputs and SUMs harvests for
    // totals — it has NO code path back to this table.
    await h.query(
      `insert into season_summary__deprecated (id, target_kg, harvested_kg, today_kg, ytd_revenue_usd)
       values (1, ${STALE_TARGET}, 999999, 999999, ${STALE_REVENUE});`,
    );
    const rows = await asAuthenticated(h, (hh) =>
      hh.query<{ harvested_kg: string; today_kg: string; target_kg: string; ytd_revenue_usd: string }>(
        `select * from season_summary_view where id = 1;`,
      ),
    );
    // Inputs follow the config (NOT the stale table); totals follow harvests.
    // The disagreeing row is structurally unreachable — the defect is dead.
    expect(Number(rows[0].target_kg)).toBe(CONFIG_TARGET);
    expect(Number(rows[0].ytd_revenue_usd)).toBe(CONFIG_REVENUE);
    expect(Number(rows[0].target_kg)).not.toBe(STALE_TARGET);
    expect(Number(rows[0].ytd_revenue_usd)).not.toBe(STALE_REVENUE);
    expect(Number(rows[0].harvested_kg)).toBe(EXPECTED_HARVESTED);
    expect(Number(rows[0].today_kg)).toBe(EXPECTED_TODAY);
  });
});

describe("S4 rename-aside — the deprecated base tables are gone under their OLD names", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
  });
  afterAll(async () => h.close());

  for (const old of ["daily_cherries", "weekly_harvest", "variety_shares", "season_summary"]) {
    it(`base table "${old}" no longer exists (a getter .from('${old}') would now error)`, async () => {
      const rows = await h.query<{ exists: boolean }>(
        `select exists (
           select 1 from information_schema.tables
           where table_schema = 'public' and table_name = '${old}'
         ) as exists;`,
      );
      expect(rows[0].exists).toBe(false);
    });

    it(`"${old}__deprecated" exists (renamed aside, not dropped — one-line rollback)`, async () => {
      const rows = await h.query<{ exists: boolean }>(
        `select exists (
           select 1 from information_schema.tables
           where table_schema = 'public' and table_name = '${old}__deprecated'
         ) as exists;`,
      );
      expect(rows[0].exists).toBe(true);
    });
  }

  it("the four derived VIEWS still exist under their original names (the seam is unchanged)", async () => {
    for (const v of [
      "daily_cherries_view",
      "weekly_harvest_view",
      "variety_shares_view",
      "season_summary_view",
    ]) {
      const rows = await h.query<{ exists: boolean }>(
        `select exists (
           select 1 from information_schema.views
           where table_schema = 'public' and table_name = '${v}'
         ) as exists;`,
      );
      expect(rows[0].exists, `view ${v} must still exist`).toBe(true);
    }
  });
});

describe("S4 AD-8 grant posture — config + view readable by authenticated only", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedHarvests(h);
    await seedConfig(h);
  });
  afterAll(async () => h.close());

  it("authenticated can SELECT farm_season_config", async () => {
    const rows = await asAuthenticated(h, (hh) =>
      hh.query<{ id: number }>(`select id from farm_season_config where id = 1;`),
    );
    expect(rows[0].id).toBe(1);
  });

  it("anon cannot SELECT farm_season_config (no anon grant)", async () => {
    await expect(
      asAnon(h, (hh) => hh.query(`select id from farm_season_config;`)),
    ).rejects.toThrow(/permission denied/i);
  });

  it("anon cannot SELECT season_summary_view (security_invoker + revoked anon)", async () => {
    await expect(
      asAnon(h, (hh) => hh.query(`select id from season_summary_view;`)),
    ).rejects.toThrow(/permission denied/i);
  });

  it("nobody holds INSERT on farm_season_config (read-only config, no write grants)", async () => {
    const rows = await h.query<{ grantee: string }>(
      `select grantee from information_schema.role_table_grants
       where table_name = 'farm_season_config' and privilege_type = 'INSERT';`,
    );
    expect(rows.map((r) => r.grantee)).not.toContain("anon");
    expect(rows.map((r) => r.grantee)).not.toContain("authenticated");
  });
});
