// P3-S14 — Offline DGI farm-store/café POS (the $0 non-fiscal path).
//
// These tests replay the REAL migrations in PGlite (AD-9) and prove the slice's
// load-bearing money + exactly-once invariants — written RED first (the migration
// `20260706093000_pos.sql` does not yet exist when this file lands).
//
//   (1) A POS SALE *IS* AN ORDER (channel='pos') — record_pos_sale delegates to the
//       shipped create_order: server-computed subtotal / ITBMS 7% / total from
//       product_skus.price_usd_cents (the client supplies NO total), and decrements
//       finished_goods via record_fg_movement (the S11 fail-closed guard — the money
//       guarantee REUSED, never a parallel counter).
//   (2) HUMAN FOLIO — record_pos_sale mints a per-tenant POS-NNNN sale_no and links the
//       order + terminal + (device_id, device_seq) offline coordinates.
//   (3) IDEMPOTENT (idempotency_key) — replaying the same client key returns the same
//       sale_no; finished goods are NOT double-decremented (a double-sync never
//       double-charges/double-decrements).
//   (4) OFFLINE EXACTLY-ONCE (device_id, device_seq) — a re-sync carrying the SAME device
//       coordinates but a different idempotency_key is REJECTED at the data layer (the
//       UNIQUE backstop fires; the whole txn rolls back so finished goods are unchanged).
//   (5) OVERSELL FAIL-CLOSED — a POS sale beyond stock is REJECTED (S11 guard) and the
//       whole sale rolls back (no order, no fg decrement).
//   (6) PENDING FISCAL STAMP — stamp_pos_dgi_cufe stamps the fiscal folio later ($0 path:
//       an internal non-fiscal recibo, no PAC contacted). service_role-only.
//   (7) NO CLIENT WRITE — authenticated has no UPDATE/DELETE grant on pos_sales (writes
//       flow only through the SECDEF RPCs).
//   (8) AD-8 GRANTS — authenticated reads every table/view; anon NOTHING; browser RPCs
//       execute=authenticated only; stamp_pos_dgi_cufe execute=service_role only.
//   (9) TENANT ISOLATION — a POS sale in tenant A is invisible to tenant B.
//
// All money/quantity math is hand-computed in the comments next to each assertion.

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

/** Mint a product + lot-linked SKU and stock it with `units` of finished goods. Returns sku id. */
async function makeSku(
  h: Harness,
  green: string,
  slug: string,
  priceCents: number,
  units: number,
  idem: string,
): Promise<number> {
  const p = await h.query<{ id: number }>(
    `select create_product('${slug}', '${slug}', 'Geisha', 'Washed', null, 'p-${idem}') as id;`,
  );
  const s = await h.query<{ id: number }>(
    `select create_sku(${Number(p[0].id)}, '${green}', null, 'whole-bean', '250g',
       ${priceCents}, null, null, false, 's-${idem}') as id;`,
  );
  const skuId = Number(s[0].id);
  if (units > 0) {
    await h.query(`select record_fg_movement(${skuId}, ${units}, 'roast-in', 'fg-${idem}');`);
  }
  return skuId;
}

