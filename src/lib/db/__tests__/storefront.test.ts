import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  FgLedgerRow,
  FinishedGoodsAtpRow,
  ProductRow,
  ProductSkuRow,
} from "@/lib/db/storefront";

/**
 * Coverage of the `storefront.ts` READ-port (P3-S11 — catalog + lot-linked SKUs +
 * finished-goods inventory): the pure mappers (snake_case table/view row →
 * camelCase domain, numeric coercion of id/price/unit columns PostgREST may
 * serialize as strings, NULL preservation for an un-set variety/process/notes, an
 * un-linked roast SKU, an un-assigned GTIN/Stripe price) and the `cache()`-wrapped
 * getters' fetch + map round-trip:
 *
 *   - `getProducts()`               reads `products`            (the roasted-SKU master).
 *   - `listProductSkus()`           reads `product_skus`        (every lot-linked SKU).
 *   - `getProductSkusForProduct(p)` reads `product_skus` ⨯ one product.
 *   - `getFinishedGoodsAtp()`       reads `finished_goods_atp`  (the /shop board: on_hand/allocated/available per SKU).
 *   - `getFinishedGoodsAtpForSku()` reads `finished_goods_atp` ⨯ one SKU (null when absent).
 *   - `listFgLedger()`              reads `fg_ledger`           (the append-only movement ledger, newest first).
 *   - `getFgLedgerForSku(sku)`      reads `fg_ledger` ⨯ one SKU.
 *
 * Strategy mirrors `pricing.test.ts` / `roasting` coverage: mock `@/lib/supabase/server`
 * so `getSupabase()` returns a chainable, thenable query-builder. The oversell /
 * lot-backing guards are the migration's job (pinned by the PGlite db test, not
 * re-implemented here); this port only proves the row→domain seam + NULL handling
 * survive `cache()` and hit the right table/view.
 */

// ----- chainable, per-table Supabase query-builder stub ---------------------

interface QueryResult<T> {
  data: T;
  error: { message: string } | null;
}

type TableResults = Record<string, QueryResult<unknown>>;

function makeClient(results: TableResults) {
  const fromCalls: string[] = [];
  const client = {
    from: (table: string) => {
      fromCalls.push(table);
      const result = results[table] ?? { data: [], error: null };
      const builder: Record<string, unknown> = {
        select: vi.fn(() => builder),
        order: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        limit: vi.fn(() => builder),
        then: (
          onFulfilled: (value: QueryResult<unknown>) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) => Promise.resolve(result).then(onFulfilled, onRejected),
      };
      return builder;
    },
  };
  return { client, fromCalls };
}

const getSupabaseMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => getSupabaseMock(),
}));

