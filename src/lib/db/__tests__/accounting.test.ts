import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ArAgingRow,
  ArDocLineRow,
  ArDocRow,
  ArPaymentRow,
  FxAttributionRow,
  FxGainLossRow,
  FxRateRow,
  LotMarginRow,
  RevenueEntryRow,
} from "@/lib/db/accounting";

/**
 * Coverage of the `accounting.ts` READ-port (P3-S16 — the accounting spine, the
 * books' financial sink): the pure mappers (snake_case table/view row → camelCase
 * domain, numeric coercion of money/rate/kg columns PostgREST may serialize as
 * strings, NULL preservation for an un-costed lot's margin / an un-FK'd green lot /
 * an optional incoterm) and the `cache()`-wrapped getters' fetch + map round-trip:
 *
 *   - `getFxRates()`            reads `fx_rate`            (the canonical daily-rate SSOT, newest first).
 *   - `getRevenueEntries()`    reads `revenue_entry`      (the journal source, newest first).
 *   - `getLotMargin()`         reads `v_lot_margin`       (THE realized $/kg-green margin per lot).
 *   - `getArAging()`           reads `v_ar_aging`         (per-doc balance + aging bucket).
 *   - `getArDocs()`            reads `ar_doc`             (the AR instruments, newest first).
 *   - `getArDocByNumber(n)`    reads `ar_doc` for one doc number (null when absent).
 *   - `getArDocLines(id)`      reads `ar_doc_line`        (the line items for one doc).
 *   - `getArPaymentsForDoc(id)`reads `ar_payment`        (the cash timeline for one doc).
 *   - `getFxGainLossEntries()` reads `fx_gain_loss_entry` (the realized-FX P&L line).
 *   - `getFxAttribution(a,b)`  calls `fx_attribution(p_from,p_to)` (realized FX over a window).
 *
 * Strategy mirrors `pricing.test.ts`: mock `@/lib/supabase/server` so `getSupabase()`
 * returns a chainable, thenable query-builder (plus an `.rpc()` for fx_attribution).
 * The books' math itself is the views'/RPC's job (pinned by the migration's PGlite
 * tests, not re-implemented here); this port only proves the row→domain seam + NULL
 * handling survive `cache()` and hit the right table/view/RPC.
 */

// ----- chainable, per-table Supabase query-builder + rpc stub ----------------

interface QueryResult<T> {
  data: T;
  error: { message: string } | null;
}

type TableResults = Record<string, QueryResult<unknown>>;
type RpcResults = Record<string, QueryResult<unknown>>;

function makeClient(results: TableResults, rpcResults: RpcResults = {}) {
  const fromCalls: string[] = [];
  const rpcCalls: Array<{ fn: string; args: unknown }> = [];
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
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      const result = rpcResults[fn] ?? { data: [], error: null };
      return Promise.resolve(result);
    },
  };
  return { client, fromCalls, rpcCalls };
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

const fxRateRow: FxRateRow = {
  id: 1,
  as_of_date: "2026-06-20",
  base: "EUR",
  quote: "USD",
  rate: "1.08", // PostgREST may serialize numeric as a string
  source: "ecb",
  created_at: "2026-06-20T10:00:00Z",
};

const revenueEntryRow: RevenueEntryRow = {
  id: 5,
  source_kind: "green_sale",
  green_lot_code: "JC-701",
  amount_doc: "10800",
  currency: "EUR",
  amount_usd: "11664",
  fx_rate_used: "1.08",
  reverses_id: null,
  memo: "30 kg washed Geisha",
  occurred_at: "2026-06-20T10:00:00Z",
  created_at: "2026-06-20T10:00:01Z",
};

const reversalRevenueRow: RevenueEntryRow = {
  id: 6,
  source_kind: "green_sale",
  green_lot_code: null, // un-FK'd, may be absent
  amount_doc: "-11664",
  currency: "USD",
  amount_usd: "-11664",
  fx_rate_used: "1",
  reverses_id: 5,
  memo: null,
  occurred_at: "2026-06-21T10:00:00Z",
  created_at: "2026-06-21T10:00:01Z",
};

