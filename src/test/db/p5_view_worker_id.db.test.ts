// Phase-5 view regression — worker_id column exposure in harvests_view + tasks_view.
//
// ROOT CAUSE: harvests_view and tasks_view joined the workers table to project
// w.name AS picker / w.name AS assignee, but never selected the FK column
// (h.worker_id / t.worker_id) itself. The Phase-5 mappers (mapHarvest / mapTask)
// now read r.worker_id to build an EntityLink drill-through to /workers/[id].
// Because both getters use select("*"), every harvest and task row returned a
// undefined workerId — producing dead /workers/undefined links on the real DB
// despite the mocked unit tests staying green (they injected worker_id manually).
//
// WHAT THIS FILE PROVES:
//   1. harvests_view emits a non-null worker_id that matches workers(id).
//   2. tasks_view   emits a non-null worker_id that matches workers(id).
//   3. Existing column order and names (picker / assignee / etc.) are unchanged.
//   4. P4-S0 tenant RLS still holds: the security_invoker view inherits the
//      base-table policy — an authenticated session for tenant A reads only
//      its own workers (when P4-S0 is present), never tenant B's.
//
// These assertions execute at the VIEW level, NOT the mapper level, closing
// the mapper-only blind spot the mocked harvests.test.ts / tasks.test.ts had.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAuthenticated,
  asTenant,
  freshDb,
  migrationFiles,
  type Harness,
} from "./pgliteHarness";

const SEED = readFileSync(join(process.cwd(), "supabase/seed.sql"), "utf8");

// P4-S0 is "present" once a migration in the 20260701xxxxxx band is on disk.
const P4S0_PRESENT = migrationFiles().some((f) => /2026070\d{7}/.test(f));

// The new view-fix migration is the acceptance signal: without it, worker_id
// is absent from the view's column list and these tests go red.
const VIEW_FIX_PRESENT = migrationFiles().some((f) =>
  f.includes("20260701093000"),
);

// ── 1. harvests_view emits worker_id (regression for Phase-5 mapHarvest) ──────
describe("harvests_view exposes worker_id (Phase-5 EntityLink fix)", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await freshDb();
    // Replay ALL migrations (including 20260701093000_views_add_worker_id.sql),
    // then load the canonical seed. This exercises the REAL view definition, not a
    // mocked client — the blind spot the unit tests had.
    await h.db.exec(SEED);
  });

  afterAll(async () => h.close());

  it("harvests_view includes a worker_id column (the column was absent before the fix)", async () => {
    const cols = await h.query<{ column_name: string }>(`
      select column_name
        from information_schema.columns
       where table_schema = 'public' and table_name = 'harvests_view'
       order by ordinal_position`);
    const names = cols.map((c) => c.column_name);
    expect(names).toContain("worker_id");
  });

  it("every harvests_view row carries a non-null worker_id", async () => {
    const rows = await asAuthenticated(h, (hh) =>
      hh.query<{ worker_id: string | null }>(
        "select worker_id from harvests_view",
      ),
    );
    // The seed inserts at least the day-of-picking harvest rows (h-0620-*).
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.worker_id).not.toBeNull();
      expect(row.worker_id).not.toBe("undefined");
    }
  });

  it("harvests_view.worker_id matches a real workers.id for every row", async () => {
    // Pull both sides as the superuser (owner bypasses RLS) to make the join
    // unconditional — we want to prove the FK relationship, not re-test RLS.
    const mismatches = await h.query<{ id: string }>(`
      select v.id
        from harvests_view v
        left join workers w on w.id = v.worker_id
       where w.id is null`);
    expect(mismatches).toHaveLength(0);
  });

  it("the first harvest row (h-0620-01) resolves to worker w-06 (Lucía Morales)", async () => {
    const rows = await h.query<{ id: string; worker_id: string; picker: string }>(
      "select id, worker_id, picker from harvests_view where id = 'h-0620-01'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].worker_id).toBe("w-06");
    expect(rows[0].picker).toBe("Lucía Morales"); // existing column still correct
  });

  it("existing column order is preserved — picker comes before worker_id", async () => {
    // REPLACE only appended worker_id at the end; the prior columns must be unchanged.
    const cols = await h.query<{ column_name: string; ordinal_position: number }>(`
      select column_name, ordinal_position
        from information_schema.columns
       where table_schema = 'public' and table_name = 'harvests_view'
       order by ordinal_position`);
    const names = cols.map((c) => c.column_name);
    // Original columns in their original order:
    expect(names.indexOf("id")).toBeLessThan(names.indexOf("date"));
    expect(names.indexOf("date")).toBeLessThan(names.indexOf("plot_id"));
    expect(names.indexOf("picker")).toBeLessThan(names.indexOf("worker_id"));
    // worker_id is the LAST column (appended by REPLACE):
    expect(names[names.length - 1]).toBe("worker_id");
  });
});

