// P3-S10 — Roasting: versioned golden profiles + Artisan .alog import + roast→SKU.
//
// These tests replay the REAL migrations in PGlite (AD-9) and prove the roasting
// slice's load-bearing invariants against HAND-COMPUTED seeds — written RED first.
//
//   (1) GOLDEN-PROFILE GATE — open_roast_batch RAISES against a draft profile; a
//       draft→approved lock is ONE-WAY (the status guard rejects any backward move).
//   (2) OVERSELL REUSE — open_roast_batch commits the green draw as a lot_shipments
//       row, so the SHIPPED prevent_oversell trigger physically rejects roasting more
//       green than ATP, AND green already reserved/shipped to a buyer is unavailable.
//   (3) CONSERVED ROAST EDGE + SHRINKAGE — finalize mints a roasted lots node + a
//       conserved 'roast' lot_edge (kg = consumed green); shrinkage_pct is GENERATED.
//   (4) COGS FLOW — a roasting cost_entry is posted to the roasted lot.
//   (5) ROAST→SKU — link_roast_sku closes the per-bag QR link; requires a finalized batch.
//   (6) .alog DEVIATION — import computes max |BT − interpolated golden target|.
//   (7) IDEMPOTENT finalize — replay returns the SAME roasted code, NO second cost row.
//   (8) APPEND-ONLY — roast_curve_points rejects UPDATE.
//   (9) AD-8 GRANTS — authenticated reads every table/view; anon nothing; RPC execute
//       revoked from public.
//  (10) TENANT ISOLATION — a roast_batch in tenant A is invisible to tenant B.
//
// All money/mass math is hand-computed in the comments next to each assertion.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asTenant, freshDb, type Harness } from "./pgliteHarness";

/** Materialize a fresh green lot of `kg` kg from a brand-new source node. */
async function makeGreen(h: Harness, source: string, green: string, kg: number, score = 89) {
  await h.query(
    `insert into lots (code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
       values ('${source}', 'milled', 'Geisha', ${kg}, ${kg}, true, now());`,
  );
  await h.query(
    `select materialize_green_lot('${source}', '${green}', ${kg}, ${score}, 'WH-A', now());`,
  );
}

async function makeGoldenProfile(h: Harness, name = "Geisha Filter"): Promise<number> {
  // charge 200°C, drop 420°C, total 720s.
  const p = await h.query<{ id: number }>(
    `select create_roast_profile('${name}', 'Geisha', 'light', 200, 420, 720, 20, 'prof-${name}') as id;`,
  );
  await h.query(`select lock_roast_profile(${Number(p[0].id)}, 'lock-${name}');`);
  return Number(p[0].id);
}

async function defaultRoaster(h: Harness): Promise<number> {
  const r = await h.query<{ id: number }>(`select id from roasters order by id limit 1;`);
  return Number(r[0].id);
}

