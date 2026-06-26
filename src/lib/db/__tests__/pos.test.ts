import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PosSaleBookRow, PosTerminalRow } from "@/lib/db/pos";

/**
 * Coverage of the `pos.ts` READ-port (P3-S14 — the offline DGI farm-store/café POS):
 * the pure mappers (snake_case view/table row → camelCase domain, numeric coercion of
 * the cents/id/seq columns PostgREST may serialize as strings, NULL preservation for an
 * un-stamped `dgi_cufe` / a walk-in's missing name) and the `cache()`-wrapped getters'
 * fetch + map round-trip:
 *
 *   - `getPosSalesBook()`  reads `v_pos_sales_book`  (the day's POS folios + their orders).
 *   - `getPosSale(saleNo)` reads `v_pos_sales_book` filtered to one folio (null when absent).
 *   - `getPosTerminals()`  reads `pos_terminals`     (the registered tills for the picker).
 *
 * Strategy mirrors `pricing.test.ts`: mock `@/lib/supabase/server` so `getSupabase()`
 * returns a chainable, thenable query-builder. The totals/tax/oversell math is the
 * delegated `create_order` + S11 guard's job (pinned by the migration's PGlite tests,
 * not re-implemented here); this port only proves the row→domain seam + NULL handling
 * survive `cache()` and hit the right view/table.
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

const saleRow: PosSaleBookRow = {
  id: "3", // PostgREST may serialize bigint as a string
  sale_no: "POS-0003",
  device_id: "till-cafe-01",
  device_seq: "7",
  dgi_cufe: null, // NULL ⇒ pending fiscal stamp (non-fiscal recibo, the $0 path)
  created_at: "2026-06-24T15:00:00Z",
  terminal_code: "CAFE",
  terminal_name: "Lagunas Café",
  order_id: "42",
  status: "paid",
  currency: "USD",
  subtotal_cents: "1400",
  dgi_tax_cents: "98",
  total_cents: "1498",
  customer_email: "walkin@pos.local",
  customer_name: "Walk-in",
  line_count: "2",
};

const terminalRow: PosTerminalRow = {
  id: "1",
  code: "FARM-STORE",
  name: "Janson Farm Store",
  location: "Volcán",
  is_active: true,
  created_at: "2026-06-20T08:00:00Z",
};

// ----- pure mapper: mapPosSaleBookEntry -------------------------------------

describe("mapPosSaleBookEntry", () => {
  it("maps a v_pos_sales_book row to a camelCase entry with numeric coercion", async () => {
    const { mapPosSaleBookEntry } = await import("@/lib/db/pos");
    expect(mapPosSaleBookEntry(saleRow)).toEqual({
      id: 3,
      saleNo: "POS-0003",
      deviceId: "till-cafe-01",
      deviceSeq: 7,
      dgiCufe: null,
      createdAt: "2026-06-24T15:00:00Z",
      terminalCode: "CAFE",
      terminalName: "Lagunas Café",
      orderId: 42,
      status: "paid",
      currency: "USD",
      subtotalCents: 1400,
      dgiTaxCents: 98,
      totalCents: 1498,
      customerEmail: "walkin@pos.local",
      customerName: "Walk-in",
      lineCount: 2,
    });
  });

  it("preserves a NULL dgi_cufe (pending stamp, never fabricated) and a null walk-in name", async () => {
    const { mapPosSaleBookEntry } = await import("@/lib/db/pos");
    const e = mapPosSaleBookEntry({
      ...saleRow,
      dgi_cufe: null,
      customer_name: null,
    });
    expect(e.dgiCufe).toBeNull();
    expect(e.customerName).toBeNull();
  });

  it("surfaces a stamped dgi_cufe folio verbatim once the PAC seam fills it", async () => {
    const { mapPosSaleBookEntry } = await import("@/lib/db/pos");
    const e = mapPosSaleBookEntry({
      ...saleRow,
      dgi_cufe: "FE0120260624-CUFE-XYZ",
    });
    expect(e.dgiCufe).toBe("FE0120260624-CUFE-XYZ");
  });
});

// ----- pure mapper: mapPosTerminal ------------------------------------------

describe("mapPosTerminal", () => {
  it("maps a pos_terminals row to a camelCase terminal", async () => {
    const { mapPosTerminal } = await import("@/lib/db/pos");
    expect(mapPosTerminal(terminalRow)).toEqual({
      id: 1,
      code: "FARM-STORE",
      name: "Janson Farm Store",
      location: "Volcán",
      isActive: true,
      createdAt: "2026-06-20T08:00:00Z",
    });
  });

  it("passes a null location through unchanged", async () => {
    const { mapPosTerminal } = await import("@/lib/db/pos");
    const t = mapPosTerminal({ ...terminalRow, location: null });
    expect(t.location).toBeNull();
  });
});

// ----- getter: getPosSalesBook ----------------------------------------------

describe("getPosSalesBook", () => {
  it("reads v_pos_sales_book and returns camelCase entries", async () => {
    const { client, fromCalls } = makeClient({
      v_pos_sales_book: { data: [saleRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getPosSalesBook } = await import("@/lib/db/pos");
    const book = await getPosSalesBook();

    expect(fromCalls).toContain("v_pos_sales_book");
    expect(book).toHaveLength(1);
    expect(book[0].saleNo).toBe("POS-0003");
    expect(book[0].totalCents).toBe(1498);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      v_pos_sales_book: { data: null, error: { message: "book boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getPosSalesBook } = await import("@/lib/db/pos");
    await expect(getPosSalesBook()).rejects.toThrow(
      "getPosSalesBook: book boom",
    );
  });
});

// ----- getter: getPosSale ----------------------------------------------------

describe("getPosSale", () => {
  it("reads v_pos_sales_book for one folio and returns the single entry", async () => {
    const { client, fromCalls } = makeClient({
      v_pos_sales_book: { data: [saleRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getPosSale } = await import("@/lib/db/pos");
    const entry = await getPosSale("POS-0003");

    expect(fromCalls).toContain("v_pos_sales_book");
    expect(entry).not.toBeNull();
    expect(entry?.saleNo).toBe("POS-0003");
  });

  it("returns null when the folio has no row", async () => {
    const { client } = makeClient({
      v_pos_sales_book: { data: [], error: null },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getPosSale } = await import("@/lib/db/pos");
    expect(await getPosSale("POS-9999")).toBeNull();
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      v_pos_sales_book: { data: null, error: { message: "sale boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getPosSale } = await import("@/lib/db/pos");
    await expect(getPosSale("POS-0003")).rejects.toThrow(
      "getPosSale: sale boom",
    );
  });
});

// ----- getter: getPosTerminals ----------------------------------------------

describe("getPosTerminals", () => {
  it("reads pos_terminals and returns camelCase terminals", async () => {
    const { client, fromCalls } = makeClient({
      pos_terminals: { data: [terminalRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getPosTerminals } = await import("@/lib/db/pos");
    const terminals = await getPosTerminals();

    expect(fromCalls).toContain("pos_terminals");
    expect(terminals[0].code).toBe("FARM-STORE");
    expect(terminals[0].isActive).toBe(true);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      pos_terminals: { data: null, error: { message: "till boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getPosTerminals } = await import("@/lib/db/pos");
    await expect(getPosTerminals()).rejects.toThrow(
      "getPosTerminals: till boom",
    );
  });
});
