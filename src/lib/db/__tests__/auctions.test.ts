import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AuctionEntryRow,
  AuctionFinalScoreRow,
  AuctionResultRow,
  AuctionRow,
  AuctionScoresheetRow,
} from "@/lib/db/auctions";

/**
 * Coverage of the `auctions.ts` READ-port (P3-S4 — specialty auctions, the
 * highest-multiplier channel): the pure mappers (snake_case view/table row →
 * camelCase domain, numeric coercion of score/price/kg columns PostgREST may
 * serialize as strings, NULL preservation for an un-scored jury / un-cleared lot /
 * missing commodity baseline) and the `cache()`-wrapped getters' fetch + map
 * round-trip:
 *
 *   - `getAuctions()`            reads `auctions`              (the auction headers, newest first).
 *   - `getAuction(id)`          reads `auctions` filtered to one id (null when absent).
 *   - `getAuctionResults()`      reads `v_auction_results`     (entries + panel + clearing + multiplier).
 *   - `getAuctionResultsFor(id)` reads `v_auction_results` filtered to one auction.
 *   - `getAuctionEntries(id)`    reads `auction_entries`       (the lots entered into an auction).
 *   - `getAuctionScoresheets(e)` reads `auction_scoresheets`   (the append-only jury marks for an entry).
 *   - `getAuctionFinalScore(e)`  reads `v_auction_final_score` (the aggregated panel score, null when absent).
 *
 * Strategy mirrors `pricing.test.ts` / `greenlots.test.ts`: mock
 * `@/lib/supabase/server` so `getSupabase()` returns a chainable, thenable
 * query-builder. The auction math (the panel average, the BoP price-multiplier over
 * the commodity baseline) is the views' job (pinned by the migration's PGlite
 * tests, not re-implemented here); this port only proves the row→domain seam + NULL
 * handling survive `cache()` and hit the right table/view.
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

const auctionRow: AuctionRow = {
  id: 7,
  platform: "best_of_panama",
  name: "Best of Panama 2026",
  entry_deadline: "2026-03-01T00:00:00Z",
  scoring_deadline: "2026-05-01T00:00:00Z",
  status: "scored",
  created_at: "2026-06-20T10:00:00Z",
};

const resultRow: AuctionResultRow = {
  entry_id: 11,
  auction_id: 7,
  auction_name: "Best of Panama 2026",
  platform: "best_of_panama",
  auction_status: "sold",
  green_lot_code: "JC-204",
  farm_cupping_score: "91", // the farm's own grade INPUT (string from PostgREST)
  jury_score: "91.5", // the auction panel's verdict
  panel_final_score: "91.42", // aggregated scoresheets
  clearing_price_usd_per_kg: "510",
  winning_bidder: "Tokyo Roaster Co.",
  result_year: 2026,
  commodity_baseline_usd_per_kg: "5.10",
  price_multiplier: "100", // 510 ÷ 5.10
};

const unscoredResultRow: AuctionResultRow = {
  entry_id: 12,
  auction_id: 7,
  auction_name: "Best of Panama 2026",
  platform: "best_of_panama",
  auction_status: "scored",
  green_lot_code: "JC-205",
  farm_cupping_score: null, // not cupped in-house yet
  jury_score: null, // not yet judged
  panel_final_score: null, // no scoresheets yet
  clearing_price_usd_per_kg: null, // not cleared
  winning_bidder: null,
  result_year: null,
  commodity_baseline_usd_per_kg: null, // no live "C" mark ⇒ no baseline
  price_multiplier: null, // can't compute without baseline/clearing
};

const finalScoreRow: AuctionFinalScoreRow = {
  entry_id: 11,
  auction_id: 7,
  green_lot_code: "JC-204",
  final_score: "91.42",
  juror_count: "5",
  mark_count: "30",
};

const scoresheetRow: AuctionScoresheetRow = {
  id: 3,
  entry_id: 11,
  juror: "Juror A",
  attribute: "Aroma",
  score: "9.25",
  occurred_at: "2026-04-15T12:00:00Z",
  created_at: "2026-04-15T12:00:01Z",
};

const entryRow: AuctionEntryRow = {
  id: 11,
  auction_id: 7,
  green_lot_code: "JC-204",
  kg: "30",
  jury_score: "91.5",
  clearing_price_usd_per_kg: "510",
  winning_bidder: "Tokyo Roaster Co.",
  result_year: 2026,
  reservation_id: 88,
  sold_at: "2026-05-10T12:00:00Z",
  created_at: "2026-03-01T10:00:00Z",
};

// ----- pure mapper: mapAuction ----------------------------------------------

describe("mapAuction", () => {
  it("maps an auctions row to a camelCase auction", async () => {
    const { mapAuction } = await import("@/lib/db/auctions");
    expect(mapAuction(auctionRow)).toEqual({
      id: 7,
      platform: "best_of_panama",
      name: "Best of Panama 2026",
      entryDeadline: "2026-03-01T00:00:00Z",
      scoringDeadline: "2026-05-01T00:00:00Z",
      status: "scored",
      createdAt: "2026-06-20T10:00:00Z",
    });
  });

  it("preserves null deadlines", async () => {
    const { mapAuction } = await import("@/lib/db/auctions");
    const a = mapAuction({
      ...auctionRow,
      entry_deadline: null,
      scoring_deadline: null,
    });
    expect(a.entryDeadline).toBeNull();
    expect(a.scoringDeadline).toBeNull();
  });
});

// ----- pure mapper: mapAuctionResult ----------------------------------------

describe("mapAuctionResult", () => {
  it("maps a v_auction_results row with numeric coercion of score/price/multiplier", async () => {
    const { mapAuctionResult } = await import("@/lib/db/auctions");
    expect(mapAuctionResult(resultRow)).toEqual({
      entryId: 11,
      auctionId: 7,
      auctionName: "Best of Panama 2026",
      platform: "best_of_panama",
      auctionStatus: "sold",
      greenLotCode: "JC-204",
      farmCuppingScore: 91,
      juryScore: 91.5,
      panelFinalScore: 91.42,
      clearingPriceUsdPerKg: 510,
      winningBidder: "Tokyo Roaster Co.",
      resultYear: 2026,
      commodityBaselineUsdPerKg: 5.1,
      priceMultiplier: 100,
    });
  });

  it("preserves NULL jury/panel/clearing/baseline/multiplier (never fabricated to 0)", async () => {
    const { mapAuctionResult } = await import("@/lib/db/auctions");
    const r = mapAuctionResult(unscoredResultRow);
    expect(r.farmCuppingScore).toBeNull();
    expect(r.juryScore).toBeNull();
    expect(r.panelFinalScore).toBeNull();
    expect(r.clearingPriceUsdPerKg).toBeNull();
    expect(r.winningBidder).toBeNull();
    expect(r.resultYear).toBeNull();
    expect(r.commodityBaselineUsdPerKg).toBeNull();
    expect(r.priceMultiplier).toBeNull();
  });
});

// ----- pure mapper: mapAuctionFinalScore ------------------------------------

describe("mapAuctionFinalScore", () => {
  it("maps a v_auction_final_score row, coercing score/counts", async () => {
    const { mapAuctionFinalScore } = await import("@/lib/db/auctions");
    expect(mapAuctionFinalScore(finalScoreRow)).toEqual({
      entryId: 11,
      auctionId: 7,
      greenLotCode: "JC-204",
      finalScore: 91.42,
      jurorCount: 5,
      markCount: 30,
    });
  });

  it("preserves a NULL final score (no marks yet)", async () => {
    const { mapAuctionFinalScore } = await import("@/lib/db/auctions");
    const s = mapAuctionFinalScore({ ...finalScoreRow, final_score: null });
    expect(s.finalScore).toBeNull();
  });
});

// ----- pure mapper: mapAuctionScoresheet ------------------------------------

describe("mapAuctionScoresheet", () => {
  it("maps an auction_scoresheets row, coercing the score", async () => {
    const { mapAuctionScoresheet } = await import("@/lib/db/auctions");
    expect(mapAuctionScoresheet(scoresheetRow)).toEqual({
      id: 3,
      entryId: 11,
      juror: "Juror A",
      attribute: "Aroma",
      score: 9.25,
      occurredAt: "2026-04-15T12:00:00Z",
      createdAt: "2026-04-15T12:00:01Z",
    });
  });
});

// ----- pure mapper: mapAuctionEntry -----------------------------------------

describe("mapAuctionEntry", () => {
  it("maps an auction_entries row with numeric coercion and null passthrough", async () => {
    const { mapAuctionEntry } = await import("@/lib/db/auctions");
    expect(mapAuctionEntry(entryRow)).toEqual({
      id: 11,
      auctionId: 7,
      greenLotCode: "JC-204",
      kg: 30,
      juryScore: 91.5,
      clearingPriceUsdPerKg: 510,
      winningBidder: "Tokyo Roaster Co.",
      resultYear: 2026,
      reservationId: 88,
      soldAt: "2026-05-10T12:00:00Z",
      createdAt: "2026-03-01T10:00:00Z",
    });
  });

  it("preserves nulls on an un-cleared entry", async () => {
    const { mapAuctionEntry } = await import("@/lib/db/auctions");
    const e = mapAuctionEntry({
      ...entryRow,
      jury_score: null,
      clearing_price_usd_per_kg: null,
      winning_bidder: null,
      result_year: null,
      reservation_id: null,
      sold_at: null,
    });
    expect(e.juryScore).toBeNull();
    expect(e.clearingPriceUsdPerKg).toBeNull();
    expect(e.winningBidder).toBeNull();
    expect(e.resultYear).toBeNull();
    expect(e.reservationId).toBeNull();
    expect(e.soldAt).toBeNull();
    expect(e.kg).toBe(30);
  });
});

// ----- getter: getAuctions ---------------------------------------------------

describe("getAuctions", () => {
  it("reads auctions and returns camelCase headers", async () => {
    const { client, fromCalls } = makeClient({
      auctions: { data: [auctionRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getAuctions } = await import("@/lib/db/auctions");
    const rows = await getAuctions();

    expect(fromCalls).toContain("auctions");
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Best of Panama 2026");
    expect(rows[0].platform).toBe("best_of_panama");
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      auctions: { data: null, error: { message: "auc boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getAuctions } = await import("@/lib/db/auctions");
    await expect(getAuctions()).rejects.toThrow("getAuctions: auc boom");
  });
});

// ----- getter: getAuction ----------------------------------------------------

describe("getAuction", () => {
  it("reads auctions for one id and returns the single header", async () => {
    const { client, fromCalls } = makeClient({
      auctions: { data: [auctionRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getAuction } = await import("@/lib/db/auctions");
    const a = await getAuction(7);

    expect(fromCalls).toContain("auctions");
    expect(a).not.toBeNull();
    expect(a?.id).toBe(7);
    expect(a?.status).toBe("scored");
  });

  it("returns null when the auction id has no row", async () => {
    const { client } = makeClient({ auctions: { data: [], error: null } });
    getSupabaseMock.mockReturnValue(client);
    const { getAuction } = await import("@/lib/db/auctions");
    expect(await getAuction(999)).toBeNull();
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      auctions: { data: null, error: { message: "one boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getAuction } = await import("@/lib/db/auctions");
    await expect(getAuction(7)).rejects.toThrow("getAuction: one boom");
  });
});

// ----- getter: getAuctionResults ---------------------------------------------

describe("getAuctionResults", () => {
  it("reads v_auction_results and returns camelCase results", async () => {
    const { client, fromCalls } = makeClient({
      v_auction_results: { data: [resultRow, unscoredResultRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getAuctionResults } = await import("@/lib/db/auctions");
    const rows = await getAuctionResults();

    expect(fromCalls).toContain("v_auction_results");
    expect(rows).toHaveLength(2);
    expect(rows[0].priceMultiplier).toBe(100);
    expect(rows[1].priceMultiplier).toBeNull();
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      v_auction_results: { data: null, error: { message: "res boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getAuctionResults } = await import("@/lib/db/auctions");
    await expect(getAuctionResults()).rejects.toThrow(
      "getAuctionResults: res boom",
    );
  });
});

// ----- getter: getAuctionResultsFor ------------------------------------------

describe("getAuctionResultsFor", () => {
  it("reads v_auction_results filtered to one auction", async () => {
    const { client, fromCalls } = makeClient({
      v_auction_results: { data: [resultRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getAuctionResultsFor } = await import("@/lib/db/auctions");
    const rows = await getAuctionResultsFor(7);

    expect(fromCalls).toContain("v_auction_results");
    expect(rows).toHaveLength(1);
    expect(rows[0].auctionId).toBe(7);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      v_auction_results: { data: null, error: { message: "for boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getAuctionResultsFor } = await import("@/lib/db/auctions");
    await expect(getAuctionResultsFor(7)).rejects.toThrow(
      "getAuctionResultsFor: for boom",
    );
  });
});

// ----- getter: getAuctionEntries ---------------------------------------------

describe("getAuctionEntries", () => {
  it("reads auction_entries filtered to one auction", async () => {
    const { client, fromCalls } = makeClient({
      auction_entries: { data: [entryRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getAuctionEntries } = await import("@/lib/db/auctions");
    const rows = await getAuctionEntries(7);

    expect(fromCalls).toContain("auction_entries");
    expect(rows).toHaveLength(1);
    expect(rows[0].greenLotCode).toBe("JC-204");
    expect(rows[0].reservationId).toBe(88);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      auction_entries: { data: null, error: { message: "ent boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getAuctionEntries } = await import("@/lib/db/auctions");
    await expect(getAuctionEntries(7)).rejects.toThrow(
      "getAuctionEntries: ent boom",
    );
  });
});

// ----- getter: getAuctionScoresheets -----------------------------------------

describe("getAuctionScoresheets", () => {
  it("reads auction_scoresheets filtered to one entry", async () => {
    const { client, fromCalls } = makeClient({
      auction_scoresheets: { data: [scoresheetRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getAuctionScoresheets } = await import("@/lib/db/auctions");
    const rows = await getAuctionScoresheets(11);

    expect(fromCalls).toContain("auction_scoresheets");
    expect(rows).toHaveLength(1);
    expect(rows[0].juror).toBe("Juror A");
    expect(rows[0].score).toBe(9.25);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      auction_scoresheets: { data: null, error: { message: "score boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getAuctionScoresheets } = await import("@/lib/db/auctions");
    await expect(getAuctionScoresheets(11)).rejects.toThrow(
      "getAuctionScoresheets: score boom",
    );
  });
});

// ----- getter: getAuctionFinalScore ------------------------------------------

describe("getAuctionFinalScore", () => {
  it("reads v_auction_final_score for one entry and returns the aggregate", async () => {
    const { client, fromCalls } = makeClient({
      v_auction_final_score: { data: [finalScoreRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getAuctionFinalScore } = await import("@/lib/db/auctions");
    const s = await getAuctionFinalScore(11);

    expect(fromCalls).toContain("v_auction_final_score");
    expect(s).not.toBeNull();
    expect(s?.finalScore).toBe(91.42);
    expect(s?.jurorCount).toBe(5);
  });

  it("returns null when the entry has no marks yet", async () => {
    const { client } = makeClient({
      v_auction_final_score: { data: [], error: null },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getAuctionFinalScore } = await import("@/lib/db/auctions");
    expect(await getAuctionFinalScore(11)).toBeNull();
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      v_auction_final_score: { data: null, error: { message: "fs boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getAuctionFinalScore } = await import("@/lib/db/auctions");
    await expect(getAuctionFinalScore(11)).rejects.toThrow(
      "getAuctionFinalScore: fs boom",
    );
  });
});
