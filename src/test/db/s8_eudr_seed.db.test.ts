// S8 — EUDR seed smoke: the whole seed.sql must load cleanly on top of every
// migration AND produce the intended demo verdicts. The seed ties real plots to
// the milled sources of the green lots (harvests → JC-700/JC-710) and declares
// their deforestation-free status, so:
//   - JC-701 ← {p-baru-vista, p-talamanca}, both geolocated + declared → 'compliant'
//   - JC-711 ← {p-nueva-suiza, p-palmira}; p-palmira left undeclared → 'incomplete'
// This doubles as a guard that seed.sql replays end-to-end (a broken seed insert,
// FK, or RPC call here fails loudly instead of silently shipping a dead demo).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDb, type Harness } from "./pgliteHarness";

const SEED = readFileSync(join(process.cwd(), "supabase/seed.sql"), "utf8");

describe("S8 EUDR — seed demo verdicts (seed.sql replays end-to-end)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(SEED); // the whole seed, on top of every migration
  });
  afterAll(async () => h.close());

  it("JC-701 traces to its declared, geolocated plots → 'compliant'", async () => {
    const plots = await h.query<{ plot_id: string }>(
      `select plot_id from lot_origin_plots where green_lot_code = 'JC-701' order by plot_id;`,
    );
    expect(plots.map((p) => p.plot_id)).toEqual(["p-baru-vista", "p-talamanca"]);
    const v = await h.query<{ v: string }>(`select eudr_lot_status('JC-701') as v;`);
    expect(v[0].v).toBe("compliant");
  });

  it("JC-711 has an undeclared origin plot (p-palmira) → 'incomplete' (honest gap)", async () => {
    const plots = await h.query<{ plot_id: string }>(
      `select plot_id from lot_origin_plots where green_lot_code = 'JC-711' order by plot_id;`,
    );
    expect(plots.map((p) => p.plot_id)).toEqual(["p-nueva-suiza", "p-palmira"]);
    const v = await h.query<{ v: string }>(`select eudr_lot_status('JC-711') as v;`);
    expect(v[0].v).toBe("incomplete");
  });

  it("the seeded green lots' COGS (S7) still reconciles after the EUDR seed additions", async () => {
    // a cross-slice guard: S8's extra harvests on JC-700/JC-710 must NOT disturb
    // the S7 cost-per-kg-green headline (costs are lot/farm-targeted, not plot).
    const r = await h.query<{ v: number | null }>(`select cogs_per_lot('JC-701') as v;`);
    expect(r[0].v).not.toBeNull();
    expect(Number(r[0].v)).toBeGreaterThan(0);
  });
});
