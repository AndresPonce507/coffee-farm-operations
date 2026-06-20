// RLS proof — replays the REAL migrations in PGlite and asserts the live security
// posture: anon reads NOTHING, authenticated reads rows. This proves the harness
// faithfully models the deployed Supabase grants/RLS, so later slices can trust it.
//
// Falsifiability (the spec's "must fail for the right reason"): the
// `init-migration only` block below replays ONLY 20260620120000_init.sql — where
// anon still HOLDS the SELECT grant + "public read" policy — and asserts anon CAN
// read. If the auth_required_rls migration ever stopped revoking anon, the main
// assertion ("anon denied") would go red. Verified locally: against init-only the
// "anon is denied" assertion fails for the right reason (anon gets a row, no error).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asAuthenticated, freshDb, type Harness } from "./pgliteHarness";

const SEED_PLOT = `insert into plots
  (id, ord, name, block, variety, area_ha, altitude_masl, trees, shade_pct,
   established_year, status, last_inspected, expected_yield_kg, harvested_kg)
  values
  ('p-test', 1, 'Test Plot', 'B1', 'Geisha', 1.25, 1600, 800, 35, 2012,
   'healthy', '2026-01-01', 1500, 600);`;

describe("RLS posture — full migration stack (live security posture)", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await freshDb();
    // Seed as the owner (postgres bypasses RLS), then read back AS each role.
    await h.query(SEED_PLOT);
  });

  afterAll(async () => {
    await h.close();
  });

  it("denies anon any read of plots (SELECT grant revoked)", async () => {
    await expect(
      asAnon(h, (hh) => hh.query("select * from plots")),
    ).rejects.toThrow(/permission denied/i);
  });

  it("lets authenticated read plots (grant + RLS policy)", async () => {
    const rows = await asAuthenticated(h, (hh) =>
      hh.query<{ id: string }>("select id from plots"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("p-test");
  });

  it("also denies anon the security_invoker views (follow base-table RLS)", async () => {
    await expect(
      asAnon(h, (hh) => hh.query("select * from harvests_view")),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("RLS posture — init migration ONLY (falsifiability guard)", () => {
  let h: Harness;

  beforeAll(async () => {
    // Replay ONLY the init migration: anon STILL has the "public read" grant+policy.
    h = await freshDb({ only: ["20260620120000_init"] });
    await h.query(SEED_PLOT);
  });

  afterAll(async () => {
    await h.close();
  });

  it("anon CAN read under init-only — proving the auth migration is what locks it down", async () => {
    // If this ever started DENYING, the auth_required_rls revoke leaked backwards
    // into init, or the harness stopped modeling grants. Either way: investigate.
    const rows = await asAnon(h, (hh) =>
      hh.query<{ id: string }>("select id from plots"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("p-test");
  });
});
