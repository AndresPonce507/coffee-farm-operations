import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OfferRow } from "@/app/(app)/sales/offers/data";

// The offer board is a Server Component reading the co-located b2b read port
// (it binds to the authoritative v_offer_board surface). Stub the port so the async
// page resolves with no Supabase client, and stub the publish client island so this
// test pins the page's ONE job: render every live offer as a regime-correct card and
// NEVER cross the streams (a Reserve Geisha shows no "C" anchor — the keystone).
const { getOfferBoardMock, getOfferableLotsMock } = vi.hoisted(() => ({
  getOfferBoardMock: vi.fn(),
  getOfferableLotsMock: vi.fn(),
}));
vi.mock("@/app/(app)/sales/offers/data", () => ({
  getOfferBoard: getOfferBoardMock,
  getOfferableLots: getOfferableLotsMock,
}));
vi.mock("@/app/(app)/sales/offers/publish-offer.client", () => ({
  PublishOffer: () => <div data-testid="publish-offer-stub" />,
}));

import OffersPage from "@/app/(app)/sales/offers/page";

const RESERVE: OfferRow = {
  offerId: 1,
  greenLotCode: "JC-204",
  regime: "reserve",
  askingPrice: 480,
  offeredKg: 250,
  currency: "USD",
  scaGrade: "Presidential",
  cuppingScore: 91,
  atpKg: 50,
  variety: "Geisha",
};

const COMMODITY: OfferRow = {
  offerId: 2,
  greenLotCode: "JC-310",
  regime: "commodity",
  askingPrice: 4.6,
  offeredKg: 2000,
  currency: "USD",
  scaGrade: "Premium",
  cuppingScore: 82,
  atpKg: 1500,
  variety: "Caturra",
};

beforeEach(() => {
  getOfferBoardMock.mockResolvedValue([RESERVE, COMMODITY]);
  getOfferableLotsMock.mockResolvedValue([]);
});
afterEach(cleanup);

describe("/sales/offers board (smoke)", () => {
  it("renders the page heading", async () => {
    render(await OffersPage());
    expect(
      screen.getByRole("heading", { level: 1, name: "Offers" }),
    ).toBeInTheDocument();
  });

  it("renders a forest Reserve badge on a reserve offer", async () => {
    render(await OffersPage());
    const card = screen.getByTestId("offer-card-1");
    expect(within(card).getByText(/Reserve · Geisha/)).toBeInTheDocument();
  });

  it("NEVER shows a C-index anchor on a reserve offer (the keystone)", async () => {
    render(await OffersPage());
    const card = screen.getByTestId("offer-card-1");
    expect(within(card).queryByText(/Commodity/)).not.toBeInTheDocument();
    expect(within(card).queryByText(/C \+ diff/)).not.toBeInTheDocument();
    expect(within(card).queryByText(/Contract/i)).not.toBeInTheDocument();
  });

  it("renders a neutral Commodity badge on a commodity offer", async () => {
    render(await OffersPage());
    const card = screen.getByTestId("offer-card-2");
    expect(within(card).getByText(/Commodity · C \+ diff/)).toBeInTheDocument();
  });

  it("shows an empty state when there are no offers", async () => {
    getOfferBoardMock.mockResolvedValue([]);
    render(await OffersPage());
    expect(screen.getByText("No offers published yet")).toBeInTheDocument();
  });
});
