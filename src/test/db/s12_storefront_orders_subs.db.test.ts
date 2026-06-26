// P3-S12 — DTC orders + Stripe Checkout (MOCK/$0) + Reserve-Club subscriptions.
//
// These tests replay the REAL migrations in PGlite (AD-9) and prove the slice's
// load-bearing money invariants — written RED first (the migration does not yet exist
// when this file lands).
//
//   (1) SERVER-COMPUTED TOTALS — create_order computes subtotal / ITBMS 7% / total
//       SERVER-SIDE from product_skus.price_usd_cents; a tampered client total is
//       irrelevant (the RPC takes no client total at all).
//   (2) ORDER ALLOCATES FINISHED GOODS — create_order decrements finished_goods via
//       record_fg_movement; an order beyond stock is REJECTED (the S11 fail-closed
//       oversell guard, REUSED — never a parallel counter).
//   (3) IDEMPOTENT ORDER — replaying create_order on the same key is a no-op (same
//       order id, finished goods not double-decremented).
//   (4) STRIPE EXACTLY-ONCE — mark_order_paid is idempotent via webhook_events PK;
//       replaying the same stripe_event_id is a no-op (one webhook_events row, order
//       paid exactly once).
//   (5) RESERVE-CLUB OVERSELL — allocate_subscription_cycle inserts a lot_reservations
//       row so the EXISTING prevent_oversell trigger fires; a draw beyond the scarce
//       green lot's ATP is REJECTED at the data layer (money guarantee REUSED).
//   (6) SUBSCRIPTION LIFECYCLE — create / pause / resume / skip / swap / cancel each
//       append a sub_event and drive the status machine correctly.
//   (7) APPEND-ONLY — sub_allocations, sub_events, webhook_events reject UPDATE/DELETE.
//   (8) AD-8 GRANTS — authenticated reads every table/view; anon NOTHING; browser RPCs
//       execute=authenticated only; mark_order_paid / issue_dgi_cufe execute=service_role
//       only (NEVER authenticated/anon — they are webhook/edge-function callable).
//   (9) TENANT ISOLATION — an order + subscription in tenant A is invisible to tenant B.
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
  reserveClub = false,
): Promise<number> {
  const p = await h.query<{ id: number }>(
    `select create_product('${slug}', '${slug}', 'Geisha', 'Washed', null, 'p-${idem}') as id;`,
  );
  const s = await h.query<{ id: number }>(
    `select create_sku(${Number(p[0].id)}, '${green}', null, 'whole-bean', '250g',
       ${priceCents}, null, null, ${reserveClub}, 's-${idem}') as id;`,
  );
  const skuId = Number(s[0].id);
  if (units > 0) {
    await h.query(`select record_fg_movement(${skuId}, ${units}, 'roast-in', 'fg-${idem}');`);
  }
  return skuId;
}