// ──────────────────────────────────────────────────────────────────────────
// 1. HAPPY PATH — golden lock → open → import → finalize → link SKU.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S10 roasting — golden lock, ATP draw, conserved roast edge, COGS, SKU", () => {
  let h: Harness;
  let roasted: string;
  let batchId: number;
  beforeAll(async () => {
    h = await freshDb();
    await makeGreen(h, "JC-800", "JC-801", 800);
    const profileId = await makeGoldenProfile(h);
    const roasterId = await defaultRoaster(h);
    // open: draw 720 kg green to the roaster. ATP 800 >= 720 (shipment 720 committed).
    const b = await h.query<{ id: number }>(
      `select open_roast_batch('JC-801', ${profileId}, ${roasterId}, 720, 'open-1') as id;`,
    );
    batchId = Number(b[0].id);
    // import a 3-point .alog: target(t)=200+(420-200)*t/720.
    //   t=0   bt=200  target=200  dev 0
    //   t=360 bt=300  target=310  dev 10  <- max
    //   t=720 bt=415  target=420  dev 5
    await h.query(
      `select import_roast_alog(${batchId}, 'roast.alog',
        '{"points":[{"t":0,"bt":200,"et":210,"ror":0},{"t":360,"bt":300,"et":320,"ror":12},{"t":720,"bt":415,"et":430,"ror":4}],
          "events":[{"marker":"charge","t":0,"temp":200},{"marker":"drop","t":720,"temp":415}]}'::jsonb,
        'imp-1');`,
    );
    // finalize: roasted 600 of 720 green-in -> shrinkage (720-600)/720 = 0.16667. cost 360.
    const f = await h.query<{ code: string }>(
      `select finalize_roast_batch(${batchId}, 600, 360, 'WH-Roast', 'fin-1') as code;`,
    );
    roasted = f[0].code;
    await h.query(
      `select link_roast_sku(${batchId}, 'GEI-250', 250, 2400, '0123456789012', 'sku-1');`,
    );
  });
  afterAll(async () => h.close());

  it("finalize mints a fresh JC-NNN roasted lots node at stage='roasted'", async () => {
    expect(roasted).toMatch(/^JC-[0-9]{3,}$/);
    const n = await h.query<{ stage: string; kg: number }>(
      `select stage, current_kg as kg from lots where code = '${roasted}';`,
    );
    expect(n[0].stage).toBe("roasted");
    expect(Number(n[0].kg)).toBeCloseTo(600, 6);
  });

  it("a conserved 'roast' lot_edge routes the CONSUMED green (720 kg) from the green lot", async () => {
    const e = await h.query<{ kg: number }>(
      `select kg from lot_edges where parent_code = 'JC-801' and child_code = '${roasted}' and kind = 'roast';`,
    );
    expect(e.length).toBe(1);
    expect(Number(e[0].kg)).toBeCloseTo(720, 6);
  });

  it("shrinkage_pct is GENERATED from the weights (720->600 = 16.667%)", async () => {
    const r = await h.query<{ pct: number; status: string }>(
      `select shrinkage_pct as pct, status from roast_batches where id = ${batchId};`,
    );
    expect(r[0].status).toBe("finalized");
    expect(Number(r[0].pct)).toBeCloseTo(0.166667, 5);
  });

  it("the green draw lowered ATP by the consumed kg (800 - 720 = 80)", async () => {
    const r = await h.query<{ atp: number }>(
      `select atp from green_lots_atp where green_lot_code = 'JC-801';`,
    );
    expect(Number(r[0].atp)).toBeCloseTo(80, 6);
  });

  it("a roasting cost_entry is posted to the roasted lot", async () => {
    const c = await h.query<{ n: number; amt: number }>(
      `select count(*)::int as n, coalesce(sum(amount_usd),0) as amt from cost_entry
         where target_kind = 'lot' and target_code = '${roasted}' and allocation_rule = 'processing';`,
    );
    expect(c[0].n).toBe(1);
    expect(Number(c[0].amt)).toBeCloseTo(360, 6);
  });

  it(".alog import computed the max BT-vs-golden deviation (10°C) + point count", async () => {
    const r = await h.query<{ dev: number; pts: number }>(
      `select max_deviation_c as dev, point_count as pts from roast_alog_imports where batch_id = ${batchId};`,
    );
    expect(Number(r[0].dev)).toBeCloseTo(10, 6);
    expect(Number(r[0].pts)).toBe(3);
    const cp = await h.query<{ n: number }>(
      `select count(*)::int as n from roast_curve_points where batch_id = ${batchId};`,
    );
    expect(cp[0].n).toBe(3);
  });

  it("link_roast_sku closes the per-bag QR link to the roasted lot", async () => {
    const s = await h.query<{ code: string; lot: string }>(
      `select sku_code as code, roasted_lot_code as lot from roast_skus where roast_batch_id = ${batchId};`,
    );
    expect(s[0].code).toBe("GEI-250");
    expect(s[0].lot).toBe(roasted);
  });

  it("roast_traceability stitches roast→green→grade for the QR chain", async () => {
    const t = await h.query<{ green: string; level: string; grade: string }>(
      `select green_lot_code as green, roast_level as level, sca_grade as grade
         from roast_traceability where roast_batch_id = ${batchId};`,
    );
    expect(t[0].green).toBe("JC-801");
    expect(t[0].level).toBe("light");
    expect(t[0].grade).toBe("Specialty"); // cupping 89 -> Specialty band
  });

  it("appends a 'roast_finalized' lot_event keyed on the green lot", async () => {
    const r = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_event where stream_key = 'JC-801' and kind = 'roast_finalized';`,
    );
    expect(r[0].n).toBe(1);
  });

  it("is idempotent on replay: same roasted code, NO second cost_entry", async () => {
    const again = await h.query<{ code: string }>(
      `select finalize_roast_batch(${batchId}, 600, 360, 'WH-Roast', 'fin-1') as code;`,
    );
    expect(again[0].code).toBe(roasted);
    const c = await h.query<{ n: number }>(
      `select count(*)::int as n from cost_entry
         where target_code = '${roasted}' and allocation_rule = 'processing';`,
    );
    expect(c[0].n).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2. THE GOLDEN GATE + ONE-WAY LOCK.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S10 golden-profile gate + one-way status lock", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await makeGreen(h, "JC-810", "JC-811", 500);
  });
  afterAll(async () => h.close());

  it("open_roast_batch RAISES against a DRAFT (un-locked) profile", async () => {
    const p = await h.query<{ id: number }>(
      `select create_roast_profile('Draft Style', 'Geisha', 'medium', 195, 415, 700, 18, 'draft-prof') as id;`,
    );
    const roasterId = await defaultRoaster(h);
    await expect(
      h.query(`select open_roast_batch('JC-811', ${Number(p[0].id)}, ${roasterId}, 100, 'open-draft');`),
    ).rejects.toThrow(/golden|approved|draft/i);
  });

  it("lock is one-way: an approved profile cannot be moved back to draft", async () => {
    const p = await h.query<{ id: number }>(
      `select create_roast_profile('Locked Style', 'Geisha', 'light', 200, 420, 720, 20, 'lock-prof') as id;`,
    );
    const id = Number(p[0].id);
    const s = await h.query<{ s: string }>(`select lock_roast_profile(${id}, 'lk') as s;`);
    expect(s[0].s).toBe("approved");
    await expect(
      h.query(`update roast_profiles set status = 'draft' where id = ${id};`),
    ).rejects.toThrow(/one-way|backward|status/i);
  });

  it("re-locking a non-draft (e.g. retired) profile RAISES", async () => {
    const p = await h.query<{ id: number }>(
      `select create_roast_profile('Retire Style', 'Geisha', 'dark', 205, 430, 760, 15, 'ret-prof') as id;`,
    );
    const id = Number(p[0].id);
    await h.query(`update roast_profiles set status = 'retired' where id = ${id};`); // forward move ok
    await expect(
      h.query(`select lock_roast_profile(${id}, 'lk-ret');`),
    ).rejects.toThrow(/draft|retired|only a draft/i);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. OVERSELL REUSE — the money guarantee, not a parallel counter.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S10 oversell reuse — can't roast green you've sold", () => {
  let h: Harness;
  let profileId: number;
  let roasterId: number;
  beforeAll(async () => {
    h = await freshDb();
    await makeGreen(h, "JC-820", "JC-821", 800);
    profileId = await makeGoldenProfile(h);
    roasterId = await defaultRoaster(h);
  });
  afterAll(async () => h.close());

  it("opening a roast for MORE green than exists is rejected by prevent_oversell", async () => {
    await expect(
      h.query(`select open_roast_batch('JC-821', ${profileId}, ${roasterId}, 900, 'open-over');`),
    ).rejects.toThrow(/oversell|exceed|available/i);
  });

  it("green already RESERVED to a buyer cannot be roasted (committed 750 + 100 > 800)", async () => {
    await h.query(
      `insert into lot_reservations (green_lot_code, buyer, kg) values ('JC-821', 'ACME', 750);`,
    );
    await expect(
      h.query(`select open_roast_batch('JC-821', ${profileId}, ${roasterId}, 100, 'open-resv');`),
    ).rejects.toThrow(/oversell|exceed|available/i);
    // the remaining 50 kg of ATP IS roastable.
    const ok = await h.query<{ id: number }>(
      `select open_roast_batch('JC-821', ${profileId}, ${roasterId}, 50, 'open-ok') as id;`,
    );
    expect(Number(ok[0].id)).toBeGreaterThan(0);
    const atp = await h.query<{ atp: number }>(
      `select atp from green_lots_atp where green_lot_code = 'JC-821';`,
    );
    expect(Number(atp[0].atp)).toBeCloseTo(0, 6); // 800 - 750 - 50
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 4. APPEND-ONLY + link gate.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S10 append-only capture ledgers + SKU finalize gate", () => {
  let h: Harness;
  let batchId: number;
  beforeAll(async () => {
    h = await freshDb();
    await makeGreen(h, "JC-830", "JC-831", 400);
    const profileId = await makeGoldenProfile(h);
    const roasterId = await defaultRoaster(h);
    const b = await h.query<{ id: number }>(
      `select open_roast_batch('JC-831', ${profileId}, ${roasterId}, 200, 'open-4') as id;`,
    );
    batchId = Number(b[0].id);
    await h.query(
      `select import_roast_alog(${batchId}, 'a.alog',
        '{"points":[{"t":0,"bt":200},{"t":720,"bt":420}]}'::jsonb, 'imp-4');`,
    );
  });
  afterAll(async () => h.close());

  it("roast_curve_points is append-only: an UPDATE is rejected", async () => {
    await expect(
      h.query(`update roast_curve_points set bean_temp_c = 1 where batch_id = ${batchId};`),
    ).rejects.toThrow(/append-only|not permitted/i);
  });

  it("link_roast_sku RAISES on a batch that is not yet finalized", async () => {
    await expect(
      h.query(`select link_roast_sku(${batchId}, 'X-250', 250, 2000, null, 'sku-early');`),
    ).rejects.toThrow(/finaliz/i);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 5. AD-8 GRANTS — authenticated reads; anon reads/executes NOTHING.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S10 AD-8 grant posture", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
  });
  afterAll(async () => h.close());

  const OBJECTS = [
    "roasters", "roast_profiles", "roast_batches", "roast_curve_points",
    "roast_events", "roast_alog_imports", "roast_skus",
    "roast_shrinkage_by_lot", "roast_traceability",
  ];

  it("authenticated holds SELECT on every new table/view; anon holds none", async () => {
    for (const t of OBJECTS) {
      const r = await h.query<{ a: boolean; an: boolean }>(
        `select has_table_privilege('authenticated','${t}','select') as a,
                has_table_privilege('anon','${t}','select') as an;`,
      );
      expect(r[0].a, `authenticated should read ${t}`).toBe(true);
      expect(r[0].an, `anon must NOT read ${t}`).toBe(false);
    }
  });

  it("the command RPCs are executable by authenticated, not anon, not public", async () => {
    const fns = [
      "create_roast_profile(text, text, text, numeric, numeric, numeric, numeric, text)",
      "lock_roast_profile(bigint, text)",
      "open_roast_batch(text, bigint, bigint, numeric, text)",
      "import_roast_alog(bigint, text, jsonb, text)",
      "finalize_roast_batch(bigint, numeric, numeric, text, text)",
      "link_roast_sku(bigint, text, integer, integer, text, text)",
    ];
    for (const fn of fns) {
      const r = await h.query<{ a: boolean; an: boolean; pub: boolean }>(
        `select has_function_privilege('authenticated','${fn}','execute') as a,
                has_function_privilege('anon','${fn}','execute') as an,
                has_function_privilege('public','${fn}','execute') as pub;`,
      );
      expect(r[0].a, `authenticated should execute ${fn}`).toBe(true);
      expect(r[0].an, `anon must NOT execute ${fn}`).toBe(false);
      expect(r[0].pub, `public must NOT execute ${fn}`).toBe(false);
    }
  });

  it("anon cannot read roast_batches through the live role posture", async () => {
    await expect(
      asAnon(h, (hh) => hh.query(`select * from roast_batches limit 1;`)),
    ).rejects.toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 6. TENANT ISOLATION — a roast batch in tenant A is invisible to tenant B.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S10 tenant isolation — roast batches do not leak cross-tenant", () => {
  const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(
      `insert into tenants (id, slug, name) values
         ('${A}','tenant-a','Estate A'),('${B}','tenant-b','Estate B');`,
    );
    for (const t of [A, B]) {
      await h.query(
        `insert into lots (tenant_id, code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
           values ('${t}','JC-900','green','Geisha',500,500,true,now());`,
      );
      await h.query(
        `insert into green_lots (tenant_id, lot_code, cupping_score, location)
           values ('${t}','JC-900',88,'WH-A');`,
      );
      await h.query(
        `insert into roasters (tenant_id, name, kind, capacity_kg) values ('${t}','R','drum',12);`,
      );
      await h.query(
        `insert into roast_profiles (tenant_id, name, roast_level, target_charge_temp_c, target_drop_temp_c, target_total_time_s, status)
           values ('${t}','P','light',200,420,720,'approved');`,
      );
      await h.query(
        `insert into roast_batches (tenant_id, green_lot_code, profile_id, roaster_id, green_in_kg)
           select '${t}','JC-900',
                  (select id from roast_profiles where tenant_id='${t}'),
                  (select id from roasters where tenant_id='${t}'), 100;`,
      );
    }
  });
  afterAll(async () => h.close());

  it("as tenant A, only A's roast batch is visible", async () => {
    const rows = await asTenant(h, A, (hh) =>
      hh.query<{ tenant_id: string }>(`select tenant_id from roast_batches;`),
    );
    expect(rows.length).toBe(1);
    expect(rows[0].tenant_id).toBe(A);
  });

  it("as tenant B, A's batch is invisible (no cross-tenant read)", async () => {
    const aVisible = await asTenant(h, B, (hh) =>
      hh.query(`select 1 from roast_batches where tenant_id = '${A}';`),
    );
    expect(aVisible).toHaveLength(0);
  });
});