const linesJson = (lines: Array<{ sku_id: number; qty_units: number }>) =>
  JSON.stringify(lines).replace(/'/g, "''");

// ──────────────────────────────────────────────────────────────────────────
// 1. POS SALE = ORDER — server-computed totals, FG allocation, folio, idempotency.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S14 record_pos_sale — order delegation, totals, FG allocation, folio", () => {
  let h: Harness;
  let sku: number;
  beforeAll(async () => {
    h = await freshDb();
    await makeGreen(h, "JC-900", "JC-901", 600);
    sku = await makeSku(h, "JC-901", "bag-a", 2400, 100, "a");
    await h.query(
      `select register_pos_terminal('FARM-STORE', 'Janson Farm Store', 'Volcán', 'term-1');`,
    );
  });
  afterAll(async () => h.close());

  it("record_pos_sale mints a POS-NNNN folio and creates a channel='pos' order", async () => {
    const lines = linesJson([{ sku_id: sku, qty_units: 2 }]);
    const r = await h.query<{ no: string }>(
      `select record_pos_sale('FARM-STORE', 'walkin@pos.local', 'Walk-in', 'POS-DEV-1', 1,
         '${lines}'::jsonb, 'USD', 'sale-1') as no;`,
    );
    expect(r[0].no).toBe("POS-0001");
    // The linked order is channel='pos' with server-computed totals.
    // subtotal = 2400*2 = 4800 ; ITBMS 7% = round(4800*0.07) = 336 ; total = 5136.
    const o = await h.query<{ channel: string; sub: number; tax: number; total: number }>(
      `select o.channel, o.subtotal_cents as sub, o.dgi_tax_cents as tax, o.total_cents as total
         from orders o join pos_sales ps on ps.order_id = o.id where ps.sale_no = 'POS-0001';`,
    );
    expect(o[0].channel).toBe("pos");
    expect(Number(o[0].sub)).toBe(4800);
    expect(Number(o[0].tax)).toBe(336);
    expect(Number(o[0].total)).toBe(5136);
  });

  it("the sale ALLOCATES finished goods (S11 guard reused): available 100 -> 98", async () => {
    const r = await h.query<{ avail: number }>(
      `select available_units as avail from finished_goods where sku_id = ${sku};`,
    );
    expect(Number(r[0].avail)).toBe(98); // 100 - 2
  });

  it("pos_sales captures the terminal + offline (device_id, device_seq) coordinates", async () => {
    const r = await h.query<{ device_id: string; device_seq: number; tname: string }>(
      `select ps.device_id, ps.device_seq, t.name as tname
         from pos_sales ps join pos_terminals t on t.id = ps.terminal_id
        where ps.sale_no = 'POS-0001';`,
    );
    expect(r[0].device_id).toBe("POS-DEV-1");
    expect(Number(r[0].device_seq)).toBe(1);
    expect(r[0].tname).toBe("Janson Farm Store");
  });

  it("v_pos_sales_book surfaces the sale with its computed total", async () => {
    const r = await h.query<{ total_cents: number; terminal_name: string }>(
      `select total_cents, terminal_name from v_pos_sales_book where sale_no = 'POS-0001';`,
    );
    expect(Number(r[0].total_cents)).toBe(5136);
    expect(r[0].terminal_name).toBe("Janson Farm Store");
  });

  it("a SECOND sale mints POS-0002 (per-tenant monotonic folio)", async () => {
    const lines = linesJson([{ sku_id: sku, qty_units: 1 }]);
    const r = await h.query<{ no: string }>(
      `select record_pos_sale('FARM-STORE', 'walkin@pos.local', 'Walk-in', 'POS-DEV-1', 2,
         '${lines}'::jsonb, 'USD', 'sale-2') as no;`,
    );
    expect(r[0].no).toBe("POS-0002");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2. EXACTLY-ONCE — idempotency_key replay + (device_id, device_seq) backstop.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S14 exactly-once — idempotency_key replay + device-coordinate backstop", () => {
  let h: Harness;
  let sku: number;
  beforeAll(async () => {
    h = await freshDb();
    await makeGreen(h, "JC-910", "JC-911", 300);
    sku = await makeSku(h, "JC-911", "bag-b", 1800, 50, "b");
    await h.query(`select register_pos_terminal('CAFE', 'Lagunas Café', 'Lagunas', 'term-c');`);
    const lines = linesJson([{ sku_id: sku, qty_units: 3 }]);
    await h.query(
      `select record_pos_sale('CAFE', 'c@pos.local', 'Café', 'CAFE-DEV', 7,
         '${lines}'::jsonb, 'USD', 'csale-1');`,
    );
  });
  afterAll(async () => h.close());

  it("starts at available 47 (50 - 3)", async () => {
    const r = await h.query<{ avail: number }>(
      `select available_units as avail from finished_goods where sku_id = ${sku};`,
    );
    expect(Number(r[0].avail)).toBe(47);
  });

  it("IDEMPOTENT replay (same key) returns the same folio; FG NOT double-decremented", async () => {
    const lines = linesJson([{ sku_id: sku, qty_units: 3 }]);
    const replay = await h.query<{ no: string }>(
      `select record_pos_sale('CAFE', 'c@pos.local', 'Café', 'CAFE-DEV', 7,
         '${lines}'::jsonb, 'USD', 'csale-1') as no;`,
    );
    expect(replay[0].no).toBe("POS-0001");
    const r = await h.query<{ avail: number }>(
      `select available_units as avail from finished_goods where sku_id = ${sku};`,
    );
    expect(Number(r[0].avail)).toBe(47); // still 47, not 44
    const n = await h.query<{ n: number }>(`select count(*)::int as n from pos_sales;`);
    expect(Number(n[0].n)).toBe(1);
  });

  it("DEVICE BACKSTOP — same (device_id, device_seq) + different key is REJECTED; FG unchanged", async () => {
    const lines = linesJson([{ sku_id: sku, qty_units: 3 }]);
    await expect(
      h.query(
        `select record_pos_sale('CAFE', 'c@pos.local', 'Café', 'CAFE-DEV', 7,
           '${lines}'::jsonb, 'USD', 'csale-1-REGEN');`,
      ),
    ).rejects.toThrow();
    // The whole txn rolled back — no new order, no second decrement.
    const r = await h.query<{ avail: number }>(
      `select available_units as avail from finished_goods where sku_id = ${sku};`,
    );
    expect(Number(r[0].avail)).toBe(47);
    const n = await h.query<{ n: number }>(`select count(*)::int as n from pos_sales;`);
    expect(Number(n[0].n)).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. OVERSELL FAIL-CLOSED + fiscal stamp.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S14 oversell fail-closed + pending fiscal stamp", () => {
  let h: Harness;
  let sku: number;
  let saleId: number;
  beforeAll(async () => {
    h = await freshDb();
    await makeGreen(h, "JC-920", "JC-921", 100);
    sku = await makeSku(h, "JC-921", "bag-c", 2400, 5, "c");
    await h.query(`select register_pos_terminal('FS', 'Janson Farm Store', 'Volcán', 'term-fs');`);
    const lines = linesJson([{ sku_id: sku, qty_units: 1 }]);
    await h.query(
      `select record_pos_sale('FS', 'x@pos.local', 'X', 'FS-DEV', 1, '${lines}'::jsonb, 'USD', 'fs-1');`,
    );
    const s = await h.query<{ id: number }>(`select id from pos_sales where sale_no = 'POS-0001';`);
    saleId = Number(s[0].id);
  });
  afterAll(async () => h.close());

  it("a POS sale beyond stock is REJECTED; nothing committed", async () => {
    const lines = linesJson([{ sku_id: sku, qty_units: 999 }]);
    await expect(
      h.query(
        `select record_pos_sale('FS', 'x@pos.local', 'X', 'FS-DEV', 2, '${lines}'::jsonb, 'USD', 'fs-big');`,
      ),
    ).rejects.toThrow();
    const r = await h.query<{ avail: number }>(
      `select available_units as avail from finished_goods where sku_id = ${sku};`,
    );
    expect(Number(r[0].avail)).toBe(4); // 5 - 1 (the first sale), the rejected one rolled back
    const n = await h.query<{ n: number }>(`select count(*)::int as n from pos_sales;`);
    expect(Number(n[0].n)).toBe(1);
  });

  it("pos_sales.dgi_cufe is NULL until a fiscal stamp ($0 path: pending)", async () => {
    const r = await h.query<{ cufe: string | null }>(
      `select dgi_cufe as cufe from pos_sales where id = ${saleId};`,
    );
    expect(r[0].cufe).toBeNull();
  });

  it("stamp_pos_dgi_cufe stamps the fiscal folio (no PAC call) and is idempotent", async () => {
    await h.query(`select stamp_pos_dgi_cufe(${saleId}, 'CUFE-POS-001', 'stamp-1');`);
    let r = await h.query<{ cufe: string }>(
      `select dgi_cufe as cufe from pos_sales where id = ${saleId};`,
    );
    expect(r[0].cufe).toBe("CUFE-POS-001");
    // Re-stamp is a no-op (already stamped).
    await h.query(`select stamp_pos_dgi_cufe(${saleId}, 'CUFE-DIFFERENT', 'stamp-2');`);
    r = await h.query<{ cufe: string }>(`select dgi_cufe as cufe from pos_sales where id = ${saleId};`);
    expect(r[0].cufe).toBe("CUFE-POS-001");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 4. AD-8 GRANTS + no client write.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S14 AD-8 grants — reads, anon-nothing, browser vs service_role RPCs", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
  });
  afterAll(async () => h.close());

  it("authenticated has SELECT on every new table/view; anon has NONE", async () => {
    for (const o of ["pos_terminals", "pos_sales", "v_pos_sales_book"]) {
      const r = await h.query<{ a: boolean; an: boolean }>(
        `select has_table_privilege('authenticated','${o}','select') as a,
                has_table_privilege('anon','${o}','select') as an;`,
      );
      expect(r[0].a, `${o} authenticated select`).toBe(true);
      expect(r[0].an, `${o} anon select`).toBe(false);
    }
  });

  it("authenticated has NO update/delete grant on pos_sales (writes via SECDEF RPC only)", async () => {
    const r = await h.query<{ u: boolean; d: boolean }>(
      `select has_table_privilege('authenticated','pos_sales','update') as u,
              has_table_privilege('authenticated','pos_sales','delete') as d;`,
    );
    expect(r[0].u).toBe(false);
    expect(r[0].d).toBe(false);
  });

  it("anon cannot read pos_sales (no grant, RLS closed)", async () => {
    await expect(asAnon(h, (hh) => hh.query(`select * from pos_sales;`))).rejects.toThrow();
  });

  it("browser RPCs: authenticated can execute, anon CANNOT", async () => {
    const sigs = [
      "register_pos_terminal(text,text,text,text)",
      "record_pos_sale(text,text,text,text,bigint,jsonb,text,text)",
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

  it("stamp_pos_dgi_cufe is service_role-only: NOT authenticated, NOT anon", async () => {
    const sig = "stamp_pos_dgi_cufe(bigint,text,text)";
    const r = await h.query<{ s: boolean; a: boolean; an: boolean }>(
      `select has_function_privilege('service_role','${sig}','execute') as s,
              has_function_privilege('authenticated','${sig}','execute') as a,
              has_function_privilege('anon','${sig}','execute') as an;`,
    );
    expect(r[0].s).toBe(true);
    expect(r[0].a).toBe(false);
    expect(r[0].an).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 5. TENANT ISOLATION — a POS sale in tenant A is invisible to tenant B.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S14 tenant isolation — POS sales do not leak cross-tenant", () => {
  const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(
      `insert into tenants (id, slug, name) values
         ('${A}','tenant-a','Estate A'),('${B}','tenant-b','Estate B');`,
    );
    await h.query(
      `insert into lots (tenant_id, code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
         values ('${A}','JC-951','green','Geisha',300,300,true,now());`,
    );
    await h.query(
      `insert into green_lots (tenant_id, lot_code, cupping_score, location)
         values ('${A}','JC-951',91,'WH-A');`,
    );
    await asTenant(h, A, async (hh) => {
      const sku = await makeSku(hh, "JC-951", "a-bag", 2400, 20, "ta");
      await hh.query(`select register_pos_terminal('A-FS', 'A Store', 'A', 'term-a');`);
      const lines = linesJson([{ sku_id: sku, qty_units: 1 }]);
      await hh.query(
        `select record_pos_sale('A-FS', 'a@pos.local', 'A', 'A-DEV', 1, '${lines}'::jsonb, 'USD', 'a-1');`,
      );
    });
  });
  afterAll(async () => h.close());

  it("tenant A sees its own POS sale + terminal", async () => {
    const s = await asTenant(h, A, (hh) => hh.query(`select id from pos_sales;`));
    const t = await asTenant(h, A, (hh) => hh.query(`select id from pos_terminals;`));
    expect(s.length).toBe(1);
    expect(t.length).toBe(1);
  });

  it("tenant B sees NONE of A's POS sales or terminals (RLS clamp)", async () => {
    const s = await asTenant(h, B, (hh) => hh.query(`select id from pos_sales;`));
    const t = await asTenant(h, B, (hh) => hh.query(`select id from pos_terminals;`));
    expect(s).toHaveLength(0);
    expect(t).toHaveLength(0);
  });
});
