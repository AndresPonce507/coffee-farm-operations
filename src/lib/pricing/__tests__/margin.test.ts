import { describe, expect, it } from "vitest";

import {
  COMMODITY_MIN_MARGIN_PCT,
  RESERVE_MIN_MARGIN_PCT,
  floorPrice,
  isBelowFloor,
  marginPct,
  minMarginPctForRegime,
} from "@/lib/pricing/margin";

// ─────────────────────────────────────────────────────────────────────────────
// Two DISTINCT numbers, by design (Andres's markup-vs-margin trap):
//   * floorPrice / isBelowFloor model the margin FLOOR = cost × (1 + minMarginPct)
//     — markup-ON-COST, mirroring the _enforce_margin_floor trigger.
//   * marginPct models the DISPLAY margin = (usdPrice − cost) / usdPrice
//     — margin-ON-REVENUE, mirroring the GENERATED price_quotes.margin_pct_at_quote.
// Ports/UI must never conflate them.
// ─────────────────────────────────────────────────────────────────────────────

describe("minMarginPctForRegime — the regime floor (mirrors farm_season_config)", () => {
  it("is 0.20 for reserve and 0.10 for commodity", () => {
    expect(minMarginPctForRegime("reserve")).toBe(0.2);
    expect(minMarginPctForRegime("commodity")).toBe(0.1);
    expect(RESERVE_MIN_MARGIN_PCT).toBe(0.2);
    expect(COMMODITY_MIN_MARGIN_PCT).toBe(0.1);
  });
});

describe("marginPct — DISPLAY margin-on-revenue ((price − cost) / price)", () => {
  it("computes margin on revenue (the dogfood's ~71% number)", () => {
    // (10 − 2.9) / 10 = 0.71
    expect(marginPct(10, 2.9)).toBeCloseTo(0.71, 10);
  });

  it("is NULL when the cost is unknown (never a fabricated margin)", () => {
    expect(marginPct(10, null)).toBeNull();
    expect(marginPct(10, undefined)).toBeNull();
  });

  it("is NULL when cost is non-positive (0 cost is unknown, not 100% margin) — defensive superset of the DB", () => {
    // Real cogs_per_lot is either NULL or strictly positive, so this never fires on
    // real data — but a client display must never present a fake 100% from a 0 cost.
    expect(marginPct(10, 0)).toBeNull();
    expect(marginPct(10, -1)).toBeNull();
  });

  it("is NULL when the price is 0 (no revenue to take a margin of)", () => {
    expect(marginPct(0, 5)).toBeNull();
  });
});

describe("floorPrice — the markup-ON-COST floor = cost × (1 + minMarginPct)", () => {
  it("is cost × (1 + pct) for the reserve floor", () => {
    // 10 × (1 + 0.20) = 12
    expect(floorPrice(10, RESERVE_MIN_MARGIN_PCT)).toBeCloseTo(12, 10);
  });

  it("is cost × (1 + pct) for the commodity floor", () => {
    // 10 × (1 + 0.10) = 11
    expect(floorPrice(10, COMMODITY_MIN_MARGIN_PCT)).toBeCloseTo(11, 10);
  });

  it("is NULL when the cost is unknown or non-positive (no fabricated floor)", () => {
    expect(floorPrice(null, 0.2)).toBeNull();
    expect(floorPrice(undefined, 0.2)).toBeNull();
    expect(floorPrice(0, 0.2)).toBeNull();
  });
});

describe("isBelowFloor — the margin-floor guard (mirrors the BEFORE-INSERT trigger)", () => {
  it("flags a price below cost × (1 + pct)", () => {
    // floor = 10 × 1.20 = 12 ; 11 < 12 -> below
    expect(isBelowFloor(11, 10, RESERVE_MIN_MARGIN_PCT)).toBe(true);
  });

  it("allows a price exactly at the floor (>= floor passes; not strictly below)", () => {
    expect(isBelowFloor(12, 10, RESERVE_MIN_MARGIN_PCT)).toBe(false);
  });

  it("allows a price above the floor", () => {
    expect(isBelowFloor(13, 10, RESERVE_MIN_MARGIN_PCT)).toBe(false);
  });

  it("allows-but-flags when the cost is unknown/non-positive (NULL COGS -> not below floor)", () => {
    // Mirrors the trigger: a NULL cost is allowed (margin unknown), never rejected.
    expect(isBelowFloor(5, null, RESERVE_MIN_MARGIN_PCT)).toBe(false);
    expect(isBelowFloor(5, 0, RESERVE_MIN_MARGIN_PCT)).toBe(false);
  });

  it("honors the same 1e-9 slack as the DB trigger (no false reject on rounding dust)", () => {
    // floor = 12 ; a price one part-in-a-trillion under it is within slack -> allowed
    expect(isBelowFloor(12 - 1e-12, 10, RESERVE_MIN_MARGIN_PCT)).toBe(false);
    // a real cent under the floor is below
    expect(isBelowFloor(11.99, 10, RESERVE_MIN_MARGIN_PCT)).toBe(true);
  });
});

describe("markup-vs-margin — the two numbers are deliberately different", () => {
  it("a price sitting exactly on the 10% markup floor is NOT a 10% revenue margin", () => {
    const cost = 10;
    const price = floorPrice(cost, COMMODITY_MIN_MARGIN_PCT)!; // 11 (markup-on-cost)
    expect(price).toBeCloseTo(11, 10);
    // margin-on-revenue at that price = (11 − 10)/11 ≈ 0.0909, NOT 0.10
    expect(marginPct(price, cost)).toBeCloseTo(1 / 11, 10);
    expect(marginPct(price, cost)).not.toBeCloseTo(0.1, 3);
  });
});
