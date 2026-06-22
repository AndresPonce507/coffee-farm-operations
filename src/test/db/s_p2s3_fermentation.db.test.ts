// P2-S3 — Fermentation & wet-mill tracker: SQL tests that replay the REAL
// migrations in PGlite and prove the make-quality slice's load-bearing invariants
// (ADR-001/002/003 + AD-8), matching the SHIPPED phase-1 posture (authenticated-
// only RLS, RPC-only writes, append-only readings hash-chained into lot_event):
//
//   - schema: ferment_recipes / ferment_batches / ferment_readings / mill_water_log
//     exist with the right keys + CHECKs (reading_kind ∈ ph/temp/brix, kg > 0, …).
//   - versioned recipe library: a recipe is APPEND-ONLY versioned (supersede chain
//     via superseded_by); a referenced recipe version is immutable (a UPDATE of a
//     superseded recipe's curve is blocked).
//   - start_ferment_batch: binds a batch to an existing lot_code + recipe version,
//     appends a ferment_started lot_event, exactly-once on idempotency_key.
//   - record_ferment_reading: append-only readings ledger; a reading's batch MUST
//     exist (fail-closed FK); exactly-once on idempotency_key (a replay is one row);
//     readings are immutable (UPDATE/DELETE raise).
//   - cut-point: v_ferment_cutpoint projects the window-close from the live pH curve
//     vs the recipe target — fires when the latest pH crosses the recipe target.
//   - eco-mill water: log_mill_water appends to mill_water_log; v_water_per_kg
//     derives L/kg from the lot's mass.
//   - AD-8 grants: new tables/views are SELECT-granted to authenticated; the command
//     RPCs are EXECUTE-granted to authenticated only; anon is fenced out of every
//     write door; no write table grants leak; nothing to anon.
//
// All run the authenticated role via the harness so they exercise the live posture.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asAuthenticated, freshDb, type Harness } from "./pgliteHarness";

// A lot at fermentation stage the batch/reading tests bind to. record_cherry_intake
// writes a harvests row (needs plot+worker), so we seed a lot node directly instead.
const SEED_LOT = `insert into lots (code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
  values ('JC-800', 'fermentation', 'Geisha', 120, 120, true, '2026-06-20T06:00:00Z');`;
const SEED_LOT_2 = `insert into lots (code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
  values ('JC-801', 'fermentation', 'Caturra', 200, 200, true, '2026-06-20T06:00:00Z');`;

// A first-class versioned altitude-tuned recipe the batches run against. A distinct
// test id ('rec-test-*') so it never collides with the migration's seeded library
// (the real Volcán recipes — rec-geisha-anaerobic-v1, etc. — ship in the migration).
const TEST_RECIPE_ID = "rec-test-anaerobic-v1";
const SEED_RECIPE = `insert into ferment_recipes
   (id, name, method, altitude_band, target_ph, target_temp_c, target_brix_drop, target_hours, version)
   values ('${TEST_RECIPE_ID}', 'Test Anaerobic', 'Anaerobic', '1500-1700',
           4.2, 20, 4, 36, 1);`;

