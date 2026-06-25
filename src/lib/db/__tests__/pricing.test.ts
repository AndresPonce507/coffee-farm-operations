import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AuctionCompRow,
  FixationExposureRow,
  IceCLatestRow,
  IceCQuoteRow,
  LotPriceBookRow,
} from "@/lib/db/pricing";

/**
 * Coverage of the `pricing.ts` READ-port (P3-S0 — the dual-regime pricing core):
 * the pure mappers (snake_case view/table row → camelCase domain, numeric coercion
 * of price/cost/kg columns PostgREST may serialize as strings, NULL preservation
 * for an unknown COGS / missing indicative price) and the `cache()`-wrapped getters'
 * fetch + map round-trip:
 *
 *   - `getPriceBook()`        reads `v_lot_price_book`   (regime + indicative price + cogs floor + ATP per lot).
 *   - `getLotPricing(lot)`    reads `v_lot_price_book` filtered to one lot (null when absent).
 *   - `getFixationExposure()` reads `v_fixation_exposure` (open unfixed commodity risk × live "C").
 *   - `getIceCLatest()`       reads `v_ice_c_latest`     (latest mark per contract month).
 *   - `getAuctionComps()`     reads `auction_comps`      (the reserve comp library, highest first).
 *   - `listIceCQuotes()`      reads `ice_c_quotes`       (the append-only "C" mark ledger, newest first).
 *
 * Strategy mirrors `greenlots.test.ts` / `cogs.test.ts`: mock `@/lib/supabase/server`
 * so `getSupabase()` returns a chainable, thenable query-builder. The pricing math
 * itself is the views'/RPCs' job (pinned by the migration's PGlite tests, not
 * re-implemented here); this port only proves the row→domain seam + NULL handling
 * survive `cache()` and hit the right table/view.
 */

// ----- chainable, per-table Supabase query-builder stub ---------------------

interface QueryResult<T> {
  data: T;
  error: { message: string } | null;
}

type TableResults = Record<string, QueryResult<unknown>>;

/**
 * Build a client whose `.from(table)` returns a fresh chainable builder bound to
 * that table's configured result. Each chain method returns the builder and the
 * builder is thenable, so `await client.from(t).select(...).eq(...).order(...)`
 * resolves to `results[t]`. The `from` calls are recorded so a getter can be
 * pinned to the right table/view.
 */
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

const priceBookRow: LotPriceBookRow = {
  green_lot_code: "JC-701",
  sca_grade: "Specialty",
  cupping_score: "88.5", // PostgREST may serialize numeric as a string
  regime: "reserve",
  cogs_per_kg_green: "12.5",
  atp_kg: "40",
  indicative_unit_price: "450",
};

const commodityBookRow: LotPriceBookRow = {
  green_lot_code: "JC-820",
  sca_grade: "Premium",
  cupping_score: "82",
  regime: "commodity",
  cogs_per_kg_green: null, // COGS unknown ⇒ margin unknown (preserved, never 0)
  atp_kg: null, // no green inventory yet (left join miss)
  indicative_unit_price: null, // no live "C" mark yet
};

const iceCLatestRow: IceCLatestRow = {
  contract_month: "2026-12",
  price: "1.85", // USD per lb ("C")
  as_of: "2026-06-20T10:00:00Z",
  source: "manual",
};

const fixationExposureRow: FixationExposureRow = {
  green_lot_code: "JC-820",
  reservation_id: 5,
  kg: "60",
  ice_c_contract_month: "2026-12",
  current_c_price: "1.85",
  exposure_usd: "244.71",
  price_quote_id: 101,
};

const auctionCompRow: AuctionCompRow = {
  id: 1,
  auction_name: "Best of Panama",
  lot_label: "Washed Geisha (champion lot)",
  variety: "Geisha",
  process: "Washed",
  cup_score: "94",
  price_usd_per_kg: "30204",
  result_year: 2025,
  created_at: "2026-06-20T10:00:00Z",
};

const iceCQuoteRow: IceCQuoteRow = {
  id: 3,
  contract_month: "2026-12",
  as_of: "2026-06-20T10:00:00Z",
  price: "1.85",
  source: "manual",
  created_at: "2026-06-20T10:00:01Z",
};

// ----- pure mapper: mapPriceBookEntry ---------------------------------------

describe("mapPriceBookEntry", () => {
  it("maps a v_lot_price_book row to a camelCase entry with numeric coercion", async () => {
    const { mapPriceBookEntry } = await import("@/lib/db/pricing");
    expect(mapPriceBookEntry(priceBookRow)).toEqual({
      greenLotCode: "JC-701",
      scaGrade: "Specialty",
      cuppingScore: 88.5,
      regime: "reserve",
      cogsPerKgGreen: 12.5,
      atpKg: 40,
      indicativeUnitPrice: 450,
    });
  });

  it("preserves NULL cogs/atp/indicative price (never a fabricated 0)", async () => {
    const { mapPriceBookEntry } = await import("@/lib/db/pricing");
    const e = mapPriceBookEntry(commodityBookRow);
    expect(e.cogsPerKgGreen).toBeNull();
    expect(e.atpKg).toBeNull();
    expect(e.indicativeUnitPrice).toBeNull();
    expect(e.regime).toBe("commodity");
  });
});

