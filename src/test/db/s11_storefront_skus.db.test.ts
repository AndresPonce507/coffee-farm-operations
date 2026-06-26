// P3-S11 — Catalog + lot-linked SKUs + finished-goods inventory (consumer trunk).
//
// These tests replay the REAL migrations in PGlite (AD-9) and prove the storefront
// catalog slice's load-bearing invariants — written RED first (the migration does not
// yet exist when this file lands).
//
//   (1) CATALOG MINT — create_product + create_sku mint a product master and a
//       lot-linked SKU; create_sku materializes a finished_goods row (on_hand 0).
//   (2) LOT-BACKING FK (invariant 5) — a SKU CANNOT claim a green lot it isn't backed
//       by; create_sku RAISES for an unknown green_lot_code.
//   (3) LEDGER → AGGREGATE — record_fg_movement appends fg_ledger and the trigger
//       rolls the signed qty into finished_goods.on_hand_units; available is GENERATED.
//   (4) OVERSELL FAIL-CLOSED (invariant 2) — a sale that would drive available below
//       zero is REJECTED at the data layer (mirrors prevent_oversell), and on rejection
//       finished_goods is unchanged (whole txn rolls back).
//   (5) IDEMPOTENT — replaying a movement on the same idempotency_key is a no-op
//       (same ledger id, on_hand unchanged).
//   (6) APPEND-ONLY — fg_ledger rejects UPDATE and DELETE.
//   (7) AD-8 GRANTS — authenticated reads every table/view; anon NOTHING; every RPC's
//       execute is revoked from public and granted to authenticated only.
//   (8) TENANT ISOLATION — a SKU minted in tenant A is invisible to tenant B.
//
// All quantity math is hand-computed in the comments next to each assertion.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asTenant, freshDb, type Harness } from "./pgliteHarness";

/** Materialize a fresh green lot of `kg` kg from a brand-new source node (sole-tenant). */
async function makeGreen(h: Harness, source: string, green: string, kg: number, score = 91) {
  await h.query(
    `insert into lots (code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
       values ('${source}', 'milled', 'Geisha', ${kg}, ${kg}, true, now());`,
  );
  await h.query(
    `select materialize_green_lot('${source}', '${green}', ${kg}, ${score}, 'WH-A', now());`,
  );
}

/** Seed a green lot directly for an EXPLICIT tenant (used by the isolation block).
 *  green_lots.lot_code composite-FKs to its OWN lots(tenant_id, code) node, so the
 *  green code must have a matching lots row. */
async function seedGreenForTenant(h: Harness, tenant: string, green: string, kg: number) {
  await h.query(
    `insert into lots (tenant_id, code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
       values ('${tenant}','${green}','green',  'Geisha',${kg},${kg},true,now());`,
  );
  await h.query(
    `insert into green_lots (tenant_id, lot_code, cupping_score, location)
       values ('${tenant}','${green}',91,'WH-A');`,
  );
}