describe("P2-S3 fermentation — schema shape", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
  });
  afterAll(async () => h.close());

  it("creates the four new tables", async () => {
    const r = await h.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema='public'
          and table_name in ('ferment_recipes','ferment_batches','ferment_readings','mill_water_log')
        order by table_name;`,
    );
    expect(r.map((x) => x.table_name)).toEqual([
      "ferment_batches",
      "ferment_readings",
      "ferment_recipes",
      "mill_water_log",
    ]);
  });

  it("creates the read views", async () => {
    const r = await h.query<{ table_name: string }>(
      `select table_name from information_schema.views
        where table_schema='public'
          and table_name in ('v_ferment_curve','v_ferment_cutpoint','v_water_per_kg')
        order by table_name;`,
    );
    expect(r.map((x) => x.table_name)).toEqual([
      "v_ferment_curve",
      "v_ferment_cutpoint",
      "v_water_per_kg",
    ]);
  });

  it("rejects a reading_kind outside ph/temp/brix (CHECK)", async () => {
    await h.query(SEED_LOT);
    await h.query(SEED_RECIPE);
    await asAuthenticated(h, (hh) =>
      hh.query(
        `select start_ferment_batch('JC-800','rec-test-anaerobic-v1','Anaerobic',
           '2026-06-20T06:00:00Z'::timestamptz,'dev-1',1,'b-schema');`,
      ),
    );
    const batchId = (
      await h.query<{ id: string }>(
        `select id from ferment_batches where lot_code='JC-800' limit 1;`,
      )
    )[0].id;
    await expect(
      h.query(
        `insert into ferment_readings (batch_id, reading_kind, value, occurred_at, device_id, device_seq, idempotency_key)
         values ('${batchId}', 'density', 1.0, '2026-06-20T07:00:00Z', 'dev-1', 99, 'bad-kind');`,
      ),
    ).rejects.toThrow();
  });
});

describe("P2-S3 fermentation — versioned recipe library (append-only, immutable)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(SEED_RECIPE);
  });
  afterAll(async () => h.close());

  it("stores a versioned recipe with its altitude-tuned target curve", async () => {
    const r = await h.query<{ version: number; target_ph: number; altitude_band: string }>(
      `select version, target_ph::numeric as target_ph, altitude_band
         from ferment_recipes where id='rec-test-anaerobic-v1';`,
    );
    expect(r[0].version).toBe(1);
    expect(Number(r[0].target_ph)).toBeCloseTo(4.2, 6);
    expect(r[0].altitude_band).toBe("1500-1700");
  });

  it("ships the seeded first-class Volcán recipe library (dogfood-ready day one)", async () => {
    // The migration seeds the real altitude-tuned recipes so /ferment has a populated
    // picker on first run — a first-class versioned asset, not empty scaffolding.
    const r = await h.query<{ n: number }>(
      `select count(*)::int as n from ferment_recipes where id like 'rec-geisha-%' or id like 'rec-caturra-%' or id like 'rec-pacamara-%';`,
    );
    expect(r[0].n).toBeGreaterThanOrEqual(4);
  });

  it("supersedes (never edits) a recipe — superseding writes a NEW version row", async () => {
    await h.query(
      `insert into ferment_recipes
         (id, name, method, altitude_band, target_ph, target_temp_c, target_brix_drop, target_hours, version, superseded_by)
         values ('rec-test-anaerobic-v2', 'Volcán Geisha Anaerobic', 'Anaerobic', '1500-1700',
                 4.0, 19, 5, 40, 2, null);`,
    );
    await h.query(
      `update ferment_recipes set superseded_by='rec-test-anaerobic-v2'
         where id='rec-test-anaerobic-v1' and superseded_by is null;`,
    );
    const r = await h.query<{ superseded_by: string | null }>(
      `select superseded_by from ferment_recipes where id='rec-test-anaerobic-v1';`,
    );
    expect(r[0].superseded_by).toBe("rec-test-anaerobic-v2");
  });

  it("FORBIDS mutating a recipe's target curve once it exists (immutable target)", async () => {
    // A recipe a batch ran against must stay comparable to its own target forever —
    // only the supersede pointer may change, never the curve fields.
    await expect(
      h.query(
        `update ferment_recipes set target_ph=3.0 where id='rec-test-anaerobic-v1';`,
      ),
    ).rejects.toThrow(/immutab|recipe|append-only|version/i);
  });
});

describe("P2-S3 fermentation — start_ferment_batch (binds a lot, exactly-once)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(SEED_LOT);
    await h.query(SEED_RECIPE);
  });
  afterAll(async () => h.close());

  it("creates a batch bound to the lot + recipe and appends a ferment_started event", async () => {
    const id = await asAuthenticated(h, (hh) =>
      hh.query<{ id: string }>(
        `select start_ferment_batch('JC-800','rec-test-anaerobic-v1','Anaerobic',
           '2026-06-20T06:00:00Z'::timestamptz,'dev-1',1,'b-1') as id;`,
      ),
    );
    expect(id[0].id).toBeTruthy();
    const batch = await h.query<{ lot_code: string; recipe_id: string }>(
      `select lot_code, recipe_id from ferment_batches where id='${id[0].id}';`,
    );
    expect(batch[0].lot_code).toBe("JC-800");
    expect(batch[0].recipe_id).toBe("rec-test-anaerobic-v1");
    const ev = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_event
         where stream_key='JC-800' and kind='ferment_started';`,
    );
    expect(ev[0].n).toBe(1);
  });

  it("is exactly-once on idempotency_key (no second batch, no second event)", async () => {
    const before = await h.query<{ b: number; e: number }>(
      `select (select count(*) from ferment_batches)::int as b,
              (select count(*) from lot_event where kind='ferment_started')::int as e;`,
    );
    await asAuthenticated(h, (hh) =>
      hh.query(
        `select start_ferment_batch('JC-800','rec-test-anaerobic-v1','Anaerobic',
           '2026-06-20T06:00:00Z'::timestamptz,'dev-1',1,'b-1');`,
      ),
    );
    const after = await h.query<{ b: number; e: number }>(
      `select (select count(*) from ferment_batches)::int as b,
              (select count(*) from lot_event where kind='ferment_started')::int as e;`,
    );
    expect(after[0].b).toBe(before[0].b);
    expect(after[0].e).toBe(before[0].e);
  });

  it("rejects starting a batch on an unknown lot (fail-closed FK)", async () => {
    await expect(
      asAuthenticated(h, (hh) =>
        hh.query(
          `select start_ferment_batch('JC-NOPE','rec-test-anaerobic-v1','Anaerobic',
             '2026-06-20T06:00:00Z'::timestamptz,'dev-1',2,'b-nope');`,
        ),
      ),
    ).rejects.toThrow(/lot|foreign|unknown|exist/i);
  });
});