const lotMarginRow: LotMarginRow = {
  green_lot_code: "JC-701",
  revenue_usd: "11664",
  green_kg: "30",
  total_cost: "375",
  cost_per_kg_green: "12.5",
  revenue_per_kg_green: "388.8",
  margin_per_kg_green: "376.3",
  margin_usd: "11289",
};

const uncostedMarginRow: LotMarginRow = {
  green_lot_code: "JC-820",
  revenue_usd: "5000",
  green_kg: null, // no green inventory matched
  total_cost: null, // COGS unknown ⇒ margin unknown (preserved, never 0)
  cost_per_kg_green: null,
  revenue_per_kg_green: null,
  margin_per_kg_green: null,
  margin_usd: null,
};

const arAgingRow: ArAgingRow = {
  ar_doc_id: 9,
  kind: "commercial_invoice",
  doc_number: "CI-2026-0001",
  status: "partially_paid",
  total_usd: "11664",
  paid_usd: "5000",
  balance_usd: "6664",
  issued_at: "2026-05-01T10:00:00Z",
  days_outstanding: 50,
  aging_bucket: "31-60",
};

const arDocRow: ArDocRow = {
  id: 9,
  kind: "commercial_invoice",
  doc_number: "CI-2026-0001",
  status: "partially_paid",
  incoterm: "FOB",
  buyer_ref: "buyer-acme",
  contract_ref: "contract-77",
  total_doc: "10800",
  currency: "EUR",
  total_usd: "11664",
  fx_rate_at_issue: "1.08",
  issued_at: "2026-05-01T10:00:00Z",
  created_at: "2026-05-01T10:00:01Z",
};

const arDocLineRow: ArDocLineRow = {
  id: 21,
  ar_doc_id: 9,
  green_lot_code: "JC-701",
  description: "Washed Geisha, 30 kg",
  kg: "30",
  unit_price_doc: "360",
  amount_doc: "10800",
  created_at: "2026-05-01T10:00:01Z",
};

const arPaymentRow: ArPaymentRow = {
  id: 31,
  ar_doc_id: 9,
  method: "wire",
  amount_doc: "4630",
  currency: "EUR",
  amount_usd_at_receipt: "5000",
  fx_rate_at_receipt: "1.08",
  received_at: "2026-06-15T10:00:00Z",
  created_at: "2026-06-15T10:00:01Z",
};

const fxGainLossRow: FxGainLossRow = {
  id: 41,
  ar_doc_id: 9,
  amount_doc: "4630",
  fx_rate_at_issue: "1.08",
  fx_rate_at_receipt: "1.10",
  gain_usd: "92.6",
  occurred_at: "2026-06-15T10:00:00Z",
  created_at: "2026-06-15T10:00:01Z",
};

const fxAttributionRow: FxAttributionRow = {
  period_from: "2026-06-01",
  period_to: "2026-06-30",
  realized_fx_gain_usd: "92.6",
  entries: 1,
};

// ----- pure mappers ----------------------------------------------------------

describe("mapFxRate", () => {
  it("maps an fx_rate row, coercing the rate string to a number", async () => {
    const { mapFxRate } = await import("@/lib/db/accounting");
    expect(mapFxRate(fxRateRow)).toEqual({
      id: 1,
      asOfDate: "2026-06-20",
      base: "EUR",
      quote: "USD",
      rate: 1.08,
      source: "ecb",
      createdAt: "2026-06-20T10:00:00Z",
    });
  });
});

