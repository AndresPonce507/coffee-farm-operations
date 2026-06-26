import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuctionDetail } from "@/app/(app)/sales/auctions/data";

// The detail page is a Server Component. Stub the port + the two interactive
// islands (enter-lot, score-panel) + notFound so this test pins the page's job:
// render the auction header and each entry's result card (farm cup vs jury, the
// clearing price, and the multiplier over the commodity baseline — the BoP premium
// made visible).
const { getAuctionDetailMock } = vi.hoisted(() => ({
  getAuctionDetailMock: vi.fn(),
}));
vi.mock("@/app/(app)/sales/auctions/data", () => ({
  getAuctionDetail: getAuctionDetailMock,
}));
vi.mock("@/app/(app)/sales/auctions/[id]/enter-lot.client", () => ({
  EnterLot: () => <div data-testid="enter-lot-stub" />,
}));
vi.mock("@/app/(app)/sales/auctions/[id]/score-panel.client", () => ({
  ScorePanel: () => <div data-testid="score-panel-stub" />,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import AuctionDetailPage from "@/app/(app)/sales/auctions/[id]/page";

const SOLD_ENTRY = {
  entryId: 10,
  greenLotCode: "JC-204",
  kg: 30,
  farmCuppingScore: 91,
  juryScore: 91.5,
  panelFinalScore: 91.4,
  jurorCount: 5,
  markCount: 25,
  clearingPriceUsdPerKg: 510,
  winningBidder: "Tokyo Roasters",
  resultYear: 2026,
  commodityBaselineUsdPerKg: 5.1,
  priceMultiplier: 100,
  sold: true,
};

const OPEN_ENTRY = {
  entryId: 11,
  greenLotCode: "JC-205",
  kg: 40,
  farmCuppingScore: 88,
  juryScore: null,
  panelFinalScore: null,
  jurorCount: 0,
  markCount: 0,
  clearingPriceUsdPerKg: null,
  winningBidder: null,
  resultYear: null,
  commodityBaselineUsdPerKg: 5.1,
  priceMultiplier: null,
  sold: false,
};

const DETAIL: AuctionDetail = {
  id: 1,
  platform: "best_of_panama",
  name: "Best of Panama 2026",
  status: "scored",
  entryDeadline: "2026-08-01",
  scoringDeadline: "2026-08-15",
  entries: [SOLD_ENTRY, OPEN_ENTRY],
  availableLots: [
    { greenLotCode: "JC-300", variety: "Geisha", cuppingScore: 90, scaGrade: "Presidential", atpKg: 120 },
  ],
};

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => getAuctionDetailMock.mockResolvedValue(DETAIL));
afterEach(cleanup);

describe("/sales/auctions/[id] detail (smoke)", () => {
  it("renders the auction name as the page heading", async () => {
    render(await AuctionDetailPage(makeParams("1")));
    expect(
      screen.getByRole("heading", { level: 1, name: /Best of Panama 2026/ }),
    ).toBeInTheDocument();
  });

  it("shows the clearing price AND the multiplier over the commodity baseline on a cleared entry", async () => {
    render(await AuctionDetailPage(makeParams("1")));
    const card = screen.getByTestId("auction-entry-10");
    expect(within(card).getByText(/\$510/)).toBeInTheDocument();
    expect(within(card).getByText(/100× the commodity C/)).toBeInTheDocument();
  });

  it("reconciles the farm cup against the jury score on the entry card", async () => {
    render(await AuctionDetailPage(makeParams("1")));
    const card = screen.getByTestId("auction-entry-10");
    // farm's own grade INPUT and the auction panel's verdict are both visible
    expect(within(card).getByText(/Farm cup/)).toBeInTheDocument();
    expect(within(card).getByText(/Jury score/)).toBeInTheDocument();
  });

  it("renders the enter-lot island and a score-panel island per entry", async () => {
    render(await AuctionDetailPage(makeParams("1")));
    expect(screen.getByTestId("enter-lot-stub")).toBeInTheDocument();
    expect(screen.getAllByTestId("score-panel-stub")).toHaveLength(2);
  });

  it("calls notFound for an unknown auction", async () => {
    getAuctionDetailMock.mockResolvedValue(null);
    await expect(AuctionDetailPage(makeParams("999"))).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });

  it("shows the no-entries note when the round is empty", async () => {
    getAuctionDetailMock.mockResolvedValue({ ...DETAIL, entries: [] });
    render(await AuctionDetailPage(makeParams("1")));
    expect(
      screen.getByText(/No lots entered yet/),
    ).toBeInTheDocument();
  });
});