// ──────────────────────────────────────────────────────────────────────────
// 1. HAPPY PATH — product → lot-linked SKU → finished-goods movements.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S11 storefront — catalog, lot-linked SKU, finished-goods ledger", () => {
  let h: Harness;
  let productId: number;
  let skuId: number;
  beforeAll(async () => {
    h = await freshDb();
    await makeGreen(h, "JC-900", "JC-901", 600);
    const p = await h.query<{ id: number }>(
      `select create_product('bop-geisha', 'BoP Geisha', 'Geisha', 'Washed',
         'jasmine, bergamot, honey', 'prod-1') as id;`,
    );
    productId = Number(p[0].id);
    const s = await h.query<{ id: number }>(
      `select create_sku(${productId}, 'JC-901', null, 'whole-bean', '250g',
         2400, '0123456789012', null, false, 'sku-1') as id;`,
    );
    skuId = Number(s[0].id);
  });
  afterAll(async () => h.close());

  it("create_sku links the green lot (the load-bearing traceability link)", async () => {
    const r = await h.query<{ green_lot_code: string; product_id: number }>(
      `select green_lot_code, product_id from product_skus where id = ${skuId};`,
    );
    expect(r[0].green_lot_code).toBe("JC-901");
    expect(Number(r[0].product_id)).toBe(productId);
  });

  it("create_sku materializes a finished_goods row at on_hand 0 / available 0", async () => {
    const r = await h.query<{ on_hand: number; avail: number }>(
      `select on_hand_units as on_hand, available_units as avail
         from finished_goods where sku_id = ${skuId};`,
    );
    expect(Number(r[0].on_hand)).toBe(0);
    expect(Number(r[0].avail)).toBe(0);
  });

  it("record_fg_movement(roast-in +100) rolls into on_hand; available = 100", async () => {
    await h.query(`select record_fg_movement(${skuId}, 100, 'roast-in', 'fg-1');`);
    const r = await h.query<{ on_hand: number; avail: number }>(
      `select on_hand_units as on_hand, available_units as avail
         from finished_goods where sku_id = ${skuId};`,
    );
    // 0 + 100 = 100 on_hand; allocated 0 -> available 100.
    expect(Number(r[0].on_hand)).toBe(100);
    expect(Number(r[0].avail)).toBe(100);
  });

  it("record_fg_movement(sale -30) decrements; available = 70", async () => {
    await h.query(`select record_fg_movement(${skuId}, -30, 'sale', 'fg-2');`);
    const r = await h.query<{ avail: number }>(
      `select available_units as avail from finished_goods where sku_id = ${skuId};`,
    );
    // 100 - 30 = 70.
    expect(Number(r[0].avail)).toBe(70);
  });

  it("OVERSELL FAIL-CLOSED — a sale of 71 (avail 70) is REJECTED at the data layer", async () => {
    await expect(
      h.query(`select record_fg_movement(${skuId}, -71, 'sale', 'fg-oversell');`),
    ).rejects.toThrow();
    // finished_goods unchanged — the whole txn rolled back (still 70 available).
    const r = await h.query<{ avail: number }>(
      `select available_units as avail from finished_goods where sku_id = ${skuId};`,
    );
    expect(Number(r[0].avail)).toBe(70);
  });

  it("IDEMPOTENT — replaying fg-2 returns the same ledger id and does not double-apply", async () => {
    const first = await h.query<{ id: number }>(
      `select id from fg_ledger where idempotency_key like '%:fg-2';`,
    );
    const replay = await h.query<{ id: number }>(
      `select record_fg_movement(${skuId}, -30, 'sale', 'fg-2') as id;`,
    );
    expect(Number(replay[0].id)).toBe(Number(first[0].id));
    const r = await h.query<{ avail: number }>(
      `select available_units as avail from finished_goods where sku_id = ${skuId};`,
    );
    expect(Number(r[0].avail)).toBe(70); // still 70 — not -100.
  });

  it("finished_goods_atp surfaces the SKU's lot + product + available", async () => {
    const r = await h.query<{
      green_lot_code: string;
      product_slug: string;
      available_units: number;
    }>(`select green_lot_code, product_slug, available_units
          from finished_goods_atp where sku_id = ${skuId};`);
    expect(r[0].green_lot_code).toBe("JC-901");
    expect(r[0].product_slug).toBe("bop-geisha");
    expect(Number(r[0].available_units)).toBe(70);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2. LOT-BACKING — a SKU cannot claim a lot it isn't backed by (invariant 5).
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S11 lot-backing — create_sku rejects an unbacked green lot", () => {
  let h: Harness;
  let productId: number;
  beforeAll(async () => {
    h = await freshDb();
    const p = await h.query<{ id: number }>(
      `select create_product('no-lot', 'No Lot', 'Geisha', 'Washed', null, 'prod-x') as id;`,
    );
    productId = Number(p[0].id);
  });
  afterAll(async () => h.close());

  it("create_sku RAISES for a green_lot_code that does not exist", async () => {
    await expect(
      h.query(
        `select create_sku(${productId}, 'JC-DOES-NOT-EXIST', null, 'ground', '340g',
           1800, null, null, false, 'sku-bad');`,
      ),
    ).rejects.toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. APPEND-ONLY — fg_ledger rejects UPDATE and DELETE.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S11 append-only — fg_ledger is immutable", () => {
  let h: Harness;
  let skuId: number;
  beforeAll(async () => {
    h = await freshDb();
    await makeGreen(h, "JC-910", "JC-911", 200);
    const p = await h.query<{ id: number }>(
      `select create_product('immut', 'Immut', 'Geisha', 'Natural', null, 'prod-i') as id;`,
    );
    const s = await h.query<{ id: number }>(
      `select create_sku(${Number(p[0].id)}, 'JC-911', null, 'whole-bean', '1kg',
         9000, null, null, true, 'sku-i') as id;`,
    );
    skuId = Number(s[0].id);
    await h.query(`select record_fg_movement(${skuId}, 50, 'roast-in', 'fg-i1');`);
  });
  afterAll(async () => h.close());

  it("UPDATE on fg_ledger is rejected", async () => {
    await expect(
      h.query(`update fg_ledger set qty_units = 999 where sku_id = ${skuId};`),
    ).rejects.toThrow();
  });
  it("DELETE on fg_ledger is rejected", async () => {
    await expect(
      h.query(`delete from fg_ledger where sku_id = ${skuId};`),
    ).rejects.toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 4. AD-8 GRANTS — per-object SELECT to authenticated; anon nothing; RPC execute.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S11 AD-8 grants — authenticated reads, anon nothing, RPCs locked", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
  });
  afterAll(async () => h.close());

  it("authenticated has SELECT on every new table/view; anon has NONE", async () => {
    const objs = ["products", "product_skus", "finished_goods", "fg_ledger", "finished_goods_atp"];
    for (const o of objs) {
      const r = await h.query<{ a: boolean; an: boolean }>(
        `select has_table_privilege('authenticated','${o}','select') as a,
                has_table_privilege('anon','${o}','select') as an;`,
      );
      expect(r[0].a, `${o} authenticated select`).toBe(true);
      expect(r[0].an, `${o} anon select`).toBe(false);
    }
  });

  it("anon cannot read product_skus (no grant, RLS closed)", async () => {
    await expect(
      asAnon(h, (hh) => hh.query(`select * from product_skus;`)),
    ).rejects.toThrow();
  });

  it("every RPC: authenticated can execute, anon/public cannot", async () => {
    const sigs = [
      "create_product(text,text,text,text,text,text)",
      "create_sku(bigint,text,bigint,text,text,integer,text,text,boolean,text)",
      "record_fg_movement(bigint,integer,text,text)",
    ];
    for (const sig of sigs) {
      const r = await h.query<{ a: boolean; an: boolean }>(
        `select has_function_privilege('authenticated','${sig}','execute') as a,
                has_function_privilege('anon','${sig}','execute') as an;`,
      );
      expect(r[0].a, `${sig} authenticated execute`).toBe(true);
      expect(r[0].an, `${sig} anon execute`).toBe(false);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 5. TENANT ISOLATION — a SKU minted in tenant A is invisible to tenant B.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S11 tenant isolation — catalog does not leak cross-tenant", () => {
  const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(
      `insert into tenants (id, slug, name) values
         ('${A}','tenant-a','Estate A'),('${B}','tenant-b','Estate B');`,
    );
    await seedGreenForTenant(h, A, "JC-921", 300);
    // Mint a product + SKU as tenant A (the SECDEF RPCs stamp tenant from the JWT).
    await asTenant(h, A, async (hh) => {
      const p = await hh.query<{ id: number }>(
        `select create_product('a-geisha','A Geisha','Geisha','Washed',null,'pa') as id;`,
      );
      await hh.query(
        `select create_sku(${Number(p[0].id)}, 'JC-921', null, 'whole-bean', '250g',
           2400, null, null, false, 'sa');`,
      );
    });
  });
  afterAll(async () => h.close());

  it("tenant A sees its own SKU", async () => {
    const rows = await asTenant(h, A, (hh) =>
      hh.query<{ green_lot_code: string }>(`select green_lot_code from product_skus;`),
    );
    expect(rows.length).toBe(1);
    expect(rows[0].green_lot_code).toBe("JC-921");
  });

  it("tenant B sees NONE of A's catalog (RLS clamp)", async () => {
    const rows = await asTenant(h, B, (hh) =>
      hh.query(`select id from product_skus;`),
    );
    expect(rows).toHaveLength(0);
  });
});