describe("mapRevenueEntry", () => {
  it("maps a revenue_entry row with numeric coercion of doc/usd/rate", async () => {
    const { mapRevenueEntry } = await import("@/lib/db/accounting");
    expect(mapRevenueEntry(revenueEntryRow)).toEqual({
      id: 5,
      sourceKind: "green_sale",
      greenLotCode: "JC-701",
      amountDoc: 10800,
      currency: "EUR",
      amountUsd: 11664,
      fxRateUsed: 1.08,
      reversesId: null,
      memo: "30 kg washed Geisha",
      occurredAt: "2026-06-20T10:00:00Z",
      createdAt: "2026-06-20T10:00:01Z",
    });
  });

  it("preserves a null green lot / memo and keeps a reversal's negative amount + reverses_id", async () => {
    const { mapRevenueEntry } = await import("@/lib/db/accounting");
    const e = mapRevenueEntry(reversalRevenueRow);
    expect(e.greenLotCode).toBeNull();
    expect(e.memo).toBeNull();
    expect(e.reversesId).toBe(5);
    expect(e.amountDoc).toBe(-11664);
    expect(e.amountUsd).toBe(-11664);
  });
});

describe("mapLotMargin", () => {
  it("maps a v_lot_margin row with numeric coercion (THE realized margin number)", async () => {
    const { mapLotMargin } = await import("@/lib/db/accounting");
    expect(mapLotMargin(lotMarginRow)).toEqual({
      greenLotCode: "JC-701",
      revenueUsd: 11664,
      greenKg: 30,
      totalCost: 375,
      costPerKgGreen: 12.5,
      revenuePerKgGreen: 388.8,
      marginPerKgGreen: 376.3,
      marginUsd: 11289,
    });
  });

  it("preserves NULL margin when the lot has no booked COGS (never fabricated)", async () => {
    const { mapLotMargin } = await import("@/lib/db/accounting");
    const m = mapLotMargin(uncostedMarginRow);
    expect(m.revenueUsd).toBe(5000);
    expect(m.greenKg).toBeNull();
    expect(m.totalCost).toBeNull();
    expect(m.costPerKgGreen).toBeNull();
    expect(m.revenuePerKgGreen).toBeNull();
    expect(m.marginPerKgGreen).toBeNull();
    expect(m.marginUsd).toBeNull();
  });
});

describe("mapArAging", () => {
  it("maps a v_ar_aging row with numeric coercion of totals/balance/days", async () => {
    const { mapArAging } = await import("@/lib/db/accounting");
    expect(mapArAging(arAgingRow)).toEqual({
      arDocId: 9,
      kind: "commercial_invoice",
      docNumber: "CI-2026-0001",
      status: "partially_paid",
      totalUsd: 11664,
      paidUsd: 5000,
      balanceUsd: 6664,
      issuedAt: "2026-05-01T10:00:00Z",
      daysOutstanding: 50,
      agingBucket: "31-60",
    });
  });
});

describe("mapArDoc", () => {
  it("maps an ar_doc row with numeric coercion + soft-ref/incoterm passthrough", async () => {
    const { mapArDoc } = await import("@/lib/db/accounting");
    expect(mapArDoc(arDocRow)).toEqual({
      id: 9,
      kind: "commercial_invoice",
      docNumber: "CI-2026-0001",
      status: "partially_paid",
      incoterm: "FOB",
      buyerRef: "buyer-acme",
      contractRef: "contract-77",
      totalDoc: 10800,
      currency: "EUR",
      totalUsd: 11664,
      fxRateAtIssue: 1.08,
      issuedAt: "2026-05-01T10:00:00Z",
      createdAt: "2026-05-01T10:00:01Z",
    });
  });

  it("passes a null incoterm / buyer / contract soft-ref through unchanged", async () => {
    const { mapArDoc } = await import("@/lib/db/accounting");
    const d = mapArDoc({
      ...arDocRow,
      incoterm: null,
      buyer_ref: null,
      contract_ref: null,
    });
    expect(d.incoterm).toBeNull();
    expect(d.buyerRef).toBeNull();
    expect(d.contractRef).toBeNull();
  });
});