// ── 2. tasks_view emits worker_id (regression for Phase-5 mapTask) ─────────────
describe("tasks_view exposes worker_id (Phase-5 EntityLink fix)", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(SEED);
  });

  afterAll(async () => h.close());

  it("tasks_view includes a worker_id column (the column was absent before the fix)", async () => {
    const cols = await h.query<{ column_name: string }>(`
      select column_name
        from information_schema.columns
       where table_schema = 'public' and table_name = 'tasks_view'
       order by ordinal_position`);
    const names = cols.map((c) => c.column_name);
    expect(names).toContain("worker_id");
  });

  it("every tasks_view row carries a non-null worker_id", async () => {
    const rows = await asAuthenticated(h, (hh) =>
      hh.query<{ worker_id: string | null }>("select worker_id from tasks_view"),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.worker_id).not.toBeNull();
      expect(row.worker_id).not.toBe("undefined");
    }
  });

  it("tasks_view.worker_id matches a real workers.id for every row", async () => {
    const mismatches = await h.query<{ id: string }>(`
      select v.id
        from tasks_view v
        left join workers w on w.id = v.worker_id
       where w.id is null`);
    expect(mismatches).toHaveLength(0);
  });

  it("task t-01 resolves to worker w-02 (Janette Janson) with assignee and worker_id both correct", async () => {
    const rows = await h.query<{ id: string; worker_id: string; assignee: string }>(
      "select id, worker_id, assignee from tasks_view where id = 't-01'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].worker_id).toBe("w-02");
    expect(rows[0].assignee).toBe("Janette Janson"); // existing column unchanged
  });

  it("farm-wide task (null plot_id) still emits worker_id — the left join on plots is safe", async () => {
    // t-02 has plot_id = null (a farm-wide task). The LEFT JOIN on plots must not
    // exclude this row or produce a null worker_id.
    const rows = await h.query<{ id: string; plot_id: string | null; worker_id: string }>(
      "select id, plot_id, worker_id from tasks_view where id = 't-02'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].plot_id).toBeNull();
    expect(rows[0].worker_id).toBe("w-10"); // Néstor Gómez, Mill Operator
  });

  it("existing column order is preserved — assignee comes before worker_id", async () => {
    const cols = await h.query<{ column_name: string; ordinal_position: number }>(`
      select column_name, ordinal_position
        from information_schema.columns
       where table_schema = 'public' and table_name = 'tasks_view'
       order by ordinal_position`);
    const names = cols.map((c) => c.column_name);
    expect(names.indexOf("assignee")).toBeLessThan(names.indexOf("worker_id"));
    expect(names[names.length - 1]).toBe("worker_id");
  });
});