describe("P2-S3 fermentation — record_ferment_reading (append-only, exactly-once)", () => {
  let h: Harness;
  let batchId: string;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(SEED_LOT);
    await h.query(SEED_RECIPE);
    await asAuthenticated(h, (hh) =>
      hh.query(
        `select start_ferment_batch('JC-800','rec-test-anaerobic-v1','Anaerobic',
           '2026-06-20T06:00:00Z'::timestamptz,'dev-1',1,'b-r');`,
      ),
    );
    batchId = (
      await h.query<{ id: string }>(
        `select id from ferment_batches where lot_code='JC-800' limit 1;`,
      )
    )[0].id;
  });
  afterAll(async () => h.close());

  it("appends a pH reading bound to the batch + a lot_event", async () => {
    await asAuthenticated(h, (hh) =>
      hh.query(
        `select record_ferment_reading('${batchId}','ph', 5.4,
           '2026-06-20T08:00:00Z'::timestamptz,'dev-1',10,'rd-1');`,
      ),
    );
    const r = await h.query<{ n: number; v: number }>(
      `select count(*)::int as n, max(value)::numeric as v
         from ferment_readings where batch_id='${batchId}' and reading_kind='ph';`,
    );
    expect(r[0].n).toBe(1);
    expect(Number(r[0].v)).toBeCloseTo(5.4, 6);
    const ev = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_event
         where stream_key='JC-800' and kind='ferment_reading';`,
    );
    expect(ev[0].n).toBe(1);
  });

  it("is exactly-once on idempotency_key (a replay is one row)", async () => {
    const before = await h.query<{ n: number }>(
      `select count(*)::int as n from ferment_readings where batch_id='${batchId}';`,
    );
    await asAuthenticated(h, (hh) =>
      hh.query(
        `select record_ferment_reading('${batchId}','ph', 5.4,
           '2026-06-20T08:00:00Z'::timestamptz,'dev-1',10,'rd-1');`,
      ),
    );
    const after = await h.query<{ n: number }>(
      `select count(*)::int as n from ferment_readings where batch_id='${batchId}';`,
    );
    expect(after[0].n).toBe(before[0].n);
  });

  it("rejects a reading whose batch does not exist (fail-closed)", async () => {
    await expect(
      asAuthenticated(h, (hh) =>
        hh.query(
          `select record_ferment_reading('00000000-0000-0000-0000-0000000000ff','ph', 4.0,
             '2026-06-20T09:00:00Z'::timestamptz,'dev-1',11,'rd-ghost');`,
        ),
      ),
    ).rejects.toThrow(/batch|foreign|unknown|exist/i);
  });

  it("readings are append-only — UPDATE and DELETE raise", async () => {
    await expect(
      h.query(`update ferment_readings set value=9 where batch_id='${batchId}';`),
    ).rejects.toThrow(/append-only|immutab|cannot/i);
    await expect(
      h.query(`delete from ferment_readings where batch_id='${batchId}';`),
    ).rejects.toThrow(/append-only|immutab|cannot/i);
  });
});

describe("P2-S3 fermentation — cut-point projection (v_ferment_cutpoint)", () => {
  let h: Harness;
  let batchId: string;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(SEED_LOT);
    await h.query(SEED_RECIPE); // target_ph = 4.2
    await asAuthenticated(h, (hh) =>
      hh.query(
        `select start_ferment_batch('JC-800','rec-test-anaerobic-v1','Anaerobic',
           '2026-06-20T06:00:00Z'::timestamptz,'dev-1',1,'b-cp');`,
      ),
    );
    batchId = (
      await h.query<{ id: string }>(
        `select id from ferment_batches where lot_code='JC-800' limit 1;`,
      )
    )[0].id;
  });
  afterAll(async () => h.close());

  it("does NOT signal cut while the latest pH is above the recipe target", async () => {
    await asAuthenticated(h, async (hh) => {
      await hh.query(
        `select record_ferment_reading('${batchId}','ph', 5.6, '2026-06-20T08:00:00Z'::timestamptz,'dev-1',20,'cp-1');`,
      );
      await hh.query(
        `select record_ferment_reading('${batchId}','ph', 5.0, '2026-06-20T10:00:00Z'::timestamptz,'dev-1',21,'cp-2');`,
      );
    });
    const r = await h.query<{ cut_reached: boolean; latest_ph: number; target_ph: number }>(
      `select cut_reached, latest_ph::numeric as latest_ph, target_ph::numeric as target_ph
         from v_ferment_cutpoint where batch_id='${batchId}';`,
    );
    expect(r[0].cut_reached).toBe(false);
    expect(Number(r[0].latest_ph)).toBeCloseTo(5.0, 6);
    expect(Number(r[0].target_ph)).toBeCloseTo(4.2, 6);
  });

  it("signals cut once the latest pH reaches/crosses the recipe target (≤ target)", async () => {
    await asAuthenticated(h, (hh) =>
      hh.query(
        `select record_ferment_reading('${batchId}','ph', 4.1, '2026-06-20T12:00:00Z'::timestamptz,'dev-1',22,'cp-3');`,
      ),
    );
    const r = await h.query<{ cut_reached: boolean; latest_ph: number }>(
      `select cut_reached, latest_ph::numeric as latest_ph
         from v_ferment_cutpoint where batch_id='${batchId}';`,
    );
    expect(r[0].cut_reached).toBe(true);
    expect(Number(r[0].latest_ph)).toBeCloseTo(4.1, 6);
  });
});

// FINDING idx 15 (TEST EFFICACY): the cut-point's "latest pH" is `order by occurred_at
// desc, id desc`, but every shipped cut-point test inserts readings in strictly
// increasing occurred_at AND id order — so a regression of the view's ORDER BY to
// `id desc` (or `recorded_at desc`) would return identical rows and the suite would
// still pass. The whole point of the dual clocks + device_seq (the migration header's
// "every reading is offline-replayable, P2-S0") is that an offline reading can ARRIVE
// late (high recorded_at / high insert id) while carrying an EARLIER occurred_at — and
// must NOT be treated as "latest", or it would resurrect a stale high pH and un-fire the
// cut. These tests PIN occurred_at (not id/insert order) as the "latest" axis: they pass
// on the current (correct) view and FAIL if it ever regresses to id/recorded_at ordering.
describe("P2-S3 review fix — cut-point ranks 'latest pH' by occurred_at, not insert order (offline-replay pin)", () => {
  let h: Harness;
  let batchId: string;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(SEED_LOT);
    await h.query(SEED_RECIPE); // target_ph = 4.2
    await asAuthenticated(h, (hh) =>
      hh.query(
        `select start_ferment_batch('JC-800','rec-test-anaerobic-v1','Anaerobic',
           '2026-06-20T06:00:00Z'::timestamptz,'dev-1',1,'b-reorder');`,
      ),
    );
    batchId = (
      await h.query<{ id: string }>(
        `select id from ferment_batches where lot_code='JC-800' limit 1;`,
      )
    )[0].id;
  });
  afterAll(async () => h.close());

  it("a LATE-arriving offline reading (earlier occurred_at, higher id) does NOT un-fire the cut", async () => {
    // 1) the cut-crossing pH 4.1 is logged at a LATER occurred_at (12:00) first.
    await asAuthenticated(h, (hh) =>
      hh.query(
        `select record_ferment_reading('${batchId}','ph', 4.1,
           '2026-06-20T12:00:00Z'::timestamptz,'dev-1',30,'reorder-cross');`,
      ),
    );
    // 2) a STALE offline reading (pH 5.6) carrying an EARLIER occurred_at (09:00) syncs
    //    AFTERWARD — so it inserts with a higher id (and a higher recorded_at). A distinct
    //    device/seq + a fresh key, exactly like a late device replay.
    await asAuthenticated(h, (hh) =>
      hh.query(
        `select record_ferment_reading('${batchId}','ph', 5.6,
           '2026-06-20T09:00:00Z'::timestamptz,'dev-2',5,'reorder-stale');`,
      ),
    );
    // occurred_at — NOT id/recorded_at — wins: the 12:00 pH 4.1 is still "latest", the
    // cut stays fired, and the stale 5.6 does not resurrect a high pH.
    const r = await h.query<{ cut_reached: boolean; latest_ph: number }>(
      `select cut_reached, latest_ph::numeric as latest_ph
         from v_ferment_cutpoint where batch_id='${batchId}';`,
    );
    expect(Number(r[0].latest_ph)).toBeCloseTo(4.1, 6);
    expect(r[0].cut_reached).toBe(true);
  });
});

