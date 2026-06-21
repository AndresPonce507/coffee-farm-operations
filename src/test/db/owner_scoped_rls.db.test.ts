// Owner-scoped RLS proof — replays the REAL migrations in PGlite and asserts that
// after 20260623100000_owner_scoped_rls, a signed-in user who is NOT in app_members
// (e.g. a stranger who registered if signup were ever toggled on) can read and write
// NOTHING, while the seeded owner is unaffected. This is the regression net for the
// audit's #1 finding (flat `using(true)` made signup the entire security boundary).
//
// Falsifiability: against the pre-migration `using(true)` model the "stranger reads
// NOTHING" assertions go red (the stranger reads the seeded row) — verified by
// temporarily removing the migration during development.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAuthenticated, freshDb, type Harness } from "./pgliteHarness";

// The harness seeds this subject as the member (PGlite path); a stranger is anyone else.
const OWNER = "00000000-0000-0000-0000-000000000001";
const STRANGER = "00000000-0000-0000-0000-0000000000ff";

const SEED_PLOT = `insert into plots
  (id, ord, name, block, variety, area_ha, altitude_masl, trees, shade_pct,
   established_year, status, last_inspected, expected_yield_kg, harvested_kg)
  values
  ('p-owner', 1, 'Owner Plot', 'B1', 'Geisha', 1.25, 1600, 800, 35, 2012,
   'healthy', '2026-01-01', 1500, 600);`;

function plotInsert(id: string, ord: number): string {
  return `insert into plots
    (id, ord, name, block, variety, area_ha, altitude_masl, trees, shade_pct,
     established_year, status, last_inspected, expected_yield_kg, harvested_kg)
    values
    ('${id}', ${ord}, 'X', 'B9', 'Caturra', 1, 1500, 700, 30, 2015,
     'healthy', '2026-01-01', 1000, 400);`;
}

describe("owner-scoped RLS — non-member accounts are inert", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await freshDb();
    await h.query(SEED_PLOT); // seeded as the postgres owner (bypasses RLS)
  });

  afterAll(async () => {
    await h.close();
  });

  it("is_member() is true for the seeded owner, false for a stranger", async () => {
    const owner = await asAuthenticated(
      h,
      (hh) => hh.query<{ m: boolean }>("select public.is_member() as m"),
      { sub: OWNER },
    );
    expect(owner[0].m).toBe(true);

    const stranger = await asAuthenticated(
      h,
      (hh) => hh.query<{ m: boolean }>("select public.is_member() as m"),
      { sub: STRANGER },
    );
    expect(stranger[0].m).toBe(false);
  });

  it("the owner (member) still reads farm data", async () => {
    const rows = await asAuthenticated(
      h,
      (hh) => hh.query<{ id: string }>("select id from plots"),
      { sub: OWNER },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("p-owner");
  });

  it("a non-member authenticated user reads NOTHING (no PII/payroll leak)", async () => {
    const rows = await asAuthenticated(
      h,
      (hh) => hh.query("select id from plots"),
      { sub: STRANGER },
    );
    expect(rows).toEqual([]);
  });

  it("a non-member CANNOT write (insert blocked by with check)", async () => {
    await expect(
      asAuthenticated(h, (hh) => hh.query(plotInsert("p-evil", 99)), {
        sub: STRANGER,
      }),
    ).rejects.toThrow();
  });

  it("the owner (member) can still write", async () => {
    await asAuthenticated(h, (hh) => hh.query(plotInsert("p-owner-2", 2)), {
      sub: OWNER,
    });
    const rows = await asAuthenticated(
      h,
      (hh) => hh.query<{ id: string }>("select id from plots order by id"),
      { sub: OWNER },
    );
    expect(rows.map((r) => r.id)).toContain("p-owner-2");
  });
});
