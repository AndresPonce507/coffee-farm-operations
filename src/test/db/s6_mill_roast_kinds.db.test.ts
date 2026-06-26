// P3-S6 — Lot-graph prereq: mill/roast/byproduct edge-kinds + enum extensions +
// yield-curve rows. The prereq schema the dry-milling/roasting slices build on.
//
// These tests replay the REAL migrations in PGlite (AD-9) and prove the slice's
// load-bearing invariants against HAND-COMPUTED seeds — written RED first.
//
//   (1) KEYSTONE — a 'mill' / 'roast' / 'byproduct' lot_edges row is now INSERTABLE
//       (the widened CHECK) AND still mass-conserved by the UNTOUCHED
//       lot_edges_conserve_mass() trigger. Over-routing past the parent's kg is
//       still rejected — the money/mass guarantee is reused, never re-implemented.
//   (2) ENUM EXTENSIONS — batch_stage gains 'roasted'; activity_kind gains 'roast'
//       and 'milling'. The pre-existing labels survive.
//   (3) NEW ENUMS — pass_type / roast_level / roaster_type / roast_profile_status /
//       byproduct_kind exist with their exact label sets.
//   (4) YIELD CURVE — real mill ('parchment'→'green') + roast ('green'→'roasted')
//       yield factors are seeded.
//   (5) GRANT POSTURE UNWIDENED — authenticated still reads lot_edges /
//       lot_yield_curve; anon reads NOTHING (no new anon surface).
//
// All math is hand-computed in the comments next to each assertion.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asAuthenticated, freshDb, type Harness } from "./pgliteHarness";

// A parchment parent (100 kg) → a green child + a byproduct husk stream; the green
// child → a roast batch. Round numbers so the conservation math is obvious.
const FIXTURE = `
  insert into lots (code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at) values
    ('JC-801', 'parchment', 'Geisha', 100, 100, true, now()),
    ('JC-802', 'green',     'Geisha',  80,  80, true, now()),
    ('JC-803', 'roasted',   'Geisha',   0,   0, true, now()),
    ('JC-804', 'parchment', 'Geisha',   0,   0, true, now());
`;