// FINDING idx 15 (TEST EFFICACY, cont.): the recipe-less branch of the cut signal is
// `rec.target_ph is not null and ...` — a batch started WITHOUT a recipe has a NULL
// target, so cut_reached must stay false even at an extreme pH. That guard was correct
// but untested; this pins it.
describe("P2-S3 review fix — cut-point never fires on a recipe-less batch (target_ph NULL guard)", () => {
  let h: Harness;
  let batchId: string;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(SEED_LOT);
    await h.query(SEED_RECIPE);
    // start a batch bound to NO recipe (start_ferment_batch allows p_recipe_id NULL).
    await asAuthenticated(h, (hh) =>
      hh.query(
        `select start_ferment_batch('JC-800',null,'Anaerobic',
           '2026-06-20T06:00:00Z'::timestamptz,'dev-1',1,'b-norecipe');`,
      ),
    );
    batchId = (
      await h.query<{ id: string }>(
        `select id from ferment_batches where lot_code='JC-800' limit 1;`,
      )
    )[0].id;
  });
  afterAll(async () => h.close());

  it("does NOT signal cut even at an extreme pH when no recipe target is bound (target_ph IS NULL)", async () => {
    await asAuthenticated(h, (hh) =>
      hh.query(
        `select record_ferment_reading('${batchId}','ph', 2.0,
           '2026-06-20T08:00:00Z'::timestamptz,'dev-1',40,'norecipe-ph');`,
      ),
    );
    const r = await h.query<{ cut_reached: boolean; target_ph: number | null; latest_ph: number }>(
      `select cut_reached, target_ph::numeric as target_ph, latest_ph::numeric as latest_ph
         from v_ferment_cutpoint where batch_id='${batchId}';`,
    );
    expect(r[0].target_ph).toBeNull();
    expect(Number(r[0].latest_ph)).toBeCloseTo(2.0, 6);
    expect(r[0].cut_reached).toBe(false);
  });
});

describe("P2-S3 fermentation — eco-mill water log + v_water_per_kg", () => {
  let h: Harness;
  let batchId: string;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(SEED_LOT); // JC-800 current_kg = 120
    await h.query(SEED_RECIPE);
    await asAuthenticated(h, (hh) =>
      hh.query(
        `select start_ferment_batch('JC-800','rec-test-anaerobic-v1','Anaerobic',
           '2026-06-20T06:00:00Z'::timestamptz,'dev-1',1,'b-w');`,
      ),
    );
    batchId = (
      await h.query<{ id: string }>(
        `select id from ferment_batches where lot_code='JC-800' limit 1;`,
      )
    )[0].id;
  });
  afterAll(async () => h.close());

  it("logs mill water and derives L/kg from the lot's mass", async () => {
    await asAuthenticated(h, async (hh) => {
      await hh.query(
        `select log_mill_water('${batchId}', 240, '2026-06-20T13:00:00Z'::timestamptz,'dev-1',30,'w-1');`,
      );
      await hh.query(
        `select log_mill_water('${batchId}', 120, '2026-06-20T14:00:00Z'::timestamptz,'dev-1',31,'w-2');`,
      );
    });
    // 360 L total over 120 kg => 3.0 L/kg
    const r = await h.query<{ liters: number; per_kg: number }>(
      `select total_liters::numeric as liters, liters_per_kg::numeric as per_kg
         from v_water_per_kg where lot_code='JC-800';`,
    );
    expect(Number(r[0].liters)).toBeCloseTo(360, 6);
    expect(Number(r[0].per_kg)).toBeCloseTo(3.0, 6);
  });

  it("log_mill_water is exactly-once on idempotency_key", async () => {
    const before = await h.query<{ n: number }>(
      `select count(*)::int as n from mill_water_log where batch_id='${batchId}';`,
    );
    await asAuthenticated(h, (hh) =>
      hh.query(
        `select log_mill_water('${batchId}', 240, '2026-06-20T13:00:00Z'::timestamptz,'dev-1',30,'w-1');`,
      ),
    );
    const after = await h.query<{ n: number }>(
      `select count(*)::int as n from mill_water_log where batch_id='${batchId}';`,
    );
    expect(after[0].n).toBe(before[0].n);
  });

  it("rejects a non-positive liters value (CHECK liters > 0)", async () => {
    await expect(
      asAuthenticated(h, (hh) =>
        hh.query(
          `select log_mill_water('${batchId}', 0, '2026-06-20T15:00:00Z'::timestamptz,'dev-1',32,'w-zero');`,
        ),
      ),
    ).rejects.toThrow();
  });
});

