// S8 — EUDR due-diligence traceability: prove a green lot's plots of origin are
// geolocated + declared deforestation-free. These tests replay the REAL migrations
// in PGlite (AD-9) against a hand-built lineage:
//
//   plot pA (geolocated, will be declared free) ─┐
//                                                ├─ harvests → cherry/milled lot L0
//   plot pB (geolocated, undeclared at first)  ──┘            └─ materialize → green G0
//
//   - lot_origin_plots walks UP G0's lineage (the materialize 'process' edge) and
//     joins harvests → plots, yielding {pA, pB} — origin resolved through the graph.
//   - eudr_lot_status: 'compliant' only when EVERY origin plot is geolocated AND
//     declared deforestation-free; 'incomplete' when one is missing either;
//     'no-origin' when the lineage reaches no harvested plot (cannot substantiate).
//   - eudr_declare_plot is the owner's affirmative writer (basis required; unknown
//     plot raises).
//   - AD-8: lot_origin_plots SELECT + the two RPCs are authenticated-only; anon
//     reads/executes nothing.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, freshDb, type Harness } from "./pgliteHarness";

/** A geolocated plot (GeoJSON polygon + centroid present), all NOT-NULL cols set. */
function plotSql(
  id: string,
  ord: number,
  established: number,
  geolocated: boolean,
): string {
  const geom = geolocated
    ? `'{"type":"Polygon","coordinates":[[[-82.64,8.77],[-82.63,8.77],[-82.63,8.78],[-82.64,8.78],[-82.64,8.77]]]}'::jsonb`
    : `null`;
  const centroid = geolocated
    ? `'{"type":"Point","coordinates":[-82.635,8.775]}'::jsonb`
    : `null`;
  return `insert into plots (id, ord, name, block, variety, area_ha, altitude_masl,
            trees, shade_pct, established_year, status, last_inspected,
            expected_yield_kg, harvested_kg, geom, centroid)
          values ('${id}', ${ord}, 'Plot ${id}', 'Block ${id}', 'Geisha', 1.5, 1500,
            120, 50, ${established}, 'healthy', '2026-06-01', 1000, 800, ${geom}, ${centroid});`;
}

/** A single picker for harvest FK. */
const WORKER = `insert into workers (id, name, role, daily_rate_usd, attendance, started_year, phone, crew)
  values ('w-e1', 'EUDR Picker', 'Picker', 22, 'present', 2015, '+507 0000-0000', 'Crew E');`;

/** A milled source lot + harvests tying the given plots to it. */
function sourceWithHarvests(
  lotCode: string,
  plots: string[],
): string {
  const lot = `insert into lots (code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
    values ('${lotCode}', 'milled', 'Geisha', 100, 100, true, now());`;
  const harvests = plots
    .map(
      (p, i) =>
        `insert into harvests (id, date, plot_id, worker_id, cherries_kg, ripeness_pct, brix_avg, lot_code)
         values ('h-${lotCode}-${i}', '2026-06-01', '${p}', 'w-e1', 50, 92, 22, '${lotCode}');`,
    )
    .join("\n");
  return `${lot}\n${harvests}`;
}

async function statusOf(h: Harness, lot: string): Promise<string> {
  const r = await h.query<{ v: string }>(`select eudr_lot_status('${lot}') as v;`);
  return r[0].v;
}

async function originPlots(h: Harness, lot: string): Promise<string[]> {
  const r = await h.query<{ plot_id: string }>(
    `select plot_id from lot_origin_plots where green_lot_code = '${lot}' order by plot_id;`,
  );
  return r.map((x) => x.plot_id);
}

