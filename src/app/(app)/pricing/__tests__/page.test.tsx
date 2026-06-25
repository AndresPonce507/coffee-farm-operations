import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PriceBookRow } from "@/app/(app)/pricing/data";

// The board is a Server Component that reads the co-located price-book port
// (it binds to the authoritative v_lot_price_book + auction_comps surface). Stub
// the port so the async page resolves without a Supabase client, and so this test
// pins the page's ONE job: render every green lot as a regime-correct glass card.
const { getPriceBookMock } = vi.hoisted(() => ({ getPriceBookMock: vi.fn() }));
vi.mock("@/app/(app)/pricing/data", () => ({ getPriceBook: getPriceBookMock }));

import PricingPage from "@/app/(app)/pricing/page";

const RESERVE: PriceBookRow = {
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
};

const COMMODITY: PriceBookRow = {
  greenLotCode: "JC-902",
  variety: "Caturra",
  scaGrade: "Premium",
  cuppingScore: 82,
  regime: "commodity",
  cogsPerKgGreen: 3.2,
  atpKg: 2000,
  indicativeUnitPrice: 4.6,
  nearestComp: null,
};

beforeEach(() => getPriceBookMock.mockResolvedValue([RESERVE, COMMODITY]));
afterEach(cleanup);

describe("/pricing price-book board (smoke)", () => {
  it("renders the page heading", async () => {
    render(await PricingPage());
    expect(
      screen.getByRole("heading", { level: 1, name: "Pricing" }),
    ).toBeInTheDocument();
  });

  it("renders a forest Reserve badge on a reserve lot and surfaces its auction comp as the price story", async () => {
    render(await PricingPage());

    const card = screen.getByTestId("price-card-JC-901");
    expect(within(card).getByText(/Reserve · Geisha/)).toBeInTheDocument();
    expect(within(card).getByText(/Best of Panama/)).toBeInTheDocument();
  });

  it("NEVER shows a C-index anchor on a reserve lot (the keystone: a Geisha is not a commodity)", async () => {
    render(await PricingPage());

    const card = screen.getByTestId("price-card-JC-901");
    expect(within(card).queryByText(/Commodity/)).not.toBeInTheDocument();
    expect(within(card).queryByText(/C \+ diff/)).not.toBeInTheDocument();
    expect(within(card).queryByText(/Contract/i)).not.toBeInTheDocument();
  });

  it("renders a neutral Commodity badge with the C-plus-differential story on a commodity lot", async () => {
    render(await PricingPage());

    const card = screen.getByTestId("price-card-JC-902");
    expect(within(card).getByText(/Commodity · C \+ diff/)).toBeInTheDocument();
    expect(within(card).queryByText(/Best of Panama/)).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no green lots to price", async () => {
    getPriceBookMock.mockResolvedValue([]);
    render(await PricingPage());
    expect(screen.getByText("No green lots to price yet")).toBeInTheDocument();
  });
});