describe("mapArDocLine", () => {
  it("maps an ar_doc_line row with numeric coercion; null kg preserved", async () => {
    const { mapArDocLine } = await import("@/lib/db/accounting");
    expect(mapArDocLine(arDocLineRow)).toEqual({
      id: 21,
      arDocId: 9,
      greenLotCode: "JC-701",
      description: "Washed Geisha, 30 kg",
      kg: 30,
      unitPriceDoc: 360,
      amountDoc: 10800,
      createdAt: "2026-05-01T10:00:01Z",
    });
    const { mapArDocLine: m2 } = await import("@/lib/db/accounting");
    expect(m2({ ...arDocLineRow, kg: null, green_lot_code: null }).kg).toBeNull();
  });
});

describe("mapArPayment", () => {
  it("maps an ar_payment row with numeric coercion of doc/usd/rate", async () => {
    const { mapArPayment } = await import("@/lib/db/accounting");
    expect(mapArPayment(arPaymentRow)).toEqual({
      id: 31,
      arDocId: 9,
      method: "wire",
      amountDoc: 4630,
      currency: "EUR",
      amountUsdAtReceipt: 5000,
      fxRateAtReceipt: 1.08,
      receivedAt: "2026-06-15T10:00:00Z",
      createdAt: "2026-06-15T10:00:01Z",
    });
  });
});

describe("mapFxGainLoss", () => {
  it("maps an fx_gain_loss_entry row with numeric coercion of the two rates + gain", async () => {
    const { mapFxGainLoss } = await import("@/lib/db/accounting");
    expect(mapFxGainLoss(fxGainLossRow)).toEqual({
      id: 41,
      arDocId: 9,
      amountDoc: 4630,
      fxRateAtIssue: 1.08,
      fxRateAtReceipt: 1.1,
      gainUsd: 92.6,
      occurredAt: "2026-06-15T10:00:00Z",
      createdAt: "2026-06-15T10:00:01Z",
    });
  });
});

describe("mapFxAttribution", () => {
  it("maps an fx_attribution row with numeric coercion of gain + entries", async () => {
    const { mapFxAttribution } = await import("@/lib/db/accounting");
    expect(mapFxAttribution(fxAttributionRow)).toEqual({
      periodFrom: "2026-06-01",
      periodTo: "2026-06-30",
      realizedFxGainUsd: 92.6,
      entries: 1,
    });
  });
});

// ----- getter: getFxRates ----------------------------------------------------