beforeEach(() => {
  getSupabaseMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

// ----- sample rows ----------------------------------------------------------

const productRow: ProductRow = {
  id: 1,
  slug: "geisha-natural",
  name: "Geisha Natural",
  variety: "Geisha",
  process: "Natural",
  tasting_notes: "jasmine, bergamot",
  is_active: true,
  created_at: "2026-07-06T10:00:00Z",
};

const skuRow: ProductSkuRow = {
  id: 10,
  product_id: 1,
  green_lot_code: "JC-701",
  roast_sku_id: 5,
  pack_format: "whole-bean",
  bag_size: "250g",
  price_usd_cents: "2800", // PostgREST may serialize numeric as a string
  stripe_price_id: "price_abc",
  gtin: "0850000000019",
  is_reserve_club: true,
  is_active: true,
  created_at: "2026-07-06T11:00:00Z",
};

const fgLedgerRow: FgLedgerRow = {
  id: 100,
  sku_id: 10,
  qty_units: 24,
  reason: "roast-in",
  created_at: "2026-07-06T12:00:00Z",
};

const finishedGoodsAtpRow: FinishedGoodsAtpRow = {
  sku_id: 10,
  product_id: 1,
  green_lot_code: "JC-701",
  roast_sku_id: 5,
  pack_format: "whole-bean",
  bag_size: "250g",
  price_usd_cents: "2800",
  is_reserve_club: true,
  is_active: true,
  product_slug: "geisha-natural",
  product_name: "Geisha Natural",
  on_hand_units: "24",
  allocated_units: "2",
  available_units: "22",
};

// ----- pure mapper: mapProduct ----------------------------------------------

describe("mapProduct", () => {
  it("maps a products row to a camelCase Product with numeric id coercion", async () => {
    const { mapProduct } = await import("@/lib/db/storefront");
    expect(mapProduct(productRow)).toEqual({
      id: 1,
      slug: "geisha-natural",
      name: "Geisha Natural",
      variety: "Geisha",
      process: "Natural",
      tastingNotes: "jasmine, bergamot",
      isActive: true,
      createdAt: "2026-07-06T10:00:00Z",
    });
  });

  it("preserves NULL variety/process/tasting_notes (never a fabricated empty string)", async () => {
    const { mapProduct } = await import("@/lib/db/storefront");
    const p = mapProduct({
      ...productRow,
      variety: null,
      process: null,
      tasting_notes: null,
    });
    expect(p.variety).toBeNull();
    expect(p.process).toBeNull();
    expect(p.tastingNotes).toBeNull();
  });
});

// ----- pure mapper: mapProductSku -------------------------------------------

describe("mapProductSku", () => {
  it("maps a product_skus row, coercing id/product_id/price and the keystone lot link", async () => {
    const { mapProductSku } = await import("@/lib/db/storefront");
    expect(mapProductSku(skuRow)).toEqual({
      id: 10,
      productId: 1,
      greenLotCode: "JC-701",
      roastSkuId: 5,
      packFormat: "whole-bean",
      bagSize: "250g",
      priceUsdCents: 2800,
      stripePriceId: "price_abc",
      gtin: "0850000000019",
      isReserveClub: true,
      isActive: true,
      createdAt: "2026-07-06T11:00:00Z",
    });
  });

  it("preserves NULL roast_sku_id/stripe_price_id/gtin (un-linked / un-assigned)", async () => {
    const { mapProductSku } = await import("@/lib/db/storefront");
    const s = mapProductSku({
      ...skuRow,
      roast_sku_id: null,
      stripe_price_id: null,
      gtin: null,
    });
    expect(s.roastSkuId).toBeNull();
    expect(s.stripePriceId).toBeNull();
    expect(s.gtin).toBeNull();
    expect(s.priceUsdCents).toBe(2800);
  });
});

// ----- pure mapper: mapFgLedgerEntry ----------------------------------------

describe("mapFgLedgerEntry", () => {
  it("maps an fg_ledger row, coercing id/sku_id and the signed qty", async () => {
    const { mapFgLedgerEntry } = await import("@/lib/db/storefront");
    expect(mapFgLedgerEntry(fgLedgerRow)).toEqual({
      id: 100,
      skuId: 10,
      qtyUnits: 24,
      reason: "roast-in",
      createdAt: "2026-07-06T12:00:00Z",
    });
  });

  it("carries a negative (reversing) qty verbatim", async () => {
    const { mapFgLedgerEntry } = await import("@/lib/db/storefront");
    const e = mapFgLedgerEntry({ ...fgLedgerRow, qty_units: -2, reason: "sale" });
    expect(e.qtyUnits).toBe(-2);
    expect(e.reason).toBe("sale");
  });
});

// ----- pure mapper: mapFinishedGoodsAtp -------------------------------------

describe("mapFinishedGoodsAtp", () => {
  it("maps a finished_goods_atp row, coercing on_hand/allocated/available units", async () => {
    const { mapFinishedGoodsAtp } = await import("@/lib/db/storefront");
    expect(mapFinishedGoodsAtp(finishedGoodsAtpRow)).toEqual({
      skuId: 10,
      productId: 1,
      greenLotCode: "JC-701",
      roastSkuId: 5,
      packFormat: "whole-bean",
      bagSize: "250g",
      priceUsdCents: 2800,
      isReserveClub: true,
      isActive: true,
      productSlug: "geisha-natural",
      productName: "Geisha Natural",
      onHandUnits: 24,
      allocatedUnits: 2,
      availableUnits: 22,
    });
  });

  it("preserves a NULL roast_sku_id on the ATP projection", async () => {
    const { mapFinishedGoodsAtp } = await import("@/lib/db/storefront");
    const a = mapFinishedGoodsAtp({ ...finishedGoodsAtpRow, roast_sku_id: null });
    expect(a.roastSkuId).toBeNull();
  });
});

// ----- getter: getProducts ---------------------------------------------------

describe("getProducts", () => {
  it("reads the products master and returns camelCase Products", async () => {
    const { client, fromCalls } = makeClient({
      products: { data: [productRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getProducts } = await import("@/lib/db/storefront");
    const products = await getProducts();

    expect(fromCalls).toContain("products");
    expect(products).toHaveLength(1);
    expect(products[0].slug).toBe("geisha-natural");
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      products: { data: null, error: { message: "prod boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getProducts } = await import("@/lib/db/storefront");
    await expect(getProducts()).rejects.toThrow("getProducts: prod boom");
  });
});

// ----- getter: listProductSkus -----------------------------------------------

describe("listProductSkus", () => {
  it("reads product_skus and returns camelCase SKUs", async () => {
    const { client, fromCalls } = makeClient({
      product_skus: { data: [skuRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { listProductSkus } = await import("@/lib/db/storefront");
    const skus = await listProductSkus();

    expect(fromCalls).toContain("product_skus");
    expect(skus[0].greenLotCode).toBe("JC-701");
    expect(skus[0].priceUsdCents).toBe(2800);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      product_skus: { data: null, error: { message: "sku boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { listProductSkus } = await import("@/lib/db/storefront");
    await expect(listProductSkus()).rejects.toThrow("listProductSkus: sku boom");
  });
});

// ----- getter: getProductSkusForProduct --------------------------------------

describe("getProductSkusForProduct", () => {
  it("reads product_skus filtered to one product", async () => {
    const { client, fromCalls } = makeClient({
      product_skus: { data: [skuRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getProductSkusForProduct } = await import("@/lib/db/storefront");
    const skus = await getProductSkusForProduct(1);

    expect(fromCalls).toContain("product_skus");
    expect(skus).toHaveLength(1);
    expect(skus[0].productId).toBe(1);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      product_skus: { data: null, error: { message: "for-product boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getProductSkusForProduct } = await import("@/lib/db/storefront");
    await expect(getProductSkusForProduct(1)).rejects.toThrow(
      "getProductSkusForProduct: for-product boom",
    );
  });
});

// ----- getter: getFinishedGoodsAtp -------------------------------------------

describe("getFinishedGoodsAtp", () => {
  it("reads finished_goods_atp and returns the /shop board rows", async () => {
    const { client, fromCalls } = makeClient({
      finished_goods_atp: { data: [finishedGoodsAtpRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getFinishedGoodsAtp } = await import("@/lib/db/storefront");
    const rows = await getFinishedGoodsAtp();

    expect(fromCalls).toContain("finished_goods_atp");
    expect(rows).toEqual([
      {
        skuId: 10,
        productId: 1,
        greenLotCode: "JC-701",
        roastSkuId: 5,
        packFormat: "whole-bean",
        bagSize: "250g",
        priceUsdCents: 2800,
        isReserveClub: true,
        isActive: true,
        productSlug: "geisha-natural",
        productName: "Geisha Natural",
        onHandUnits: 24,
        allocatedUnits: 2,
        availableUnits: 22,
      },
    ]);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      finished_goods_atp: { data: null, error: { message: "atp boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getFinishedGoodsAtp } = await import("@/lib/db/storefront");
    await expect(getFinishedGoodsAtp()).rejects.toThrow(
      "getFinishedGoodsAtp: atp boom",
    );
  });
});

// ----- getter: getFinishedGoodsAtpForSku -------------------------------------

describe("getFinishedGoodsAtpForSku", () => {
  it("reads finished_goods_atp for one SKU and returns the single row", async () => {
    const { client, fromCalls } = makeClient({
      finished_goods_atp: { data: [finishedGoodsAtpRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getFinishedGoodsAtpForSku } = await import("@/lib/db/storefront");
    const row = await getFinishedGoodsAtpForSku(10);

    expect(fromCalls).toContain("finished_goods_atp");
    expect(row).not.toBeNull();
    expect(row?.availableUnits).toBe(22);
  });

  it("returns null when the SKU has no finished-goods row", async () => {
    const { client } = makeClient({
      finished_goods_atp: { data: [], error: null },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getFinishedGoodsAtpForSku } = await import("@/lib/db/storefront");
    expect(await getFinishedGoodsAtpForSku(999)).toBeNull();
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      finished_goods_atp: { data: null, error: { message: "one-atp boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getFinishedGoodsAtpForSku } = await import("@/lib/db/storefront");
    await expect(getFinishedGoodsAtpForSku(10)).rejects.toThrow(
      "getFinishedGoodsAtpForSku: one-atp boom",
    );
  });
});

// ----- getter: listFgLedger --------------------------------------------------

describe("listFgLedger", () => {
  it("reads the fg_ledger and returns camelCase movements", async () => {
    const { client, fromCalls } = makeClient({
      fg_ledger: { data: [fgLedgerRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { listFgLedger } = await import("@/lib/db/storefront");
    const rows = await listFgLedger();

    expect(fromCalls).toContain("fg_ledger");
    expect(rows[0].qtyUnits).toBe(24);
    expect(rows[0].reason).toBe("roast-in");
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      fg_ledger: { data: null, error: { message: "ledger boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { listFgLedger } = await import("@/lib/db/storefront");
    await expect(listFgLedger()).rejects.toThrow("listFgLedger: ledger boom");
  });
});

// ----- getter: getFgLedgerForSku ---------------------------------------------

describe("getFgLedgerForSku", () => {
  it("reads fg_ledger filtered to one SKU", async () => {
    const { client, fromCalls } = makeClient({
      fg_ledger: { data: [fgLedgerRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getFgLedgerForSku } = await import("@/lib/db/storefront");
    const rows = await getFgLedgerForSku(10);

    expect(fromCalls).toContain("fg_ledger");
    expect(rows).toHaveLength(1);
    expect(rows[0].skuId).toBe(10);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      fg_ledger: { data: null, error: { message: "sku-ledger boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getFgLedgerForSku } = await import("@/lib/db/storefront");
    await expect(getFgLedgerForSku(10)).rejects.toThrow(
      "getFgLedgerForSku: sku-ledger boom",
    );
  });
});