describe("P2-S3 fermentation — AD-8 grant posture", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(SEED_LOT);
    await h.query(SEED_RECIPE);
  });
  afterAll(async () => h.close());

  it("grants SELECT on every new table/view to authenticated", async () => {
    for (const t of [
      "ferment_recipes",
      "ferment_batches",
      "ferment_readings",
      "mill_water_log",
      "v_ferment_curve",
      "v_ferment_cutpoint",
      "v_water_per_kg",
    ]) {
      const r = await h.query<{ priv: string }>(
        `select privilege_type as priv from information_schema.role_table_grants
           where table_name='${t}' and grantee='authenticated' and privilege_type='SELECT';`,
      );
      expect(r.length, `${t} must grant SELECT to authenticated`).toBeGreaterThan(0);
    }
  });

  it("grants EXECUTE on the command RPCs to authenticated", async () => {
    const r = await h.query<{ routine_name: string }>(
      `select routine_name from information_schema.role_routine_grants
         where grantee='authenticated' and privilege_type='EXECUTE'
           and routine_name in
             ('start_ferment_batch','record_ferment_reading','log_mill_water','apply_ferment_recipe');`,
    );
    const names = new Set(r.map((x) => x.routine_name));
    for (const fn of [
      "start_ferment_batch",
      "record_ferment_reading",
      "log_mill_water",
      "apply_ferment_recipe",
    ]) {
      expect(names.has(fn), `${fn} must grant EXECUTE to authenticated`).toBe(true);
    }
  });

  it("authenticated has NO insert/update/delete table grant on the readings ledger (RPC-only writes)", async () => {
    const r = await h.query<{ priv: string }>(
      `select privilege_type as priv from information_schema.role_table_grants
         where table_name='ferment_readings' and grantee='authenticated';`,
    );
    const privs = r.map((x) => x.priv.toUpperCase());
    expect(privs).toContain("SELECT");
    expect(privs).not.toContain("INSERT");
    expect(privs).not.toContain("UPDATE");
    expect(privs).not.toContain("DELETE");
  });

  it("anon cannot read ferment_readings (authenticated-only posture)", async () => {
    await expect(
      asAnon(h, (hh) => hh.query("select * from ferment_readings")),
    ).rejects.toThrow(/permission denied/i);
  });

  it("anon CANNOT execute start_ferment_batch (no PUBLIC write door)", async () => {
    await expect(
      asAnon(h, (hh) =>
        hh.query(
          `select start_ferment_batch('JC-800','rec-test-anaerobic-v1','Anaerobic',
             '2026-06-20T06:00:00Z'::timestamptz,'anon-dev',1,'anon-batch');`,
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("anon CANNOT execute record_ferment_reading (no PUBLIC forge door)", async () => {
    await expect(
      asAnon(h, (hh) =>
        hh.query(
          `select record_ferment_reading('00000000-0000-0000-0000-0000000000aa','ph', 4.0,
             '2026-06-20T08:00:00Z'::timestamptz,'anon-dev',1,'anon-rd');`,
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("anon CANNOT execute log_mill_water", async () => {
    await expect(
      asAnon(h, (hh) =>
        hh.query(
          `select log_mill_water('00000000-0000-0000-0000-0000000000aa', 10,
             '2026-06-20T08:00:00Z'::timestamptz,'anon-dev',1,'anon-w');`,
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// PHASE-2 REVIEW FIXES — regression tests that FAIL on the pre-fix migration.
// ──────────────────────────────────────────────────────────────────────────

describe("P2-S3 review fix — start_ferment_batch binds exactly-once on the DOMAIN row (no phantom batch)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(SEED_LOT);
    await h.query(SEED_RECIPE);
  });
  afterAll(async () => h.close());

  // FINDING idx 0/35: the kind-scoped event short-circuit + globally-unique
  // lot_event.idempotency_key let a key already used by ANOTHER event kind create a
  // ferment_batches row whose ferment_started event was silently dropped by ON CONFLICT
  // DO NOTHING — a ledger-less phantom batch. The fix fails closed on cross-kind reuse.
  it("FAILS CLOSED when the idempotency_key was already burned by a different event kind (no phantom batch)", async () => {
    // pre-seed a lot_event under a DIFFERENT kind carrying the shared key.
    await h.query(
      `select record_lot_event('JC-800','some_other_kind','{}'::jsonb,
         '2026-06-20T05:00:00Z'::timestamptz,'dev-x',900100,'shared-key-3');`,
    );
    const before = (
      await h.query<{ n: number }>(`select count(*)::int as n from ferment_batches;`)
    )[0].n;

    await expect(
      asAuthenticated(h, (hh) =>
        hh.query(
          `select start_ferment_batch('JC-800','rec-test-anaerobic-v1','Anaerobic',
             '2026-06-20T06:00:00Z'::timestamptz,'dev-1',900200,'shared-key-3');`,
        ),
      ),
    ).rejects.toThrow(/already|different event kind|unique|duplicate/i);

    // no phantom batch was minted, and there is NO ferment_started event for this key.
    const after = (
      await h.query<{ n: number }>(`select count(*)::int as n from ferment_batches;`)
    )[0].n;
    expect(after).toBe(before);
    const ev = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_event
         where idempotency_key='shared-key-3' and kind='ferment_started';`,
    );
    expect(ev[0].n).toBe(0);
  });

  it("INVARIANT — every ferment_batches row has a backing ferment_started lot_event", async () => {
    // a clean start with a fresh key produces a backed batch.
    await asAuthenticated(h, (hh) =>
      hh.query(
        `select start_ferment_batch('JC-800','rec-test-anaerobic-v1','Anaerobic',
           '2026-06-20T07:00:00Z'::timestamptz,'dev-1',900300,'fresh-start-key');`,
      ),
    );
    const orphans = await h.query<{ n: number }>(
      `select count(*)::int as n
         from ferment_batches b
        where not exists (
          select 1 from lot_event e
           where e.idempotency_key = b.idempotency_key and e.kind = 'ferment_started'
        );`,
    );
    expect(orphans[0].n).toBe(0);
  });

  it("a genuine replay (same key, ferment_started) returns the same batch and appends nothing", async () => {
    const first = await asAuthenticated(h, (hh) =>
      hh.query<{ id: string }>(
        `select start_ferment_batch('JC-800','rec-test-anaerobic-v1','Anaerobic',
           '2026-06-20T08:00:00Z'::timestamptz,'dev-1',900400,'replay-key') as id;`,
      ),
    );
    const before = (
      await h.query<{ n: number }>(`select count(*)::int as n from ferment_batches;`)
    )[0].n;
    const second = await asAuthenticated(h, (hh) =>
      hh.query<{ id: string }>(
        `select start_ferment_batch('JC-800','rec-test-anaerobic-v1','Anaerobic',
           '2026-06-20T08:00:00Z'::timestamptz,'dev-1',900401,'replay-key') as id;`,
      ),
    );
    expect(second[0].id).toBe(first[0].id);
    const after = (
      await h.query<{ n: number }>(`select count(*)::int as n from ferment_batches;`)
    )[0].n;
    expect(after).toBe(before);
  });
});

describe("P2-S3 review fix — apply_ferment_recipe is collision-free + rebind-traceable", () => {
  let h: Harness;
  let bA: string;
  let bB: string;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(SEED_LOT);
    await h.query(SEED_LOT_2);
    await h.query(SEED_RECIPE);
    // a second recipe to rebind to.
    await h.query(
      `insert into ferment_recipes
         (id, name, method, altitude_band, target_ph, target_temp_c, target_brix_drop, target_hours, version)
         values ('rec-test-washed-v1','Test Washed','Washed','1500-1700',4.5,21,3,24,1);`,
    );
    bA = (
      await asAuthenticated(h, (hh) =>
        hh.query<{ id: string }>(
          `select start_ferment_batch('JC-800',null,'Anaerobic',
             '2026-06-20T06:00:00Z'::timestamptz,'dev-1',910001,'ba') as id;`,
        ),
      )
    )[0].id;
    bB = (
      await asAuthenticated(h, (hh) =>
        hh.query<{ id: string }>(
          `select start_ferment_batch('JC-801',null,'Washed',
             '2026-06-20T06:00:00Z'::timestamptz,'dev-1',910002,'bb') as id;`,
        ),
      )
    )[0].id;
  });
  afterAll(async () => h.close());

  // FINDING idx 33/28/12/3/126: two distinct binds in the SAME wall-clock second both
  // drew device_seq = whole-second epoch under the constant 'server-ferment' device,
  // colliding on lot_event UNIQUE(device_id, device_seq) → second bind threw 23505 and
  // its whole txn aborted. The fix draws device_seq from the monotonic server sequence.
  it("two distinct recipe binds in the same statement batch BOTH land (no device_seq collision)", async () => {
    await asAuthenticated(h, async (hh) => {
      await hh.query(`select apply_ferment_recipe('${bA}','rec-test-anaerobic-v1');`);
      await hh.query(`select apply_ferment_recipe('${bB}','rec-test-washed-v1');`);
    });
    const events = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_event where kind='ferment_recipe_applied';`,
    );
    expect(events[0].n).toBe(2);
    const a = await h.query<{ recipe_id: string }>(
      `select recipe_id from ferment_batches where id='${bA}';`,
    );
    const b = await h.query<{ recipe_id: string }>(
      `select recipe_id from ferment_batches where id='${bB}';`,
    );
    expect(a[0].recipe_id).toBe("rec-test-anaerobic-v1");
    expect(b[0].recipe_id).toBe("rec-test-washed-v1");
  });

  // FINDING idx 38: rebind A->B->A flipped recipe_id back to A with NO new ledger event
  // (the per-(batch,recipe) key was reused → ON CONFLICT DO NOTHING dropped it), so the
  // domain row diverged from the ledger's last recipe-applied event. The fix folds the
  // unique seq into the event key so a genuine rebind always appends a fresh event.
  it("rebind A->B->A appends THREE events and the last event matches the current recipe_id", async () => {
    // bA is currently bound to anaerobic (from the prior test). Rebind to washed, then back.
    await asAuthenticated(h, async (hh) => {
      await hh.query(`select apply_ferment_recipe('${bA}','rec-test-washed-v1');`); // A->B
      await hh.query(`select apply_ferment_recipe('${bA}','rec-test-anaerobic-v1');`); // B->A
    });
    const lot = "JC-800";
    const events = await h.query<{ recipe_id: string }>(
      `select payload->>'recipe_id' as recipe_id from lot_event
         where stream_key='${lot}' and kind='ferment_recipe_applied'
         order by device_seq;`,
    );
    // anaerobic (first test), washed, anaerobic again => 3 events
    expect(events.length).toBe(3);
    const current = (
      await h.query<{ recipe_id: string }>(
        `select recipe_id from ferment_batches where id='${bA}';`,
      )
    )[0].recipe_id;
    expect(current).toBe("rec-test-anaerobic-v1");
    // the ledger's LAST recipe-applied event agrees with the domain row.
    expect(events[events.length - 1].recipe_id).toBe(current);
  });

  it("re-applying the SAME recipe is an idempotent no-op (no extra event)", async () => {
    const before = (
      await h.query<{ n: number }>(
        `select count(*)::int as n from lot_event where kind='ferment_recipe_applied';`,
      )
    )[0].n;
    await asAuthenticated(h, (hh) =>
      hh.query(`select apply_ferment_recipe('${bA}','rec-test-anaerobic-v1');`),
    );
    const after = (
      await h.query<{ n: number }>(
        `select count(*)::int as n from lot_event where kind='ferment_recipe_applied';`,
      )
    )[0].n;
    expect(after).toBe(before);
  });
});

describe("P2-S3 review fix — ferment_readings.value range CHECK (data-layer enforcement)", () => {
  let h: Harness;
  let batchId: string;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(SEED_LOT);
    await h.query(SEED_RECIPE);
    await asAuthenticated(h, (hh) =>
      hh.query(
        `select start_ferment_batch('JC-800','rec-test-anaerobic-v1','Anaerobic',
           '2026-06-20T06:00:00Z'::timestamptz,'dev-1',1,'b-range');`,
      ),
    );
    batchId = (
      await h.query<{ id: string }>(
        `select id from ferment_batches where lot_code='JC-800' limit 1;`,
      )
    )[0].id;
  });
  afterAll(async () => h.close());

  // FINDING idx 4/29/37: the pH 0-14 bound lived ONLY in the TS validator; the RPC +
  // table imposed no CHECK, so a direct call could persist pH=-1 / 99 into the
  // append-only series and falsely flip cut_reached. The fix is a kind-scoped table CHECK.
  it("REJECTS a negative pH at the data layer (CHECK, not just the TS validator)", async () => {
    await expect(
      asAuthenticated(h, (hh) =>
        hh.query(
          `select record_ferment_reading('${batchId}','ph', -1,
             '2026-06-20T08:00:00Z'::timestamptz,'dev-1',5001,'ph-neg');`,
        ),
      ),
    ).rejects.toThrow(/check|constraint|range|violat/i);
  });

  it("REJECTS an above-range pH (99)", async () => {
    await expect(
      asAuthenticated(h, (hh) =>
        hh.query(
          `select record_ferment_reading('${batchId}','ph', 99,
             '2026-06-20T09:00:00Z'::timestamptz,'dev-1',5002,'ph-hi');`,
        ),
      ),
    ).rejects.toThrow(/check|constraint|range|violat/i);
  });

  it("REJECTS a negative Brix", async () => {
    await expect(
      asAuthenticated(h, (hh) =>
        hh.query(
          `select record_ferment_reading('${batchId}','brix', -4,
             '2026-06-20T10:00:00Z'::timestamptz,'dev-1',5003,'brix-neg');`,
        ),
      ),
    ).rejects.toThrow(/check|constraint|range|violat/i);
  });

  it("ACCEPTS a legitimate in-range reading (pH 4.6, temp 21, brix 12)", async () => {
    await asAuthenticated(h, async (hh) => {
      await hh.query(
        `select record_ferment_reading('${batchId}','ph', 4.6, '2026-06-20T11:00:00Z'::timestamptz,'dev-1',5004,'ph-ok');`,
      );
      await hh.query(
        `select record_ferment_reading('${batchId}','temp', 21, '2026-06-20T11:30:00Z'::timestamptz,'dev-1',5005,'temp-ok');`,
      );
      await hh.query(
        `select record_ferment_reading('${batchId}','brix', 12, '2026-06-20T12:00:00Z'::timestamptz,'dev-1',5006,'brix-ok');`,
      );
    });
    const r = await h.query<{ n: number }>(
      `select count(*)::int as n from ferment_readings where batch_id='${batchId}';`,
    );
    expect(r[0].n).toBe(3);
  });
});

describe("P2-S3 review fix — shared idempotency namespace fails closed (no orphaned ledger)", () => {
  let h: Harness;
  let batchId: string;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(SEED_LOT);
    await h.query(SEED_RECIPE);
    await asAuthenticated(h, (hh) =>
      hh.query(
        `select start_ferment_batch('JC-800','rec-test-anaerobic-v1','Anaerobic',
           '2026-06-20T06:00:00Z'::timestamptz,'dev-1',1,'b-ns');`,
      ),
    );
    batchId = (
      await h.query<{ id: string }>(
        `select id from ferment_batches where lot_code='JC-800' limit 1;`,
      )
    )[0].id;
  });
  afterAll(async () => h.close());

  // FINDING idx 1: the reading deduped on the RAW key but appended the lot_event under a
  // DERIVED key ('ferment-reading:'+key) — independent namespaces. A raw-key/derived-key
  // collision let the reading insert while its lot_event was silently dropped, leaving a
  // reading with no provenance event. The fix shares one namespace + fails closed.
  it("record_ferment_reading RAISES (and inserts NO reading) when the key already anchors another event", async () => {
    await h.query(
      `select record_lot_event('JC-800','some_other_kind','{}'::jsonb,
         '2026-06-20T05:00:00Z'::timestamptz,'dev-y',920100,'READKEY');`,
    );
    const before = (
      await h.query<{ n: number }>(
        `select count(*)::int as n from ferment_readings where batch_id='${batchId}';`,
      )
    )[0].n;
    await expect(
      asAuthenticated(h, (hh) =>
        hh.query(
          `select record_ferment_reading('${batchId}','ph', 4.5,
             '2026-06-20T08:00:00Z'::timestamptz,'dev-1',920200,'READKEY');`,
        ),
      ),
    ).rejects.toThrow(/already|anchors|unique|duplicate/i);
    const after = (
      await h.query<{ n: number }>(
        `select count(*)::int as n from ferment_readings where batch_id='${batchId}';`,
      )
    )[0].n;
    expect(after).toBe(before);
  });

  it("log_mill_water RAISES (and inserts NO water row) when the key already anchors another event", async () => {
    await h.query(
      `select record_lot_event('JC-800','some_other_kind','{}'::jsonb,
         '2026-06-20T05:00:00Z'::timestamptz,'dev-z',920300,'WATERKEY');`,
    );
    const before = (
      await h.query<{ n: number }>(
        `select count(*)::int as n from mill_water_log where batch_id='${batchId}';`,
      )
    )[0].n;
    await expect(
      asAuthenticated(h, (hh) =>
        hh.query(
          `select log_mill_water('${batchId}', 50,
             '2026-06-20T08:00:00Z'::timestamptz,'dev-1',920400,'WATERKEY');`,
        ),
      ),
    ).rejects.toThrow(/already|anchors|unique|duplicate/i);
    const after = (
      await h.query<{ n: number }>(
        `select count(*)::int as n from mill_water_log where batch_id='${batchId}';`,
      )
    )[0].n;
    expect(after).toBe(before);
  });
});

describe("P2-S3 review fix — cut-point fires a CLOSED-LOOP task onto the /tasks board", () => {
  let h: Harness;
  let batchId: string;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(SEED_LOT); // JC-800
    await h.query(SEED_RECIPE); // target_ph = 4.2
    // a worker + a harvest on this lot so _resolve_ferment_cut_worker resolves an assignee.
    await h.query(
      `insert into workers (id, name, role, daily_rate_usd, attendance, started_year, phone, crew)
         values ('w-mill','Mill Op','Mill Operator',20,'present',2020,'507-0000','wet-mill');`,
    );
    await h.query(
      `insert into plots
         (id, ord, name, block, variety, area_ha, altitude_masl, trees, shade_pct,
          established_year, status, last_inspected, expected_yield_kg, harvested_kg)
         values ('plot-cp', 1, 'Cuesta Piedra', 'A', 'Geisha', 1.2, 1600, 800, 40,
                 2015, 'healthy', '2026-06-18', 1000, 0);`,
    );
    await h.query(
      `insert into harvests (id, date, plot_id, worker_id, cherries_kg, ripeness_pct, brix_avg, lot_code)
         values ('hv-1','2026-06-19','plot-cp','w-mill',120,90,20,'JC-800');`,
    );
    await asAuthenticated(h, (hh) =>
      hh.query(
        `select start_ferment_batch('JC-800','rec-test-anaerobic-v1','Anaerobic',
           '2026-06-20T06:00:00Z'::timestamptz,'dev-1',1,'b-cut');`,
      ),
    );
    batchId = (
      await h.query<{ id: string }>(
        `select id from ferment_batches where lot_code='JC-800' limit 1;`,
      )
    )[0].id;
  });
  afterAll(async () => h.close());

  // FINDING idx 44: the cut signal existed ONLY as v_ferment_cutpoint.cut_reached and a
  // glass chip on /ferment/[batch] — the spec's load-bearing "closed-loop, not a
  // dashboard" task onto the /tasks board was never built. The fix fires a 'Ferment Cut'
  // board task on the FIRST crossing (single-fire), mirroring the S8 schedule_pasada path.
  it("does NOT fire a task while the latest pH is above the recipe target", async () => {
    await asAuthenticated(h, (hh) =>
      hh.query(
        `select record_ferment_reading('${batchId}','ph', 5.0, '2026-06-20T08:00:00Z'::timestamptz,'dev-1',6001,'cut-above');`,
      ),
    );
    const t = await h.query<{ n: number }>(
      `select count(*)::int as n from tasks where category='Ferment Cut';`,
    );
    expect(t[0].n).toBe(0);
  });

  it("fires EXACTLY ONE 'Ferment Cut' board task when pH first crosses the target", async () => {
    await asAuthenticated(h, (hh) =>
      hh.query(
        `select record_ferment_reading('${batchId}','ph', 4.1, '2026-06-20T10:00:00Z'::timestamptz,'dev-1',6002,'cut-cross');`,
      ),
    );
    const t = await h.query<{
      n: number;
      worker_id: string;
      title: string;
      priority: string;
      status: string;
    }>(
      `select count(*)::int as n, max(worker_id) as worker_id, max(title) as title,
              max(priority::text) as priority, max(status::text) as status
         from tasks where category='Ferment Cut';`,
    );
    expect(t[0].n).toBe(1);
    expect(t[0].worker_id).toBeTruthy(); // NOT NULL assignee resolved
    expect(t[0].title.toLowerCase()).toMatch(/cut/);
    // the batch records the fired task (single-fire anchor).
    const b = await h.query<{ fired: string | null }>(
      `select fired_cut_task_id as fired from ferment_batches where id='${batchId}';`,
    );
    expect(b[0].fired).toBeTruthy();
  });

  it("does NOT fire a SECOND task on a subsequent below-target reading (single-fire)", async () => {
    await asAuthenticated(h, (hh) =>
      hh.query(
        `select record_ferment_reading('${batchId}','ph', 4.0, '2026-06-20T12:00:00Z'::timestamptz,'dev-1',6003,'cut-again');`,
      ),
    );
    const t = await h.query<{ n: number }>(
      `select count(*)::int as n from tasks where category='Ferment Cut';`,
    );
    expect(t[0].n).toBe(1);
  });
});