// ----- pure mapper: mapIceCLatest -------------------------------------------

describe("mapIceCLatest", () => {
  it("maps a v_ice_c_latest row, coercing the price string to a number", async () => {
    const { mapIceCLatest } = await import("@/lib/db/pricing");
    expect(mapIceCLatest(iceCLatestRow)).toEqual({
      contractMonth: "2026-12",
      price: 1.85,
      asOf: "2026-06-20T10:00:00Z",
      source: "manual",
    });
  });
});

// ----- pure mapper: mapFixationExposure -------------------------------------

describe("mapFixationExposure", () => {
  it("maps a v_fixation_exposure row, coercing kg/price/exposure and the price-quote id", async () => {
    const { mapFixationExposure } = await import("@/lib/db/pricing");
    expect(mapFixationExposure(fixationExposureRow)).toEqual({
      greenLotCode: "JC-820",
      reservationId: 5,
      kg: 60,
      iceCContractMonth: "2026-12",
      currentCPrice: 1.85,
      exposureUsd: 244.71,
      priceQuoteId: 101,
    });
  });

  it("preserves a NULL current-C / exposure when no live mark exists", async () => {
    const { mapFixationExposure } = await import("@/lib/db/pricing");
    const e = mapFixationExposure({
      ...fixationExposureRow,
      current_c_price: null,
      exposure_usd: null,
    });
    expect(e.currentCPrice).toBeNull();
    expect(e.exposureUsd).toBeNull();
  });

  it("yields a NULL priceQuoteId until the view surfaces price_quote_id (the flagged seam)", async () => {
    const { mapFixationExposure } = await import("@/lib/db/pricing");
    const { price_quote_id: _omit, ...rowWithoutQuoteId } = fixationExposureRow;
    const e = mapFixationExposure(rowWithoutQuoteId);
    expect(e.priceQuoteId).toBeNull();
  });
});

// ----- pure mapper: mapAuctionComp ------------------------------------------

describe("mapAuctionComp", () => {
  it("maps an auction_comps row with numeric coercion of score/price", async () => {
    const { mapAuctionComp } = await import("@/lib/db/pricing");
    expect(mapAuctionComp(auctionCompRow)).toEqual({
      id: 1,
      auctionName: "Best of Panama",
      lotLabel: "Washed Geisha (champion lot)",
      variety: "Geisha",
      process: "Washed",
      cupScore: 94,
      priceUsdPerKg: 30204,
      resultYear: 2025,
      createdAt: "2026-06-20T10:00:00Z",
    });
  });

  it("passes null label/variety/process/score/year through unchanged", async () => {
    const { mapAuctionComp } = await import("@/lib/db/pricing");
    const c = mapAuctionComp({
      ...auctionCompRow,
      lot_label: null,
      variety: null,
      process: null,
      cup_score: null,
      result_year: null,
    });
    expect(c.lotLabel).toBeNull();
    expect(c.variety).toBeNull();
    expect(c.process).toBeNull();
    expect(c.cupScore).toBeNull();
    expect(c.resultYear).toBeNull();
    expect(c.priceUsdPerKg).toBe(30204);
  });
});

// ----- pure mapper: mapIceCQuote --------------------------------------------

describe("mapIceCQuote", () => {
  it("maps an ice_c_quotes ledger row with numeric coercion of the price", async () => {
    const { mapIceCQuote } = await import("@/lib/db/pricing");
    expect(mapIceCQuote(iceCQuoteRow)).toEqual({
      id: 3,
      contractMonth: "2026-12",
      asOf: "2026-06-20T10:00:00Z",
      price: 1.85,
      source: "manual",
      createdAt: "2026-06-20T10:00:01Z",
    });
  });
});

// ----- getter: getPriceBook --------------------------------------------------

