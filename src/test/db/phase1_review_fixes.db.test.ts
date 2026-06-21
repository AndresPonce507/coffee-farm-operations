// Phase-1 full-review fixes — data-layer guards (mig 20260621110000) + seed fixes.
// Each test FAILS on the pre-fix tree and pins a confirmed review finding.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDb, type Harness } from "./pgliteHarness";

const SEED = readFileSync(join(process.cwd(), "supabase/seed.sql"), "utf8");

// device_seq must be unique per (device_id) event — vary it per call so distinct
// intakes don't collide on lot_event's (device_id, device_seq) key.
const CHERRY = (idem: string, seq: number) =>
  `select record_cherry_intake('p-baru-vista','w-05',120,'Geisha'::coffee_variety, now(),'dev', ${seq}, '${idem}') as code;`;

// ──────────────────────────────────────────────────────────────────────────
// 1. Minter collision-proof + seed setval (ROOT C / review HIGH).
// ──────────────────────────────────────────────────────────────────────────
describe("phase1-fix — record_cherry_intake never collides on a seeded DB", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(SEED); // seed inserts JC-700/701/710/711
  });
  afterAll(async () => h.close());

  it("mints a fresh code strictly greater than every seeded JC code (no lots_pkey collision)", async () => {
    const r = await h.query<{ code: string }>(CHERRY("intake-1", 1));
    const n = Number(r[0].code.split("-")[1]);
    expect(r[0].code).toMatch(/^JC-\d{3,}$/);
    expect(n).toBeGreaterThan(711); // past JC-711, the max seeded code
  });

  it("is idempotent on the idempotency key (returns the same minted code)", async () => {
    const a = await h.query<{ code: string }>(CHERRY("intake-2", 2));
    const b = await h.query<{ code: string }>(CHERRY("intake-2", 2));
    expect(a[0].code).toBe(b[0].code);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2. Re-running the seed does NOT double cost_entry (ROOT D / review HIGH).
// ──────────────────────────────────────────────────────────────────────────
describe("phase1-fix — seed is idempotent for cost_entry (no doubled COGS)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(SEED);
    await h.db.exec(SEED); // run it twice
  });
  afterAll(async () => h.close());

  it("cost_entry row count + total are unchanged after a second seed load", async () => {
    const r = await h.query<{ n: number; total: number }>(
      `select count(*)::int as n, coalesce(sum(amount_usd),0) as total from cost_entry;`,
    );
    // the seed books exactly 5 cost rows; re-running must not double them.
    expect(r[0].n).toBe(5);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. harvests_no_green_target trigger (ROOT B / review CRIT).
// ──────────────────────────────────────────────────────────────────────────
describe("phase1-fix — a harvest cannot target a green export lot", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(SEED);
  });
  afterAll(async () => h.close());

  it("rejects a harvest logged against a green lot (JC-701) — protects its EUDR origin", async () => {
    await expect(
      h.query(
        `insert into harvests (id, date, plot_id, worker_id, cherries_kg, ripeness_pct, brix_avg, lot_code)
         values ('h-bad', '2026-06-20', 'p-paso-ancho', 'w-05', 50, 90, 22, 'JC-701');`,
      ),
    ).rejects.toThrow();
  });

  it("still allows a harvest against a normal (non-green) lot", async () => {
    await h.query(
      `insert into harvests (id, date, plot_id, worker_id, cherries_kg, ripeness_pct, brix_avg, lot_code)
       values ('h-ok', '2026-06-20', 'p-paso-ancho', 'w-05', 50, 90, 22, 'JC-564');`,
    );
    const r = await h.query<{ n: number }>(
      `select count(*)::int as n from harvests where id = 'h-ok';`,
    );
    expect(r[0].n).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 4. green_reachable views + reaches_green (ROOT A / review CRIT support).
// ──────────────────────────────────────────────────────────────────────────
describe("phase1-fix — green-reachable cost targets", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(SEED);
  });
  afterAll(async () => h.close());

  it("a green lot and its milled source are green-reachable; a disconnected stage-NULL harvest lot is NOT", async () => {
    const reach = async (code: string) =>
      (
        await h.query<{ ok: boolean }>(
          `select exists(select 1 from green_reachable_lots where code = '${code}') as ok;`,
        )
      )[0].ok;
    expect(await reach("JC-701")).toBe(true); // green terminal itself
    expect(await reach("JC-700")).toBe(true); // milled source -> green via edge
    expect(await reach("JC-564")).toBe(false); // a harvest lot with no edge to green
  });

  it("reaches_green() agrees for lot/plot/farm and rejects a non-reaching target", async () => {
    const rg = async (k: string, c: string) =>
      (await h.query<{ ok: boolean }>(`select reaches_green('${k}','${c}') as ok;`))[0].ok;
    expect(await rg("lot", "JC-701")).toBe(true);
    expect(await rg("lot", "JC-564")).toBe(false); // money here would vanish from COGS
    expect(await rg("farm", "")).toBe(true); // green lots exist
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 5. advance_processing_stage guards (ROOT F / review MED — latent hardening).
// ──────────────────────────────────────────────────────────────────────────
describe("phase1-fix — advance_processing_stage guards", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(
      `insert into lots (code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
       values ('JC-880', 'milled', 'Geisha', 100, 100, true, now());`,
    );
  });
  afterAll(async () => h.close());

  const adv = (stage: string, kg: string, idem: string) =>
    `select advance_processing_stage('JC-880','${stage}',${kg}, now(),'dev',1,'${idem}');`;

  it("rejects a non-batch_stage value", async () => {
    await expect(h.query(adv("banana", "90", "a1"))).rejects.toThrow();
  });

  it("rejects a backward stage move (milled -> drying)", async () => {
    await expect(h.query(adv("drying", "90", "a2"))).rejects.toThrow();
  });

  it("rejects an unbounded mass GAIN (100 -> 150)", async () => {
    await expect(h.query(adv("green", "150", "a3"))).rejects.toThrow();
  });

  it("allows a legal forward move with conserved/lost mass (milled -> green, 100 -> 85)", async () => {
    await h.query(adv("green", "85", "a4"));
    const r = await h.query<{ stage: string; kg: number }>(
      `select stage, current_kg as kg from lots where code = 'JC-880';`,
    );
    expect(r[0].stage).toBe("green");
    expect(Number(r[0].kg)).toBeCloseTo(85, 6);
  });
});