// ──────────────────────────────────────────────────────────────────────────
// 1. The up-walk resolves origin plots; the verdict reflects the two EUDR facts.
// ──────────────────────────────────────────────────────────────────────────
describe("S8 EUDR — origin-plot trace + compliance verdict", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(WORKER);
    await h.db.exec(plotSql("pA", 901, 2015, true)); // geolocated
    await h.db.exec(plotSql("pB", 902, 2016, true)); // geolocated
    await h.db.exec(sourceWithHarvests("JC-800", ["pA", "pB"]));
    await h.query(
      `select materialize_green_lot('JC-800','JC-801',90,86,'WH-E', now()) as code;`,
    );
  });
  afterAll(async () => h.close());

  it("walks UP the green lot's lineage to its harvested plots of origin", async () => {
    // G0 ← (materialize 'process' edge) ← L0 ← harvests {pA, pB}.
    expect(await originPlots(h, "JC-801")).toEqual(["pA", "pB"]);
  });

  it("is 'incomplete' while any origin plot is undeclared (pB not yet declared)", async () => {
    await h.query(
      `select eudr_declare_plot('pA', true, 'established-pre-cutoff');`,
    );
    expect(await statusOf(h, "JC-801")).toBe("incomplete"); // pB still undeclared
  });

  it("flips to 'compliant' once EVERY origin plot is geolocated AND declared free", async () => {
    await h.query(
      `select eudr_declare_plot('pB', true, 'established-pre-cutoff');`,
    );
    expect(await statusOf(h, "JC-801")).toBe("compliant");
  });

  it("withdrawing a declaration (free=false) drops the lot back to 'incomplete' and clears the basis", async () => {
    await h.query(`select eudr_declare_plot('pB', false);`);
    expect(await statusOf(h, "JC-801")).toBe("incomplete");
    const r = await h.query<{ basis: string | null }>(
      `select eudr_decl_basis as basis from plots where id = 'pB';`,
    );
    expect(r[0].basis).toBeNull();
    // restore for any later read
    await h.query(`select eudr_declare_plot('pB', true, 'field-survey');`);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2. Honest failure verdicts: no-origin (untraceable) + not-geolocated.
// ──────────────────────────────────────────────────────────────────────────
describe("S8 EUDR — honest failure verdicts", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(WORKER);
    // A green lot whose source carried NO harvests → origin cannot be substantiated.
    await h.db.exec(
      `insert into lots (code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
       values ('JC-810', 'milled', 'Geisha', 50, 50, true, now());`,
    );
    await h.query(
      `select materialize_green_lot('JC-810','JC-811',40,85,'WH-E', now()) as code;`,
    );
    // A green lot fed by a plot with NO geolocation (null geom), declared free.
    await h.db.exec(plotSql("pNoGeo", 903, 2010, false)); // NOT geolocated
    await h.db.exec(sourceWithHarvests("JC-820", ["pNoGeo"]));
    await h.query(
      `select materialize_green_lot('JC-820','JC-821',30,85,'WH-E', now()) as code;`,
    );
    await h.query(`select eudr_declare_plot('pNoGeo', true, 'field-survey');`);
  });
  afterAll(async () => h.close());

  it("'no-origin' when the lineage reaches no harvested plot (never a false pass)", async () => {
    expect(await originPlots(h, "JC-811")).toEqual([]);
    expect(await statusOf(h, "JC-811")).toBe("no-origin");
  });

  it("'incomplete' when an origin plot is declared free but NOT geolocated", async () => {
    // declared deforestation-free, but missing the EUDR geolocation polygon.
    expect(await originPlots(h, "JC-821")).toEqual(["pNoGeo"]);
    expect(await statusOf(h, "JC-821")).toBe("incomplete");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. eudr_declare_plot guards.
// ──────────────────────────────────────────────────────────────────────────
describe("S8 EUDR — declaration writer guards", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(plotSql("pG", 904, 2012, true));
  });
  afterAll(async () => h.close());

  it("rejects a free=true declaration with no basis", async () => {
    await expect(
      h.query(`select eudr_declare_plot('pG', true, null);`),
    ).rejects.toThrow();
  });

  it("rejects a declaration against an unknown plot", async () => {
    await expect(
      h.query(`select eudr_declare_plot('p-nope', true, 'field-survey');`),
    ).rejects.toThrow();
  });

  it("rejects an out-of-vocabulary basis (CHECK constraint)", async () => {
    await expect(
      h.query(`select eudr_declare_plot('pG', true, 'vibes');`),
    ).rejects.toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 4. AD-8 grant posture.
// ──────────────────────────────────────────────────────────────────────────
describe("S8 EUDR — AD-8 grant posture", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
  });
  afterAll(async () => h.close());

  it("authenticated can SELECT lot_origin_plots; anon cannot", async () => {
    const r = await h.query<{ a: boolean; an: boolean }>(
      `select has_table_privilege('authenticated','lot_origin_plots','select') as a,
              has_table_privilege('anon','lot_origin_plots','select') as an;`,
    );
    expect(r[0].a).toBe(true);
    expect(r[0].an).toBe(false);
  });

  it("eudr_lot_status / eudr_declare_plot are executable by authenticated, not anon", async () => {
    const r = await h.query<{ sa: boolean; san: boolean; da: boolean; dan: boolean }>(
      `select has_function_privilege('authenticated','eudr_lot_status(text)','execute') as sa,
              has_function_privilege('anon','eudr_lot_status(text)','execute') as san,
              has_function_privilege('authenticated','eudr_declare_plot(text,boolean,text)','execute') as da,
              has_function_privilege('anon','eudr_declare_plot(text,boolean,text)','execute') as dan;`,
    );
    expect(r[0].sa).toBe(true);
    expect(r[0].san).toBe(false);
    expect(r[0].da).toBe(true);
    expect(r[0].dan).toBe(false);
  });

  it("anon cannot read lot_origin_plots through the live role posture", async () => {
    await expect(
      asAnon(h, (hh) => hh.query(`select * from lot_origin_plots limit 1;`)),
    ).rejects.toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 5. Review-CRIT guards: the data layer must make a FALSE 'compliant' impossible
//    (these FAIL on the pre-fix migration; they pin the three reachable CRITs).
// ──────────────────────────────────────────────────────────────────────────
describe("S8 EUDR — no false 'compliant' (data-layer guards)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(WORKER);
    await h.db.exec(plotSql("pPost", 950, 2022, true)); // geolocated but established AFTER cutoff
    await h.db.exec(plotSql("pOk", 951, 2015, true)); // geolocated, pre-cutoff
    // a geolocated plot whose geom is a JSON null (not SQL null) + a valid centroid.
    await h.db.exec(
      `insert into plots (id, ord, name, block, variety, area_ha, altitude_masl,
         trees, shade_pct, established_year, status, last_inspected,
         expected_yield_kg, harvested_kg, geom, centroid)
       values ('pJsonNull', 952, 'Plot pJsonNull', 'Block X', 'Geisha', 1.5, 1500,
         120, 50, 2010, 'healthy', '2026-06-01', 1000, 800,
         'null'::jsonb, '{"type":"Point","coordinates":[-82.6,8.7]}'::jsonb);`,
    );
  });
  afterAll(async () => h.close());

  it("CRIT-1: rejects 'established-pre-cutoff' for a plot established AFTER 2020-12-31", async () => {
    await expect(
      h.query(`select eudr_declare_plot('pPost', true, 'established-pre-cutoff');`),
    ).rejects.toThrow();
  });

  it("CRIT-1: a post-cutoff plot may still be declared on EXTERNAL evidence (satellite/field)", async () => {
    // the cutoff guard is scoped to the DB-falsifiable 'established-pre-cutoff' basis;
    // satellite/field-survey are owner-attested external evidence and stay allowed.
    await h.query(`select eudr_declare_plot('pPost', true, 'satellite-monitoring');`);
    const r = await h.query<{ free: boolean }>(
      `select eudr_deforestation_free as free from plots where id = 'pPost';`,
    );
    expect(r[0].free).toBe(true);
  });

  it("CRIT-2: a deforestation-free claim with NO basis is rejected at the data layer (direct UPDATE bypass)", async () => {
    await expect(
      h.query(`update plots set eudr_deforestation_free = true where id = 'pOk';`),
    ).rejects.toThrow();
  });

  it("CRIT-3: a JSON-null geom is NOT geolocated, so the lot can't read 'compliant'", async () => {
    // pJsonNull is declared deforestation-free but its geom is a JSON null — the
    // geolocation gate must fail, holding the lot at 'incomplete'.
    await h.query(`select eudr_declare_plot('pJsonNull', true, 'field-survey');`);
    await h.db.exec(sourceWithHarvests("JC-860", ["pJsonNull"]));
    await h.query(
      `select materialize_green_lot('JC-860','JC-861',30,85,'WH-E', now()) as code;`,
    );
    const geo = await h.query<{ geolocated: boolean }>(
      `select geolocated from lot_origin_plots where green_lot_code = 'JC-861';`,
    );
    expect(geo[0].geolocated).toBe(false);
    const v = await h.query<{ v: string }>(`select eudr_lot_status('JC-861') as v;`);
    expect(v[0].v).toBe("incomplete"); // declared free, but not really geolocated
  });
});