describe("getPriceBook", () => {
  it("reads v_lot_price_book and returns camelCase entries", async () => {
    const { client, fromCalls } = makeClient({
      v_lot_price_book: { data: [priceBookRow, commodityBookRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getPriceBook } = await import("@/lib/db/pricing");
    const book = await getPriceBook();

    expect(fromCalls).toContain("v_lot_price_book");
    expect(book).toHaveLength(2);
    expect(book[0].greenLotCode).toBe("JC-701");
    expect(book[1].cogsPerKgGreen).toBeNull();
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      v_lot_price_book: { data: null, error: { message: "book boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getPriceBook } = await import("@/lib/db/pricing");
    await expect(getPriceBook()).rejects.toThrow("getPriceBook: book boom");
  });
});

// ----- getter: getLotPricing -------------------------------------------------

describe("getLotPricing", () => {
  it("reads v_lot_price_book for one lot and returns the single entry", async () => {
    const { client, fromCalls } = makeClient({
      v_lot_price_book: { data: [priceBookRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getLotPricing } = await import("@/lib/db/pricing");
    const entry = await getLotPricing("JC-701");

    expect(fromCalls).toContain("v_lot_price_book");
    expect(entry).not.toBeNull();
    expect(entry?.greenLotCode).toBe("JC-701");
    expect(entry?.regime).toBe("reserve");
  });

  it("returns null when the lot has no price-book row", async () => {
    const { client } = makeClient({
      v_lot_price_book: { data: [], error: null },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getLotPricing } = await import("@/lib/db/pricing");
    expect(await getLotPricing("JC-000")).toBeNull();
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      v_lot_price_book: { data: null, error: { message: "lot boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getLotPricing } = await import("@/lib/db/pricing");
    await expect(getLotPricing("JC-701")).rejects.toThrow(
      "getLotPricing: lot boom",
    );
  });
});

// ----- getter: getFixationExposure -------------------------------------------

describe("getFixationExposure", () => {
  it("reads v_fixation_exposure and returns camelCase rows", async () => {
    const { client, fromCalls } = makeClient({
      v_fixation_exposure: { data: [fixationExposureRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getFixationExposure } = await import("@/lib/db/pricing");
    const rows = await getFixationExposure();

    expect(fromCalls).toContain("v_fixation_exposure");
    expect(rows).toEqual([
      {
        greenLotCode: "JC-820",
        reservationId: 5,
        kg: 60,
        iceCContractMonth: "2026-12",
        currentCPrice: 1.85,
        exposureUsd: 244.71,
        priceQuoteId: 101,
      },
    ]);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      v_fixation_exposure: { data: null, error: { message: "exp boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getFixationExposure } = await import("@/lib/db/pricing");
    await expect(getFixationExposure()).rejects.toThrow(
      "getFixationExposure: exp boom",
    );
  });
});

// ----- getter: getIceCLatest -------------------------------------------------

describe("getIceCLatest", () => {
  it("reads v_ice_c_latest and returns camelCase rows", async () => {
    const { client, fromCalls } = makeClient({
      v_ice_c_latest: { data: [iceCLatestRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getIceCLatest } = await import("@/lib/db/pricing");
    const rows = await getIceCLatest();

    expect(fromCalls).toContain("v_ice_c_latest");
    expect(rows).toEqual([
      {
        contractMonth: "2026-12",
        price: 1.85,
        asOf: "2026-06-20T10:00:00Z",
        source: "manual",
      },
    ]);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      v_ice_c_latest: { data: null, error: { message: "latest boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getIceCLatest } = await import("@/lib/db/pricing");
    await expect(getIceCLatest()).rejects.toThrow("getIceCLatest: latest boom");
  });
});

// ----- getter: getAuctionComps -----------------------------------------------

describe("getAuctionComps", () => {
  it("reads auction_comps and returns camelCase comps", async () => {
    const { client, fromCalls } = makeClient({
      auction_comps: { data: [auctionCompRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getAuctionComps } = await import("@/lib/db/pricing");
    const comps = await getAuctionComps();

    expect(fromCalls).toContain("auction_comps");
    expect(comps[0].auctionName).toBe("Best of Panama");
    expect(comps[0].priceUsdPerKg).toBe(30204);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      auction_comps: { data: null, error: { message: "comp boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getAuctionComps } = await import("@/lib/db/pricing");
    await expect(getAuctionComps()).rejects.toThrow(
      "getAuctionComps: comp boom",
    );
  });
});

// ----- getter: listIceCQuotes ------------------------------------------------

describe("listIceCQuotes", () => {
  it("reads the ice_c_quotes ledger and returns camelCase marks", async () => {
    const { client, fromCalls } = makeClient({
      ice_c_quotes: { data: [iceCQuoteRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { listIceCQuotes } = await import("@/lib/db/pricing");
    const marks = await listIceCQuotes();

    expect(fromCalls).toContain("ice_c_quotes");
    expect(marks).toEqual([
      {
        id: 3,
        contractMonth: "2026-12",
        asOf: "2026-06-20T10:00:00Z",
        price: 1.85,
        source: "manual",
        createdAt: "2026-06-20T10:00:01Z",
      },
    ]);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      ice_c_quotes: { data: null, error: { message: "ledger boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { listIceCQuotes } = await import("@/lib/db/pricing");
    await expect(listIceCQuotes()).rejects.toThrow(
      "listIceCQuotes: ledger boom",
    );
  });
});