// ──────────────────────────────────────────────────────────────────────────
// 1. ORDERS — server-computed totals + finished-goods allocation + idempotency.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S12 orders — server-computed totals, FG allocation, idempotency", () => {
  let h: Harness;
  let skuA: number;
  let skuB: number;
  beforeAll(async () => {
    h = await freshDb();
    await makeGreen(h, "JC-900", "JC-901", 600);
    await makeGreen(h, "JC-910", "JC-911", 600);
    skuA = await makeSku(h, "JC-901", "bop-a", 2400, 100, "a");
    skuB = await makeSku(h, "JC-911", "bop-b", 1800, 100, "b");
  });
  afterAll(async () => h.close());

  it("create_order computes subtotal, ITBMS 7%, and total SERVER-SIDE", async () => {
    const lines = JSON.stringify([
      { sku_id: skuA, qty_units: 2 },
      { sku_id: skuB, qty_units: 1 },
    ]).replace(/'/g, "''");
    const o = await h.query<{ id: number }>(
      `select create_order('ana@example.com', 'Ana', 'web', 'USD', '${lines}'::jsonb, 'ord-1') as id;`,
    );
    const oid = Number(o[0].id);
    // subtotal = 2400*2 + 1800*1 = 6600 ; ITBMS 7% = round(6600*0.07) = 462 ; total = 7062.
    const r = await h.query<{ sub: number; tax: number; total: number }>(
      `select subtotal_cents as sub, dgi_tax_cents as tax, total_cents as total
         from orders where id = ${oid};`,
    );
    expect(Number(r[0].sub)).toBe(6600);
    expect(Number(r[0].tax)).toBe(462);
    expect(Number(r[0].total)).toBe(7062);
  });

  it("order_lines capture the SKU's green_lot_code for provenance/COGS", async () => {
    const r = await h.query<{ green_lot_code: string; cnt: number }>(
      `select green_lot_code, count(*) over () as cnt
         from order_lines ol join orders o on o.id = ol.order_id
        where o.idempotency_key like '%:ord-1' order by ol.id limit 1;`,
    );
    expect(r[0].green_lot_code).toBe("JC-901");
    expect(Number(r[0].cnt)).toBe(2);
  });

  it("create_order ALLOCATES finished goods (skuA available 100 -> 98)", async () => {
    const r = await h.query<{ avail: number }>(
      `select available_units as avail from finished_goods where sku_id = ${skuA};`,
    );
    // 100 - 2 = 98.
    expect(Number(r[0].avail)).toBe(98);
  });

  it("IDEMPOTENT — replaying ord-1 returns the same order id; FG not double-decremented", async () => {
    const first = await h.query<{ id: number }>(
      `select id from orders where idempotency_key like '%:ord-1';`,
    );
    const lines = JSON.stringify([
      { sku_id: skuA, qty_units: 2 },
      { sku_id: skuB, qty_units: 1 },
    ]).replace(/'/g, "''");
    const replay = await h.query<{ id: number }>(
      `select create_order('ana@example.com', 'Ana', 'web', 'USD', '${lines}'::jsonb, 'ord-1') as id;`,
    );
    expect(Number(replay[0].id)).toBe(Number(first[0].id));
    const r = await h.query<{ avail: number }>(
      `select available_units as avail from finished_goods where sku_id = ${skuA};`,
    );
    expect(Number(r[0].avail)).toBe(98); // still 98 — not 96.
  });

  it("OVERSELL FAIL-CLOSED — an order beyond stock is REJECTED at the data layer", async () => {
    const lines = JSON.stringify([{ sku_id: skuA, qty_units: 1000 }]).replace(/'/g, "''");
    await expect(
      h.query(
        `select create_order('big@example.com', 'Big', 'web', 'USD', '${lines}'::jsonb, 'ord-big');`,
      ),
    ).rejects.toThrow();
    // finished_goods unchanged (whole txn rolled back).
    const r = await h.query<{ avail: number }>(
      `select available_units as avail from finished_goods where sku_id = ${skuA};`,
    );
    expect(Number(r[0].avail)).toBe(98);
  });

  it("v_order_book surfaces the order with its computed total", async () => {
    const r = await h.query<{ total_cents: number; customer_email: string }>(
      `select total_cents, customer_email from v_order_book
         where idempotency_key like '%:ord-1';`,
    );
    expect(Number(r[0].total_cents)).toBe(7062);
    expect(r[0].customer_email).toBe("ana@example.com");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2. STRIPE EXACTLY-ONCE — mark_order_paid idempotent via webhook_events PK.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S12 mark_order_paid — exactly-once via webhook_events PK", () => {
  let h: Harness;
  let oid: number;
  beforeAll(async () => {
    h = await freshDb();
    await makeGreen(h, "JC-920", "JC-921", 300);
    const sku = await makeSku(h, "JC-921", "paid-sku", 2400, 50, "p");
    const lines = JSON.stringify([{ sku_id: sku, qty_units: 1 }]).replace(/'/g, "''");
    const o = await h.query<{ id: number }>(
      `select create_order('buy@example.com', 'Buy', 'web', 'USD', '${lines}'::jsonb, 'ord-p') as id;`,
    );
    oid = Number(o[0].id);
  });
  afterAll(async () => h.close());

  it("order starts 'pending'", async () => {
    const r = await h.query<{ status: string }>(`select status from orders where id = ${oid};`);
    expect(r[0].status).toBe("pending");
  });

  it("mark_order_paid flips status to 'paid' and stamps the payment intent", async () => {
    await h.query(`select mark_order_paid(${oid}, 'evt_1', 'pi_1', 'mp-1');`);
    const r = await h.query<{ status: string; pi: string }>(
      `select status, stripe_payment_intent as pi from orders where id = ${oid};`,
    );
    expect(r[0].status).toBe("paid");
    expect(r[0].pi).toBe("pi_1");
  });

  it("replaying the SAME stripe_event_id is a no-op (one webhook_events row, paid once)", async () => {
    await h.query(`select mark_order_paid(${oid}, 'evt_1', 'pi_1', 'mp-2');`);
    const w = await h.query<{ n: number }>(
      `select count(*)::int as n from webhook_events where stripe_event_id = 'evt_1';`,
    );
    expect(Number(w[0].n)).toBe(1);
    const r = await h.query<{ status: string }>(`select status from orders where id = ${oid};`);
    expect(r[0].status).toBe("paid");
  });

  it("issue_dgi_cufe stamps the fiscal folio (no PAC call — $0 path)", async () => {
    await h.query(`select issue_dgi_cufe(${oid}, 'CUFE-ABC-123', 'cufe-1');`);
    const r = await h.query<{ cufe: string }>(`select dgi_cufe as cufe from orders where id = ${oid};`);
    expect(r[0].cufe).toBe("CUFE-ABC-123");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. RESERVE CLUB — subscription lifecycle + oversell-guarded allocation.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S12 reserve club — subscriptions + allocation reuse prevent_oversell", () => {
  let h: Harness;
  let subId: number;
  let skuId: number;
  beforeAll(async () => {
    h = await freshDb();
    await makeGreen(h, "JC-930", "JC-931", 100); // a scarce 100kg micro-lot
    skuId = await makeSku(h, "JC-931", "geisha-club", 30000, 0, "club", true);
    const s = await h.query<{ id: number }>(
      `select create_subscription('club@example.com', 'Club', ${skuId}, 'monthly', 1, 'sub_1', 'cs-1') as id;`,
    );
    subId = Number(s[0].id);
  });
  afterAll(async () => h.close());

  it("create_subscription starts 'active' with a 'created' sub_event", async () => {
    const r = await h.query<{ status: string }>(
      `select status from subscriptions where id = ${subId};`,
    );
    expect(r[0].status).toBe("active");
    const e = await h.query<{ n: number }>(
      `select count(*)::int as n from sub_events where subscription_id = ${subId} and kind = 'created';`,
    );
    expect(Number(e[0].n)).toBe(1);
  });

  it("allocate_subscription_cycle inserts a lot_reservations row (prevent_oversell fires)", async () => {
    await h.query(
      `select allocate_subscription_cycle(${subId}, 'JC-931', 30, '2026-07', 'al-1');`,
    );
    const res = await h.query<{ n: number; kg: number }>(
      `select count(*)::int as n, coalesce(sum(kg),0) as kg
         from lot_reservations where green_lot_code = 'JC-931';`,
    );
    expect(Number(res[0].n)).toBe(1);
    expect(Number(res[0].kg)).toBe(30);
    const a = await h.query<{ n: number }>(
      `select count(*)::int as n from sub_allocations where subscription_id = ${subId};`,
    );
    expect(Number(a[0].n)).toBe(1);
  });

  it("RESERVE-CLUB OVERSELL — a draw beyond the lot's ATP is REJECTED (30+80 > 100)", async () => {
    await expect(
      h.query(`select allocate_subscription_cycle(${subId}, 'JC-931', 80, '2026-08', 'al-2');`),
    ).rejects.toThrow();
    // The scarce lot still shows only 30kg reserved (the txn rolled back).
    const r = await h.query<{ reserved: number; atp: number }>(
      `select reserved_kg as reserved, atp from green_lots_atp where green_lot_code = 'JC-931';`,
    );
    expect(Number(r[0].reserved)).toBe(30);
    expect(Number(r[0].atp)).toBe(70);
  });

  it("lifecycle: pause -> resume -> skip -> swap -> cancel, each appends a sub_event", async () => {
    await h.query(`select pause_subscription(${subId}, 'pa-1');`);
    let r = await h.query<{ status: string }>(`select status from subscriptions where id = ${subId};`);
    expect(r[0].status).toBe("paused");

    await h.query(`select resume_subscription(${subId}, 're-1');`);
    r = await h.query<{ status: string }>(`select status from subscriptions where id = ${subId};`);
    expect(r[0].status).toBe("active");

    await h.query(`select skip_subscription_cycle(${subId}, '2026-09', 'sk-1');`);
    r = await h.query<{ status: string }>(`select status from subscriptions where id = ${subId};`);
    expect(r[0].status).toBe("active"); // skip does not change status

    const line = await h.query<{ id: number }>(
      `select id from subscription_lines where subscription_id = ${subId} limit 1;`,
    );
    await h.query(`select swap_subscription_sku(${subId}, ${Number(line[0].id)}, ${skuId}, 'sw-1');`);

    await h.query(`select cancel_subscription(${subId}, 'ca-1');`);
    r = await h.query<{ status: string }>(`select status from subscriptions where id = ${subId};`);
    expect(r[0].status).toBe("cancelled");

    const kinds = await h.query<{ kind: string }>(
      `select distinct kind from sub_events where subscription_id = ${subId} order by kind;`,
    );
    const set = kinds.map((k) => k.kind);
    for (const k of ["created", "allocated", "paused", "resumed", "skipped", "swapped", "cancelled"]) {
      expect(set, `sub_event kind ${k}`).toContain(k);
    }
  });

  it("record_dunning_event(final) marks the subscription past_due", async () => {
    const s2 = await h.query<{ id: number }>(
      `select create_subscription('due@example.com', 'Due', ${skuId}, 'monthly', 1, 'sub_2', 'cs-2') as id;`,
    );
    const id2 = Number(s2[0].id);
    await h.query(`select record_dunning_event(${id2}, 'final', 'dn-1');`);
    const r = await h.query<{ status: string }>(`select status from subscriptions where id = ${id2};`);
    expect(r[0].status).toBe("past_due");
    const e = await h.query<{ n: number }>(
      `select count(*)::int as n from sub_events where subscription_id = ${id2} and kind = 'dunning';`,
    );
    expect(Number(e[0].n)).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 4. APPEND-ONLY — sub_allocations, sub_events, webhook_events are immutable.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S12 append-only — claim/event ledgers reject UPDATE and DELETE", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await makeGreen(h, "JC-940", "JC-941", 100);
    const sku = await makeSku(h, "JC-941", "immut-club", 30000, 0, "im", true);
    const s = await h.query<{ id: number }>(
      `select create_subscription('im@example.com', 'Im', ${sku}, 'monthly', 1, 'sub_i', 'csi') as id;`,
    );
    const subId = Number(s[0].id);
    await h.query(`select allocate_subscription_cycle(${subId}, 'JC-941', 10, '2026-07', 'ali');`);
    const o = await makeGreen(h, "JC-942", "JC-943", 100);
    void o;
    const sku2 = await makeSku(h, "JC-943", "im2", 2400, 10, "im2");
    const lines = JSON.stringify([{ sku_id: sku2, qty_units: 1 }]).replace(/'/g, "''");
    const ord = await h.query<{ id: number }>(
      `select create_order('im@example.com','Im','web','USD','${lines}'::jsonb,'ord-im') as id;`,
    );
    await h.query(`select mark_order_paid(${Number(ord[0].id)}, 'evt_im', 'pi_im', 'mpi');`);
  });
  afterAll(async () => h.close());

  it("sub_allocations rejects UPDATE and DELETE", async () => {
    await expect(h.query(`update sub_allocations set kg = 999;`)).rejects.toThrow();
    await expect(h.query(`delete from sub_allocations;`)).rejects.toThrow();
  });
  it("sub_events rejects UPDATE and DELETE", async () => {
    await expect(h.query(`update sub_events set kind = 'x';`)).rejects.toThrow();
    await expect(h.query(`delete from sub_events;`)).rejects.toThrow();
  });
  it("webhook_events rejects UPDATE and DELETE", async () => {
    await expect(h.query(`update webhook_events set event_type = 'x';`)).rejects.toThrow();
    await expect(h.query(`delete from webhook_events;`)).rejects.toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 5. AD-8 GRANTS — authenticated reads; anon nothing; webhook RPCs = service_role.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S12 AD-8 grants — reads, anon-nothing, browser vs service_role RPCs", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
  });
  afterAll(async () => h.close());

  it("authenticated has SELECT on every new table/view; anon has NONE", async () => {
    const objs = [
      "customers", "orders", "order_lines", "webhook_events",
      "subscriptions", "subscription_lines", "sub_allocations", "sub_events",
      "v_order_book", "v_subscription_board", "v_order_cogs",
    ];
    for (const o of objs) {
      const r = await h.query<{ a: boolean; an: boolean }>(
        `select has_table_privilege('authenticated','${o}','select') as a,
                has_table_privilege('anon','${o}','select') as an;`,
      );
      expect(r[0].a, `${o} authenticated select`).toBe(true);
      expect(r[0].an, `${o} anon select`).toBe(false);
    }
  });

  it("anon cannot read orders (no grant, RLS closed)", async () => {
    await expect(asAnon(h, (hh) => hh.query(`select * from orders;`))).rejects.toThrow();
  });

  it("browser RPCs: authenticated can execute, anon CANNOT", async () => {
    const sigs = [
      "create_order(text,text,text,text,jsonb,text)",
      "create_checkout_order(text,text,text,jsonb,text,text)",
      "create_subscription(text,text,bigint,text,integer,text,text)",
      "pause_subscription(bigint,text)",
      "resume_subscription(bigint,text)",
      "skip_subscription_cycle(bigint,text,text)",
      "swap_subscription_sku(bigint,bigint,bigint,text)",
      "cancel_subscription(bigint,text)",
      "allocate_subscription_cycle(bigint,text,numeric,text,text)",
      "record_dunning_event(bigint,text,text)",
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

  it("webhook RPCs are service_role-only: NOT authenticated, NOT anon", async () => {
    const sigs = ["mark_order_paid(bigint,text,text,text)", "issue_dgi_cufe(bigint,text,text)"];
    for (const sig of sigs) {
      const r = await h.query<{ s: boolean; a: boolean; an: boolean }>(
        `select has_function_privilege('service_role','${sig}','execute') as s,
                has_function_privilege('authenticated','${sig}','execute') as a,
                has_function_privilege('anon','${sig}','execute') as an;`,
      );
      expect(r[0].s, `${sig} service_role execute`).toBe(true);
      expect(r[0].a, `${sig} authenticated execute`).toBe(false);
      expect(r[0].an, `${sig} anon execute`).toBe(false);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 6. TENANT ISOLATION — an order + subscription in tenant A is invisible to B.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S12 tenant isolation — orders/subscriptions do not leak cross-tenant", () => {
  const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(
      `insert into tenants (id, slug, name) values
         ('${A}','tenant-a','Estate A'),('${B}','tenant-b','Estate B');`,
    );
    // Seed a green lot + stocked SKU for tenant A, then place an order as A.
    await h.query(
      `insert into lots (tenant_id, code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
         values ('${A}','JC-951','green','Geisha',300,300,true,now());`,
    );
    await h.query(
      `insert into green_lots (tenant_id, lot_code, cupping_score, location)
         values ('${A}','JC-951',91,'WH-A');`,
    );
    await asTenant(h, A, async (hh) => {
      const sku = await makeSku(hh, "JC-951", "a-sku", 2400, 20, "ta");
      const lines = JSON.stringify([{ sku_id: sku, qty_units: 1 }]).replace(/'/g, "''");
      await hh.query(
        `select create_order('a@example.com','A','web','USD','${lines}'::jsonb,'ord-a');`,
      );
      await hh.query(
        `select create_subscription('a@example.com','A',${sku},'monthly',1,'sub_a','csa');`,
      );
    });
  });
  afterAll(async () => h.close());

  it("tenant A sees its own order + subscription", async () => {
    const o = await asTenant(h, A, (hh) => hh.query(`select id from orders;`));
    const s = await asTenant(h, A, (hh) => hh.query(`select id from subscriptions;`));
    expect(o.length).toBe(1);
    expect(s.length).toBe(1);
  });

  it("tenant B sees NONE of A's orders or subscriptions (RLS clamp)", async () => {
    const o = await asTenant(h, B, (hh) => hh.query(`select id from orders;`));
    const s = await asTenant(h, B, (hh) => hh.query(`select id from subscriptions;`));
    expect(o).toHaveLength(0);
    expect(s).toHaveLength(0);
  });
});
