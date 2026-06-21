// Pipeline-UI review fixes (mig 20260621120000) — the two CRITs + the advance guard.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDb, type Harness } from "./pgliteHarness";

const PLOT = `insert into plots (id, ord, name, block, variety, area_ha, altitude_masl, trees,
  shade_pct, established_year, status, last_inspected, expected_yield_kg, harvested_kg, geom, centroid)
  values ('p-pl', 70, 'Pipeline Plot', 'Block P', 'Geisha', 1, 1500, 100, 50, 2015, 'healthy',
    '2026-06-01', 1000, 800,
    '{"type":"Polygon","coordinates":[[[-82.6,8.7],[-82.5,8.7],[-82.5,8.8],[-82.6,8.8],[-82.6,8.7]]]}'::jsonb,
    '{"type":"Point","coordinates":[-82.55,8.75]}'::jsonb);`;
const WORKER = `insert into workers (id, name, role, daily_rate_usd, attendance, started_year, phone, crew)
  values ('w-pl', 'P', 'Picker', 22, 'present', 2015, '+507 0', 'Crew P');`;

const intake = (idem: string, seq: number) =>
  `select record_cherry_intake('p-pl','w-pl',120,'Geisha'::coffee_variety, now(),'dev',${seq},'${idem}') as code;`;

// ── CRIT-2: cherry intake writes a harvests row → the lot has traceable origin ──
describe("pipeline-fix — cherry intake establishes plot→lot origin (harvests row)", () => {
  let h: Harness;
  let greenCode: string;
  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(PLOT);
    await h.db.exec(WORKER);
    const r = await h.query<{ code: string }>(intake("p1", 1));
    const cherry = r[0].code;
    // advance cherry → milled, then materialize a green lot from it.
    await h.query(`select advance_processing_stage('${cherry}','milled',110, now(),'dev',2,'a1');`);
    const g = await h.query<{ code: string }>(
      `select materialize_green_lot('${cherry}', null, 100, 86, 'WH-P', now()) as code;`,
    );
    greenCode = g[0].code;
    await h.query(`select eudr_declare_plot('p-pl', true, 'established-pre-cutoff');`);
  });
  afterAll(async () => h.close());

  it("intake wrote a harvests row tying the plot to the minted lot", async () => {
    const r = await h.query<{ n: number }>(
      `select count(*)::int as n from harvests where plot_id = 'p-pl';`,
    );
    expect(r[0].n).toBeGreaterThan(0);
  });

  it("the intake→advance→grade green lot is NOT 'no-origin' (the chain lights up EUDR)", async () => {
    const plots = await h.query<{ plot_id: string }>(
      `select plot_id from lot_origin_plots where green_lot_code = '${greenCode}';`,
    );
    expect(plots.map((p) => p.plot_id)).toContain("p-pl");
    const v = await h.query<{ v: string }>(`select eudr_lot_status('${greenCode}') as v;`);
    expect(v[0].v).toBe("compliant"); // geolocated + declared, origin traced
  });
});

// ── CRIT-1: materialize mints a digit-only green code; rejects a bad one ──
describe("pipeline-fix — green-lot code is minted digit-only (no '-G' CHECK violation)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(
      `insert into lots (code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
       values ('JC-900','milled','Geisha',100,100,true, now());`,
    );
  });
  afterAll(async () => h.close());

  it("a null green code mints a valid ^JC-[0-9]{3,}$ code", async () => {
    const r = await h.query<{ code: string }>(
      `select materialize_green_lot('JC-900', null, 90, 86, 'WH', now()) as code;`,
    );
    expect(r[0].code).toMatch(/^JC-\d{3,}$/);
  });

  it("a non-digit '-G' code is REJECTED by lots_code_format (the old UI default)", async () => {
    await expect(
      h.query(`select materialize_green_lot('JC-900', 'JC-900-G', 90, 86, 'WH', now());`),
    ).rejects.toThrow();
  });
});

// ── advance guard: NULL-stage lot still forward-only ──
describe("pipeline-fix — advance guard holds on NULL-stage lots", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    // a bare lot with NULL stage (the seed pattern) at 'milled' via a direct set.
    await h.db.exec(`insert into lots (code) values ('JC-950');`); // stage NULL
    await h.query(`select advance_processing_stage('JC-950','milled',null, now(),'dev',1,'g1');`);
  });
  afterAll(async () => h.close());

  it("rejects a backward move from milled even though the lot started NULL-staged", async () => {
    await expect(
      h.query(`select advance_processing_stage('JC-950','drying',null, now(),'dev',2,'g2');`),
    ).rejects.toThrow();
  });
});
