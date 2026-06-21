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
