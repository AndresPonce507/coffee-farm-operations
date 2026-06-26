import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuctionSummary } from "@/app/(app)/sales/auctions/data";

// The board is a Server Component reading the co-located auctions port. Stub the
// port so the async page resolves without Supabase, and stub the create-auction
// client island so this test pins the board's ONE job: render every auction as a
// glass card with its status, entry count, and (when cleared) the multiplier over
// the commodity C. next-intl/server is mocked globally (resolves the EN copy).
const { getAuctionsMock } = vi.hoisted(() => ({ getAuctionsMock: vi.fn() }));
vi.mock("@/app/(app)/sales/auctions/data", () => ({ getAuctions: getAuctionsMock }));
vi.mock("@/app/(app)/sales/auctions/new-auction.client", () => ({
  NewAuctionButton: () => <div data-testid="new-auction-stub" />,
}));

import AuctionsPage from "@/app/(app)/sales/auctions/page";

const CLEARED: AuctionSummary = {
  id: 1,
  platform: "best_of_panama",
  name: "Best of Panama 2026",
  status: "sold",
  entryDeadline: null,
  scoringDeadline: null,
  entryCount: 2,
  soldCount: 1,
  bestClearingPriceUsdPerKg: 510,
  bestMultiplier: 101,
};

const OPEN: AuctionSummary = {
  id: 2,
  platform: "cup_of_excellence",
  name: "Cup of Excellence 2026",
  status: "entered",
  entryDeadline: "2026-08-01",
  scoringDeadline: "2026-08-15",
  entryCount: 0,
  soldCount: 0,
  bestClearingPriceUsdPerKg: null,
  bestMultiplier: null,
};

beforeEach(() => getAuctionsMock.mockResolvedValue([CLEARED, OPEN]));
afterEach(cleanup);

describe("/sales/auctions board (smoke)", () => {
  it("renders the page heading", async () => {
    render(await AuctionsPage());
    expect(
      screen.getByRole("heading", { level: 1, name: "Auctions" }),
    ).toBeInTheDocument();
  });

  it("renders a card per auction with its name and platform label", async () => {
    render(await AuctionsPage());
    const card = screen.getByTestId("auction-card-1");
    expect(within(card).getByText("Best of Panama 2026")).toBeInTheDocument();
    expect(within(card).getByText("Best of Panama")).toBeInTheDocument();
  });

  it("shows the clearing price AND the multiplier over the commodity C on a cleared auction", async () => {
    render(await AuctionsPage());
    const card = screen.getByTestId("auction-card-1");
    expect(within(card).getByText(/101× the C/)).toBeInTheDocument();
    expect(within(card).getByText(/\$510/)).toBeInTheDocument();
  });

  it("does not invent a multiplier for an auction with no results", async () => {
    render(await AuctionsPage());
    const card = screen.getByTestId("auction-card-2");
    expect(within(card).queryByText(/× the C/)).not.toBeInTheDocument();
    expect(within(card).getByText(/No lots entered yet/)).toBeInTheDocument();
  });

  it("shows an empty state when there are no auctions", async () => {
    getAuctionsMock.mockResolvedValue([]);
    render(await AuctionsPage());
    expect(screen.getByText("No auctions yet")).toBeInTheDocument();
  });
});
