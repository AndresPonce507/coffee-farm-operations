import { describe, expect, it } from "vitest";

import {
  buildAuctionSummaries,
  type AuctionHeader,
  type AuctionResultRow,
} from "@/app/(app)/sales/auctions/data";

/**
 * buildAuctionSummaries is the pure grouping that powers the board: it folds the
 * per-entry v_auction_results rows up onto each auction header (entry count, sold
 * count, the best clearing price and the best multiplier over the commodity C).
 * Pure, no DB — tested directly red→green.
 */

const header = (over: Partial<AuctionHeader> = {}): AuctionHeader => ({
  id: 1,
  platform: "best_of_panama",
  name: "Best of Panama 2026",
  status: "entered",
  entryDeadline: null,
  scoringDeadline: null,
  ...over,
});

const result = (over: Partial<AuctionResultRow> = {}): AuctionResultRow => ({
  entryId: 1,
  auctionId: 1,
  auctionName: "Best of Panama 2026",
  platform: "best_of_panama",
  auctionStatus: "sold",
  greenLotCode: "JC-204",
  farmCuppingScore: 91,
  juryScore: 91.5,
  panelFinalScore: 91.4,
  clearingPriceUsdPerKg: 510,
  winningBidder: "Tokyo Roasters",
  resultYear: 2026,
  commodityBaselineUsdPerKg: 5.1,
  priceMultiplier: 100,
  ...over,
});

describe("buildAuctionSummaries", () => {
  it("counts the entries that belong to each auction", () => {
    const out = buildAuctionSummaries(
      [header({ id: 1 }), header({ id: 2, name: "CoE 2026" })],
      [
        result({ entryId: 10, auctionId: 1 }),
        result({ entryId: 11, auctionId: 1, greenLotCode: "JC-205" }),
        result({ entryId: 20, auctionId: 2 }),
      ],
    );
    expect(out.find((a) => a.id === 1)?.entryCount).toBe(2);
    expect(out.find((a) => a.id === 2)?.entryCount).toBe(1);
  });

  it("an auction with no entries reports zero counts and null bests", () => {
    const [a] = buildAuctionSummaries([header({ id: 9 })], []);
    expect(a.entryCount).toBe(0);
    expect(a.soldCount).toBe(0);
    expect(a.bestClearingPriceUsdPerKg).toBeNull();
    expect(a.bestMultiplier).toBeNull();
  });

  it("soldCount counts only entries that actually cleared (have a clearing price)", () => {
    const [a] = buildAuctionSummaries(
      [header({ id: 1 })],
      [
        result({ entryId: 1, clearingPriceUsdPerKg: 510 }),
        result({ entryId: 2, clearingPriceUsdPerKg: null, priceMultiplier: null }),
      ],
    );
    expect(a.entryCount).toBe(2);
    expect(a.soldCount).toBe(1);
  });

  it("takes the highest clearing price and highest multiplier, ignoring nulls", () => {
    const [a] = buildAuctionSummaries(
      [header({ id: 1 })],
      [
        result({ entryId: 1, clearingPriceUsdPerKg: 400, priceMultiplier: 78 }),
        result({ entryId: 2, clearingPriceUsdPerKg: 510, priceMultiplier: 101 }),
        result({ entryId: 3, clearingPriceUsdPerKg: null, priceMultiplier: null }),
      ],
    );
    expect(a.bestClearingPriceUsdPerKg).toBe(510);
    expect(a.bestMultiplier).toBe(101);
  });

  it("carries the auction header fields through unchanged", () => {
    const [a] = buildAuctionSummaries(
      [header({ id: 3, platform: "algrano", name: "Algrano Live", status: "scored" })],
      [],
    );
    expect(a.platform).toBe("algrano");
    expect(a.name).toBe("Algrano Live");
    expect(a.status).toBe("scored");
  });
});
