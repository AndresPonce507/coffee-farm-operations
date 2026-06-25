import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LotPricing } from "@/app/(app)/pricing/data";

// The composer is a regime-AWARE Server Component. Stub the per-lot port + the
// interactive client island so this test pins the server page's job: render the
// correct regime story (a C sparkline for commodity, the score×scarcity×comp
// build-up for reserve) and NEVER cross the streams.
const { getLotPricingMock } = vi.hoisted(() => ({ getLotPricingMock: vi.fn() }));
vi.mock("@/app/(app)/pricing/data", () => ({ getLotPricing: getLotPricingMock }));
vi.mock("@/app/(app)/pricing/[lot]/quote-composer.client", () => ({
  QuoteComposer: () => <div data-testid="quote-composer-stub" />,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import ComposerPage from "@/app/(app)/pricing/[lot]/page";

const RESERVE: LotPricing = {
  row: {
    greenLotCode: "JC-901",
    variety: "Geisha",
    scaGrade: "Presidential",
    cuppingScore: 92,
    regime: "reserve",
    cogsPerKgGreen: 140,
    atpKg: 50,
    indicativeUnitPrice: 480,
    nearestComp: {
      auctionName: "Best of Panama",
      lotLabel: "Lot 12",
      variety: "Geisha",
      process: "Washed",
      cupScore: 94,
      priceUsdPerKg: 30204,
      resultYear: 2025,
    },
  },
  cMarks: [],
  latestContractMonth: null,
  latestCPrice: null,
  defaultDifferentialUsdPerLb: 0.35,
  lbPerKg: 2.2046,
  reserveModel: {
    baseUsdPerKg: 250,
    coefficientUsdPerPoint: 40,
    scorePivot: 87,
    scarcityUsdPerKg: 30,
    version: 1,
  },
  comps: [
    {
      auctionName: "Best of Panama",
      lotLabel: "Lot 12",
      variety: "Geisha",
      process: "Washed",
      cupScore: 94,
      priceUsdPerKg: 30204,
      resultYear: 2025,
    },
  ],
  commodityMinMarginPct: 0.1,
  reserveMinMarginPct: 0.2,
  settlementCurrency: "USD",
};

const COMMODITY: LotPricing = {
  row: {
    greenLotCode: "JC-902",
    variety: "Caturra",
    scaGrade: "Premium",
    cuppingScore: 82,
    regime: "commodity",
    cogsPerKgGreen: 3.2,
    atpKg: 2000,
    indicativeUnitPrice: 4.6,
    nearestComp: null,
  },
  cMarks: [
    { contractMonth: "DEC25", price: 1.8, asOf: "2026-06-20", source: "manual" },
    { contractMonth: "DEC25", price: 1.85, asOf: "2026-06-24", source: "manual" },
  ],
  latestContractMonth: "DEC25",
  latestCPrice: 1.85,
  defaultDifferentialUsdPerLb: 0.35,
  lbPerKg: 2.2046,
  reserveModel: null,
  comps: [],
  commodityMinMarginPct: 0.1,
  reserveMinMarginPct: 0.2,
  settlementCurrency: "USD",
};

const renderLot = (lot: string) =>
  ComposerPage({ params: Promise.resolve({ lot }) });

afterEach(cleanup);

describe("/pricing/[lot] quote composer (regime-aware, smoke)", () => {
  beforeEach(() => getLotPricingMock.mockReset());

  it("renders the reserve build-up story and NEVER a C-index anchor on a reserve lot", async () => {
    getLotPricingMock.mockResolvedValue(RESERVE);
    render(await renderLot("JC-901"));

    const story = screen.getByTestId("reserve-story");
    expect(story).toBeInTheDocument();
    expect(within(story).getByText(/build-up/i)).toBeInTheDocument();
    // The keystone in the UI: a reserve lot shows NO C story / contract month.
    expect(screen.queryByTestId("commodity-story")).not.toBeInTheDocument();
    expect(screen.queryByText(/Contract/i)).not.toBeInTheDocument();
    // The interactive control still mounts.
    expect(screen.getByTestId("quote-composer-stub")).toBeInTheDocument();
  });

  it("renders the C sparkline story with the contract month on a commodity lot", async () => {
    getLotPricingMock.mockResolvedValue(COMMODITY);
    render(await renderLot("JC-902"));

    const story = screen.getByTestId("commodity-story");
    expect(story).toBeInTheDocument();
    expect(within(story).getByText(/Contract DEC25/)).toBeInTheDocument();
    expect(screen.queryByTestId("reserve-story")).not.toBeInTheDocument();
    expect(screen.getByTestId("quote-composer-stub")).toBeInTheDocument();
  });

  it("404s when the lot has no price-book row (never a fabricated lot)", async () => {
    getLotPricingMock.mockResolvedValue(null);
    await expect(renderLot("JC-999")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