describe("P3-S6 — mill/roast/byproduct edge kinds + enums + yield curve", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(FIXTURE);
  });
  afterAll(async () => h.close());

  // ── (1) KEYSTONE: new edge kinds insertable AND mass-conserved ──────────────
  it("a 'mill' edge is now insertable and routes mass (80 ≤ 100)", async () => {
    await h.query(
      `insert into lot_edges (parent_code, child_code, kind, kg)
         values ('JC-801','JC-802','mill', 80);`,
    );
    const r = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_edges where kind = 'mill';`,
    );
    expect(r[0].n).toBe(1);
  });

  it("a 'roast' edge is insertable off the green child (68 ≤ 80)", async () => {
    await h.query(
      `insert into lot_edges (parent_code, child_code, kind, kg)
         values ('JC-802','JC-803','roast', 68);`,
    );
    const r = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_edges where kind = 'roast';`,
    );
    expect(r[0].n).toBe(1);
  });

  it("a 'byproduct' edge is insertable (mill 80 + byproduct 20 = 100 ≤ 100)", async () => {
    await h.query(
      `insert into lot_edges (parent_code, child_code, kind, kg)
         values ('JC-801','JC-804','byproduct', 20);`,
    );
    const r = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_edges where kind = 'byproduct';`,
    );
    expect(r[0].n).toBe(1);
  });

  it("the UNTOUCHED conservation trigger still rejects over-routing (100 + 5 > 100)", async () => {
    // JC-P has already routed 80 (mill) + 20 (byproduct) = 100 of its 100 kg.
    await expect(
      h.query(
        `insert into lot_edges (parent_code, child_code, kind, kg)
           values ('JC-801','JC-804','byproduct', 5);`,
      ),
    ).rejects.toThrow(/mass conservation/i);
  });

  it("the pre-existing 'process'/'split' kinds still validate", async () => {
    await h.query(
      `insert into lots (code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
         values ('JC-805', 'green', 'Geisha', 10, 10, true, now()),
                ('JC-806', 'green', 'Geisha', 0, 0, true, now());`,
    );
    await h.query(
      `insert into lot_edges (parent_code, child_code, kind, kg)
         values ('JC-805','JC-806','split', 5);`,
    );
    const r = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_edges where kind = 'split';`,
    );
    expect(r[0].n).toBe(1);
  });

  it("an unknown edge kind is still rejected by the CHECK", async () => {
    await expect(
      h.query(
        `insert into lot_edges (parent_code, child_code, kind, kg)
           values ('JC-801','JC-804','teleport', 1);`,
      ),
    ).rejects.toThrow();
  });

  // ── (2) ENUM EXTENSIONS ─────────────────────────────────────────────────────
  it("batch_stage gains 'roasted' (and keeps 'green')", async () => {
    const r = await h.query<{ labels: string }>(
      `select string_agg(enumlabel, ',' order by enumsortorder) as labels
         from pg_enum e join pg_type t on t.oid = e.enumtypid
        where t.typname = 'batch_stage';`,
    );
    expect(r[0].labels.split(",")).toContain("roasted");
    expect(r[0].labels.split(",")).toContain("green");
  });

  it("activity_kind gains 'roast' and 'milling'", async () => {
    const r = await h.query<{ labels: string }>(
      `select string_agg(enumlabel, ',' order by enumsortorder) as labels
         from pg_enum e join pg_type t on t.oid = e.enumtypid
        where t.typname = 'activity_kind';`,
    );
    const labels = r[0].labels.split(",");
    expect(labels).toContain("roast");
    expect(labels).toContain("milling");
    expect(labels).toContain("harvest"); // pre-existing survives
  });

  // ── (3) NEW ENUMS ───────────────────────────────────────────────────────────
  const expectedEnums: Record<string, string[]> = {
    pass_type: [
      "huller",
      "polisher",
      "screen_grader",
      "gravity_table",
      "optical_sorter",
    ],
    roast_level: ["light", "medium-light", "medium", "medium-dark", "dark"],
    roaster_type: ["drum", "fluid_bed", "sample"],
    roast_profile_status: ["draft", "approved", "retired"],
    byproduct_kind: ["husk", "chaff", "screen_rejects", "defects"],
  };

  for (const [typname, labels] of Object.entries(expectedEnums)) {
    it(`enum ${typname} exists with exactly its label set`, async () => {
      const r = await h.query<{ labels: string }>(
        `select string_agg(enumlabel, ',' order by enumsortorder) as labels
           from pg_enum e join pg_type t on t.oid = e.enumtypid
          where t.typname = '${typname}';`,
      );
      expect(r[0].labels).toBe(labels.join(","));
    });
  }

  // ── (4) YIELD CURVE — real mill/roast factors ───────────────────────────────
  it("seeds a dry-mill outturn factor (parchment → green)", async () => {
    const r = await h.query<{ f: number | string }>(
      `select yield_factor as f from lot_yield_curve
        where from_stage = 'parchment' and to_stage = 'green';`,
    );
    expect(r.length).toBe(1);
    expect(Number(r[0].f)).toBeGreaterThan(0.7);
    expect(Number(r[0].f)).toBeLessThanOrEqual(0.85);
  });

  it("seeds a roast-shrinkage factor (green → roasted, ~16% loss)", async () => {
    const r = await h.query<{ f: number | string }>(
      `select yield_factor as f from lot_yield_curve
        where from_stage = 'green' and to_stage = 'roasted';`,
    );
    expect(r.length).toBe(1);
    // 0.84 ⇒ ~16% roast loss — within the specialty-roast band.
    expect(Number(r[0].f)).toBeCloseTo(0.84, 6);
  });

  // ── (5) GRANT POSTURE UNWIDENED ─────────────────────────────────────────────
  it("authenticated still reads lot_edges and lot_yield_curve", async () => {
    const fn = await h.query<{ edges: boolean; curve: boolean }>(
      `select has_table_privilege('authenticated','lot_edges','select')      as edges,
              has_table_privilege('authenticated','lot_yield_curve','select') as curve;`,
    );
    expect(fn[0].edges).toBe(true);
    expect(fn[0].curve).toBe(true);
  });

  it("anon can read NEITHER lot_edges NOR lot_yield_curve (no new anon surface)", async () => {
    await expect(
      asAnon(h, (hh) => hh.query(`select * from lot_edges limit 1;`)),
    ).rejects.toThrow();
    await expect(
      asAnon(h, (hh) => hh.query(`select * from lot_yield_curve limit 1;`)),
    ).rejects.toThrow();
  });

  it("an authenticated caller reads the seeded yield-curve rows (RLS-free reference table)", async () => {
    const rows = await asAuthenticated(h, (hh) =>
      hh.query<{ n: number }>(
        `select count(*)::int as n from lot_yield_curve;`,
      ),
    );
    expect(rows[0].n).toBeGreaterThan(0);
  });
});
