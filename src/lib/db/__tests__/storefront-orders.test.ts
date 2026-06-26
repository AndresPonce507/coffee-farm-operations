import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  OrderBookRow,
  OrderCogsRow,
  OrderLineRow,
  SubAllocationRow,
  SubEventRow,
  SubscriptionBoardRow,
} from "@/lib/db/storefront-orders";

/**
 * Coverage of the `storefront-orders.ts` READ-port (P3-S12 — DTC orders + Stripe
 * Checkout + Reserve-Club subscriptions): the pure mappers (snake_case view/table
 * row → camelCase domain, numeric coercion of cents/kg columns PostgREST may
 * serialize as strings, NULL preservation for an unknown COGS / un-stamped fiscal
 * folio / absent Stripe id) and the `cache()`-wrapped getters' fetch + map round-trip:
 *
 *   - `getOrderBook()`            reads `v_order_book`         (the admin order book, newest first).
 *   - `getOrderLines(orderId)`    reads `order_lines`         (one order's captured lines + green_lot_code).
 *   - `getOrderCogs(orderId)`     reads `v_order_cogs`        (per-line COGS via mv_lot_cost; NULL when unknown).
 *   - `getSubscriptionBoard()`    reads `v_subscription_board` (Reserve-Club board: allocated kg + dunning count).
 *   - `getSubscriptionEvents(id)` reads `sub_events`          (the append-only lifecycle ledger, newest first).
 *   - `getSubAllocations(id)`     reads `sub_allocations`     (the append-only green-lot claim links).
 *
 * Strategy mirrors `pricing.test.ts`: mock `@/lib/supabase/server` so `getSupabase()`
 * returns a chainable, thenable query-builder. The server-side total math + the
 * oversell guard are the RPCs'/triggers' job (pinned by the migration's PGlite tests,
 * not re-implemented here); this port only proves the row→domain seam + NULL handling
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

const orderBookRow: OrderBookRow = {
  id: 7,
  channel: "web",
  status: "paid",
  currency: "USD",
  subtotal_cents: "4200", // PostgREST may serialize integer as a string
  dgi_tax_cents: "294",
  total_cents: "4494",
  stripe_payment_intent: "pi_123",
  dgi_cufe: null, // not yet fiscally stamped ⇒ preserved null
  idempotency_key: "tnt:order-1",
  created_at: "2026-06-24T10:00:00Z",
  customer_email: "ana@example.com",
  customer_name: "Ana",
  line_count: "2",
};

const orderLineRow: OrderLineRow = {
  id: 11,
  order_id: 7,
  sku_id: 3,
  green_lot_code: "JC-701",
  qty_units: "2",
  unit_price_cents: "2100",
  line_total_cents: "4200",
  created_at: "2026-06-24T10:00:00Z",
};

const orderCogsRow: OrderCogsRow = {
  order_id: 7,
  sku_id: 3,
  green_lot_code: "JC-701",
  qty_units: "2",
  line_total_cents: "4200",
  cost_per_kg_green: "12.5",
};

const subscriptionBoardRow: SubscriptionBoardRow = {
  id: 5,
  cadence: "monthly",
  status: "active",
  stripe_subscription_id: "sub_abc",
  started_at: "2026-06-01T00:00:00Z",
  customer_email: "luis@example.com",
  customer_name: "Luis",
  allocated_kg: "3.5",
  dunning_count: "1",
};

const subEventRow: SubEventRow = {
  id: 21,
  subscription_id: 5,
  kind: "allocated",
  payload: { green_lot_code: "JC-701", kg: 1.5 },
  occurred_at: "2026-06-10T00:00:00Z",
  created_at: "2026-06-10T00:00:01Z",
};

const subAllocationRow: SubAllocationRow = {
  id: 31,
  subscription_id: 5,
  green_lot_code: "JC-701",
  kg: "1.5",
  reservation_id: 9,
  cycle_label: "2026-06",
  created_at: "2026-06-10T00:00:00Z",
};

// ----- pure mapper: mapOrderBookEntry ---------------------------------------

describe("mapOrderBookEntry", () => {
  it("maps a v_order_book row to a camelCase entry with numeric cents coercion", async () => {
    const { mapOrderBookEntry } = await import("@/lib/db/storefront-orders");
    expect(mapOrderBookEntry(orderBookRow)).toEqual({
      id: 7,
      channel: "web",
      status: "paid",
      currency: "USD",
      subtotalCents: 4200,
      dgiTaxCents: 294,
      totalCents: 4494,
      stripePaymentIntent: "pi_123",
      dgiCufe: null,
      idempotencyKey: "tnt:order-1",
      createdAt: "2026-06-24T10:00:00Z",
      customerEmail: "ana@example.com",
      customerName: "Ana",
      lineCount: 2,
    });
  });

  it("preserves a NULL dgi_cufe / stripe id / customer name (never fabricated)", async () => {
    const { mapOrderBookEntry } = await import("@/lib/db/storefront-orders");
    const e = mapOrderBookEntry({
      ...orderBookRow,
      stripe_payment_intent: null,
      dgi_cufe: null,
      customer_name: null,
      idempotency_key: null,
    });
    expect(e.stripePaymentIntent).toBeNull();
    expect(e.dgiCufe).toBeNull();
    expect(e.customerName).toBeNull();
    expect(e.idempotencyKey).toBeNull();
  });
});

// ----- pure mapper: mapOrderLine --------------------------------------------

describe("mapOrderLine", () => {
  it("maps an order_lines row, coercing qty/price/total to numbers", async () => {
    const { mapOrderLine } = await import("@/lib/db/storefront-orders");
    expect(mapOrderLine(orderLineRow)).toEqual({
      id: 11,
      orderId: 7,
      skuId: 3,
      greenLotCode: "JC-701",
      qtyUnits: 2,
      unitPriceCents: 2100,
      lineTotalCents: 4200,
      createdAt: "2026-06-24T10:00:00Z",
    });
  });
});

// ----- pure mapper: mapOrderCogsLine ----------------------------------------

describe("mapOrderCogsLine", () => {
  it("maps a v_order_cogs row with numeric coercion of cost", async () => {
    const { mapOrderCogsLine } = await import("@/lib/db/storefront-orders");
    expect(mapOrderCogsLine(orderCogsRow)).toEqual({
      orderId: 7,
      skuId: 3,
      greenLotCode: "JC-701",
      qtyUnits: 2,
      lineTotalCents: 4200,
      costPerKgGreen: 12.5,
    });
  });

  it("preserves a NULL cost_per_kg_green (COGS unknown ⇒ flagged, never 0)", async () => {
    const { mapOrderCogsLine } = await import("@/lib/db/storefront-orders");
    const c = mapOrderCogsLine({ ...orderCogsRow, cost_per_kg_green: null });
    expect(c.costPerKgGreen).toBeNull();
  });
});

// ----- pure mapper: mapSubscriptionBoardEntry -------------------------------

describe("mapSubscriptionBoardEntry", () => {
  it("maps a v_subscription_board row with numeric kg/count coercion", async () => {
    const { mapSubscriptionBoardEntry } = await import(
      "@/lib/db/storefront-orders"
    );
    expect(mapSubscriptionBoardEntry(subscriptionBoardRow)).toEqual({
      id: 5,
      cadence: "monthly",
      status: "active",
      stripeSubscriptionId: "sub_abc",
      startedAt: "2026-06-01T00:00:00Z",
      customerEmail: "luis@example.com",
      customerName: "Luis",
      allocatedKg: 3.5,
      dunningCount: 1,
    });
  });

  it("preserves a NULL stripe subscription id / customer name", async () => {
    const { mapSubscriptionBoardEntry } = await import(
      "@/lib/db/storefront-orders"
    );
    const e = mapSubscriptionBoardEntry({
      ...subscriptionBoardRow,
      stripe_subscription_id: null,
      customer_name: null,
    });
    expect(e.stripeSubscriptionId).toBeNull();
    expect(e.customerName).toBeNull();
  });
});

// ----- pure mapper: mapSubEvent ---------------------------------------------

describe("mapSubEvent", () => {
  it("maps a sub_events row, passing the jsonb payload through unchanged", async () => {
    const { mapSubEvent } = await import("@/lib/db/storefront-orders");
    expect(mapSubEvent(subEventRow)).toEqual({
      id: 21,
      subscriptionId: 5,
      kind: "allocated",
      payload: { green_lot_code: "JC-701", kg: 1.5 },
      occurredAt: "2026-06-10T00:00:00Z",
      createdAt: "2026-06-10T00:00:01Z",
    });
  });

  it("defaults a null/absent payload to an empty object", async () => {
    const { mapSubEvent } = await import("@/lib/db/storefront-orders");
    const e = mapSubEvent({ ...subEventRow, payload: null });
    expect(e.payload).toEqual({});
  });
});

// ----- pure mapper: mapSubAllocation ----------------------------------------

describe("mapSubAllocation", () => {
  it("maps a sub_allocations row, coercing kg and reservation id", async () => {
    const { mapSubAllocation } = await import("@/lib/db/storefront-orders");
    expect(mapSubAllocation(subAllocationRow)).toEqual({
      id: 31,
      subscriptionId: 5,
      greenLotCode: "JC-701",
      kg: 1.5,
      reservationId: 9,
      cycleLabel: "2026-06",
      createdAt: "2026-06-10T00:00:00Z",
    });
  });
});

// ----- getter: getOrderBook --------------------------------------------------

describe("getOrderBook", () => {
  it("reads v_order_book and returns camelCase entries", async () => {
    const { client, fromCalls } = makeClient({
      v_order_book: { data: [orderBookRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getOrderBook } = await import("@/lib/db/storefront-orders");
    const book = await getOrderBook();

    expect(fromCalls).toContain("v_order_book");
    expect(book).toHaveLength(1);
    expect(book[0].id).toBe(7);
    expect(book[0].totalCents).toBe(4494);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      v_order_book: { data: null, error: { message: "book boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getOrderBook } = await import("@/lib/db/storefront-orders");
    await expect(getOrderBook()).rejects.toThrow("getOrderBook: book boom");
  });
});

// ----- getter: getOrderLines -------------------------------------------------

describe("getOrderLines", () => {
  it("reads order_lines for one order and returns camelCase lines", async () => {
    const { client, fromCalls } = makeClient({
      order_lines: { data: [orderLineRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getOrderLines } = await import("@/lib/db/storefront-orders");
    const lines = await getOrderLines(7);

    expect(fromCalls).toContain("order_lines");
    expect(lines[0].orderId).toBe(7);
    expect(lines[0].greenLotCode).toBe("JC-701");
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      order_lines: { data: null, error: { message: "lines boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getOrderLines } = await import("@/lib/db/storefront-orders");
    await expect(getOrderLines(7)).rejects.toThrow("getOrderLines: lines boom");
  });
});

// ----- getter: getOrderCogs --------------------------------------------------

describe("getOrderCogs", () => {
  it("reads v_order_cogs for one order and preserves NULL cost", async () => {
    const { client, fromCalls } = makeClient({
      v_order_cogs: {
        data: [orderCogsRow, { ...orderCogsRow, cost_per_kg_green: null }],
        error: null,
      },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getOrderCogs } = await import("@/lib/db/storefront-orders");
    const cogs = await getOrderCogs(7);

    expect(fromCalls).toContain("v_order_cogs");
    expect(cogs[0].costPerKgGreen).toBe(12.5);
    expect(cogs[1].costPerKgGreen).toBeNull();
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      v_order_cogs: { data: null, error: { message: "cogs boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getOrderCogs } = await import("@/lib/db/storefront-orders");
    await expect(getOrderCogs(7)).rejects.toThrow("getOrderCogs: cogs boom");
  });
});

// ----- getter: getSubscriptionBoard ------------------------------------------

describe("getSubscriptionBoard", () => {
  it("reads v_subscription_board and returns camelCase entries", async () => {
    const { client, fromCalls } = makeClient({
      v_subscription_board: { data: [subscriptionBoardRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getSubscriptionBoard } = await import("@/lib/db/storefront-orders");
    const board = await getSubscriptionBoard();

    expect(fromCalls).toContain("v_subscription_board");
    expect(board[0].allocatedKg).toBe(3.5);
    expect(board[0].dunningCount).toBe(1);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      v_subscription_board: { data: null, error: { message: "board boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getSubscriptionBoard } = await import("@/lib/db/storefront-orders");
    await expect(getSubscriptionBoard()).rejects.toThrow(
      "getSubscriptionBoard: board boom",
    );
  });
});

// ----- getter: getSubscriptionEvents -----------------------------------------

describe("getSubscriptionEvents", () => {
  it("reads sub_events for one subscription and returns camelCase events", async () => {
    const { client, fromCalls } = makeClient({
      sub_events: { data: [subEventRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getSubscriptionEvents } = await import(
      "@/lib/db/storefront-orders"
    );
    const events = await getSubscriptionEvents(5);

    expect(fromCalls).toContain("sub_events");
    expect(events[0].kind).toBe("allocated");
    expect(events[0].subscriptionId).toBe(5);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      sub_events: { data: null, error: { message: "events boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getSubscriptionEvents } = await import(
      "@/lib/db/storefront-orders"
    );
    await expect(getSubscriptionEvents(5)).rejects.toThrow(
      "getSubscriptionEvents: events boom",
    );
  });
});

// ----- getter: getSubAllocations ---------------------------------------------

describe("getSubAllocations", () => {
  it("reads sub_allocations for one subscription and returns camelCase claims", async () => {
    const { client, fromCalls } = makeClient({
      sub_allocations: { data: [subAllocationRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getSubAllocations } = await import("@/lib/db/storefront-orders");
    const allocs = await getSubAllocations(5);

    expect(fromCalls).toContain("sub_allocations");
    expect(allocs[0].kg).toBe(1.5);
    expect(allocs[0].reservationId).toBe(9);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      sub_allocations: { data: null, error: { message: "alloc boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getSubAllocations } = await import("@/lib/db/storefront-orders");
    await expect(getSubAllocations(5)).rejects.toThrow(
      "getSubAllocations: alloc boom",
    );
  });
});