// ── 3. security_invoker still enforces RLS (the fix must not weaken the posture) ─
//
// Both views carry WITH (security_invoker = on), meaning the querying role's
// grants and RLS policies apply to the underlying harvests / tasks tables.
// Post-P4-S0, harvests and tasks are tenant-scoped: an authenticated session
// bound to tenant A must see only A's rows through the view. This block is
// gated on P4S0_PRESENT (no tenants table before it), mirrors the p4s0 matrix.
describe.skipIf(!P4S0_PRESENT)(
  "harvests_view + tasks_view inherit tenant RLS (security_invoker = on)",
  () => {
    const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    let h: Harness;

    beforeAll(async () => {
      h = await freshDb();

      // Seed two tenants with their own plots, workers, lots, harvests and tasks.
      await h.query(`
        insert into tenants (id, slug, name) values
          ('${A}', 'estate-a', 'Estate A'),
          ('${B}', 'estate-b', 'Estate B')`);

      for (const [t, code] of [
        [A, "A"],
        [B, "B"],
      ] as const) {
        await h.query(`
          insert into plots
            (tenant_id, id, ord, name, block, variety, area_ha, altitude_masl, trees,
             shade_pct, established_year, status, last_inspected, expected_yield_kg, harvested_kg)
            values ('${t}', 'p${code}', 1, 'Plot ${code}', 'B1', 'Geisha', 1.0, 1600, 800,
                    35, 2012, 'healthy', '2026-01-01', 1500, 600)`);

        await h.query(`
          insert into workers
            (tenant_id, id, name, role, daily_rate_usd, attendance, started_year, phone, today_kg, crew)
            values ('${t}', 'w${code}', 'Worker ${code}', 'Picker', 22, 'present', 2015,
                    '+507 6500-0000', 0, 'Crew ${code}')`);

        await h.query(
          `insert into lots (tenant_id, code) values ('${t}', 'JC-${code === "A" ? "100" : "200"}')`,
        );

        await h.query(`
          insert into harvests
            (tenant_id, id, date, plot_id, worker_id, cherries_kg, ripeness_pct, brix_avg, lot_code)
            values ('${t}', 'h${code}', '2026-06-20', 'p${code}', 'w${code}',
                    100, 90, 22, 'JC-${code === "A" ? "100" : "200"}')`);

        await h.query(`
          insert into tasks
            (tenant_id, id, title, category, worker_id, due, status, priority)
            values ('${t}', 'tk${code}', 'Task ${code}', 'Weeding', 'w${code}',
                    '2026-07-01', 'todo', 'medium')`);
      }
    });

    afterAll(async () => h.close());

    it("harvests_view as tenant A returns only A's harvest row with A's worker_id", async () => {
      const rows = await asTenant(h, A, (hh) =>
        hh.query<{ id: string; worker_id: string }>(
          "select id, worker_id from harvests_view",
        ),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe("hA");
      expect(rows[0].worker_id).toBe("wA");
    });

    it("harvests_view as tenant A never exposes tenant B's harvest or worker_id", async () => {
      const rows = await asTenant(h, A, (hh) =>
        hh.query<{ id: string; worker_id: string }>(
          "select id, worker_id from harvests_view",
        ),
      );
      const ids = rows.map((r) => r.id);
      const wids = rows.map((r) => r.worker_id);
      expect(ids).not.toContain("hB");
      expect(wids).not.toContain("wB");
    });

    it("tasks_view as tenant A returns only A's task row with A's worker_id", async () => {
      const rows = await asTenant(h, A, (hh) =>
        hh.query<{ id: string; worker_id: string }>(
          "select id, worker_id from tasks_view",
        ),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe("tkA");
      expect(rows[0].worker_id).toBe("wA");
    });

    it("tasks_view as tenant A never exposes tenant B's task or worker_id", async () => {
      const rows = await asTenant(h, A, (hh) =>
        hh.query<{ id: string; worker_id: string }>(
          "select id, worker_id from tasks_view",
        ),
      );
      const ids = rows.map((r) => r.id);
      const wids = rows.map((r) => r.worker_id);
      expect(ids).not.toContain("tkB");
      expect(wids).not.toContain("wB");
    });
  },
);

// ── 4. Acceptance guard: the view-fix migration must be on disk ────────────────
// This test is intentionally last and fails loudly if someone deletes or renames
// the migration — it makes the dependency explicit in the test output.
describe("view-fix migration 20260701093000 is present (acceptance gate)", () => {
  it("migration file 20260701093000_views_add_worker_id.sql exists on disk", () => {
    expect(VIEW_FIX_PRESENT).toBe(true);
  });
});