describe("getFxRates", () => {
  it("reads fx_rate and returns camelCase rows", async () => {
    const { client, fromCalls } = makeClient({
      fx_rate: { data: [fxRateRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getFxRates } = await import("@/lib/db/accounting");
    const rows = await getFxRates();

    expect(fromCalls).toContain("fx_rate");
    expect(rows).toHaveLength(1);
    expect(rows[0].base).toBe("EUR");
    expect(rows[0].rate).toBe(1.08);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      fx_rate: { data: null, error: { message: "fx boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getFxRates } = await import("@/lib/db/accounting");
    await expect(getFxRates()).rejects.toThrow("getFxRates: fx boom");
  });
});

// ----- getter: getRevenueEntries ---------------------------------------------

describe("getRevenueEntries", () => {
  it("reads revenue_entry and returns camelCase rows (null lot preserved)", async () => {
    const { client, fromCalls } = makeClient({
      revenue_entry: { data: [revenueEntryRow, reversalRevenueRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getRevenueEntries } = await import("@/lib/db/accounting");
    const rows = await getRevenueEntries();

    expect(fromCalls).toContain("revenue_entry");
    expect(rows).toHaveLength(2);
    expect(rows[0].greenLotCode).toBe("JC-701");
    expect(rows[1].greenLotCode).toBeNull();
    expect(rows[1].reversesId).toBe(5);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      revenue_entry: { data: null, error: { message: "rev boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getRevenueEntries } = await import("@/lib/db/accounting");
    await expect(getRevenueEntries()).rejects.toThrow("getRevenueEntries: rev boom");
  });
});

// ----- getter: getLotMargin --------------------------------------------------

describe("getLotMargin", () => {
  it("reads v_lot_margin and preserves NULL margin for an un-costed lot", async () => {
    const { client, fromCalls } = makeClient({
      v_lot_margin: { data: [lotMarginRow, uncostedMarginRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getLotMargin } = await import("@/lib/db/accounting");
    const rows = await getLotMargin();

    expect(fromCalls).toContain("v_lot_margin");
    expect(rows).toHaveLength(2);
    expect(rows[0].marginPerKgGreen).toBe(376.3);
    expect(rows[1].marginPerKgGreen).toBeNull();
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      v_lot_margin: { data: null, error: { message: "margin boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getLotMargin } = await import("@/lib/db/accounting");
    await expect(getLotMargin()).rejects.toThrow("getLotMargin: margin boom");
  });
});

// ----- getter: getArAging ----------------------------------------------------

describe("getArAging", () => {
  it("reads v_ar_aging and returns camelCase rows", async () => {
    const { client, fromCalls } = makeClient({
      v_ar_aging: { data: [arAgingRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getArAging } = await import("@/lib/db/accounting");
    const rows = await getArAging();

    expect(fromCalls).toContain("v_ar_aging");
    expect(rows[0].balanceUsd).toBe(6664);
    expect(rows[0].agingBucket).toBe("31-60");
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      v_ar_aging: { data: null, error: { message: "aging boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getArAging } = await import("@/lib/db/accounting");
    await expect(getArAging()).rejects.toThrow("getArAging: aging boom");
  });
});

// ----- getter: getArDocs / getArDocByNumber ----------------------------------

describe("getArDocs", () => {
  it("reads ar_doc and returns camelCase docs", async () => {
    const { client, fromCalls } = makeClient({
      ar_doc: { data: [arDocRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getArDocs } = await import("@/lib/db/accounting");
    const docs = await getArDocs();

    expect(fromCalls).toContain("ar_doc");
    expect(docs[0].docNumber).toBe("CI-2026-0001");
    expect(docs[0].totalUsd).toBe(11664);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      ar_doc: { data: null, error: { message: "doc boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getArDocs } = await import("@/lib/db/accounting");
    await expect(getArDocs()).rejects.toThrow("getArDocs: doc boom");
  });
});

describe("getArDocByNumber", () => {
  it("reads ar_doc for one doc number and returns the single doc", async () => {
    const { client, fromCalls } = makeClient({
      ar_doc: { data: [arDocRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getArDocByNumber } = await import("@/lib/db/accounting");
    const doc = await getArDocByNumber("CI-2026-0001");

    expect(fromCalls).toContain("ar_doc");
    expect(doc).not.toBeNull();
    expect(doc?.docNumber).toBe("CI-2026-0001");
  });

  it("returns null when the doc number has no row", async () => {
    const { client } = makeClient({ ar_doc: { data: [], error: null } });
    getSupabaseMock.mockReturnValue(client);
    const { getArDocByNumber } = await import("@/lib/db/accounting");
    expect(await getArDocByNumber("CI-NONE")).toBeNull();
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      ar_doc: { data: null, error: { message: "by-number boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getArDocByNumber } = await import("@/lib/db/accounting");
    await expect(getArDocByNumber("CI-2026-0001")).rejects.toThrow(
      "getArDocByNumber: by-number boom",
    );
  });
});

// ----- getter: getArDocLines -------------------------------------------------

describe("getArDocLines", () => {
  it("reads ar_doc_line for one doc and returns camelCase lines", async () => {
    const { client, fromCalls } = makeClient({
      ar_doc_line: { data: [arDocLineRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getArDocLines } = await import("@/lib/db/accounting");
    const lines = await getArDocLines(9);

    expect(fromCalls).toContain("ar_doc_line");
    expect(lines[0].greenLotCode).toBe("JC-701");
    expect(lines[0].amountDoc).toBe(10800);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      ar_doc_line: { data: null, error: { message: "line boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getArDocLines } = await import("@/lib/db/accounting");
    await expect(getArDocLines(9)).rejects.toThrow("getArDocLines: line boom");
  });
});

// ----- getter: getArPaymentsForDoc -------------------------------------------

describe("getArPaymentsForDoc", () => {
  it("reads ar_payment for one doc and returns camelCase payments", async () => {
    const { client, fromCalls } = makeClient({
      ar_payment: { data: [arPaymentRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getArPaymentsForDoc } = await import("@/lib/db/accounting");
    const pays = await getArPaymentsForDoc(9);

    expect(fromCalls).toContain("ar_payment");
    expect(pays[0].method).toBe("wire");
    expect(pays[0].amountUsdAtReceipt).toBe(5000);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      ar_payment: { data: null, error: { message: "pay boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getArPaymentsForDoc } = await import("@/lib/db/accounting");
    await expect(getArPaymentsForDoc(9)).rejects.toThrow(
      "getArPaymentsForDoc: pay boom",
    );
  });
});

// ----- getter: getFxGainLossEntries ------------------------------------------

describe("getFxGainLossEntries", () => {
  it("reads fx_gain_loss_entry and returns camelCase rows", async () => {
    const { client, fromCalls } = makeClient({
      fx_gain_loss_entry: { data: [fxGainLossRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getFxGainLossEntries } = await import("@/lib/db/accounting");
    const rows = await getFxGainLossEntries();

    expect(fromCalls).toContain("fx_gain_loss_entry");
    expect(rows[0].gainUsd).toBe(92.6);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      fx_gain_loss_entry: { data: null, error: { message: "gl boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getFxGainLossEntries } = await import("@/lib/db/accounting");
    await expect(getFxGainLossEntries()).rejects.toThrow(
      "getFxGainLossEntries: gl boom",
    );
  });
});

// ----- getter: getFxAttribution (RPC) ----------------------------------------

describe("getFxAttribution", () => {
  it("calls fx_attribution with p_from/p_to and maps the single window row", async () => {
    const { client, rpcCalls } = makeClient(
      {},
      { fx_attribution: { data: [fxAttributionRow], error: null } },
    );
    getSupabaseMock.mockReturnValue(client);

    const { getFxAttribution } = await import("@/lib/db/accounting");
    const att = await getFxAttribution("2026-06-01", "2026-06-30");

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toEqual({
      fn: "fx_attribution",
      args: { p_from: "2026-06-01", p_to: "2026-06-30" },
    });
    expect(att).toEqual({
      periodFrom: "2026-06-01",
      periodTo: "2026-06-30",
      realizedFxGainUsd: 92.6,
      entries: 1,
    });
  });

  it("returns a zero-attribution window when the RPC yields no row", async () => {
    const { client } = makeClient(
      {},
      { fx_attribution: { data: [], error: null } },
    );
    getSupabaseMock.mockReturnValue(client);
    const { getFxAttribution } = await import("@/lib/db/accounting");
    const att = await getFxAttribution("2026-06-01", "2026-06-30");
    expect(att).toEqual({
      periodFrom: "2026-06-01",
      periodTo: "2026-06-30",
      realizedFxGainUsd: 0,
      entries: 0,
    });
  });

  it("throws a labelled error when the RPC fails", async () => {
    const { client } = makeClient(
      {},
      { fx_attribution: { data: null, error: { message: "att boom" } } },
    );
    getSupabaseMock.mockReturnValue(client);
    const { getFxAttribution } = await import("@/lib/db/accounting");
    await expect(
      getFxAttribution("2026-06-01", "2026-06-30"),
    ).rejects.toThrow("getFxAttribution: att boom");
  });
});
