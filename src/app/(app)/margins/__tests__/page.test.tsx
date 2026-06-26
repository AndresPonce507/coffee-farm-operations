import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FxRate, LotMargin } from "@/app/(app)/margins/data";

// The board is a Server Component reading the co-located accounting port (it binds
// to the authoritative v_lot_margin + fx_rate surface). Stub the port so the async
// page resolves without a Supabase client, and stub the write island so the page
// pins its ONE job: render every lot's REALIZED per-kg margin, NEVER fabricating a
// number for a lot whose cost is not yet on the books.
const { getLotMarginsMock, getFxRatesMock } = vi.hoisted(() => ({
  getLotMarginsMock: vi.fn(),
  getFxRatesMock: vi.fn(),
}));
vi.mock("@/app/(app)/margins/data", () => ({
  getLotMargins: getLotMarginsMock,
  getFxRates: getFxRatesMock,
}));
vi.mock("@/app/(app)/margins/fx-rate-form.client", () => ({
  RecordFxRateButton: () => <div data-testid="record-fx-stub" />,
}));

import MarginsPage from "@/app/(app)/margins/page";

const POSITIVE: LotMargin = {
  greenLotCode: "JC-901",
  variety: "Geisha",
  revenueUsd: 24000,
  greenKg: 50,
  totalCost: 7000,
  costPerKgGreen: 140,
  revenuePerKgGreen: 480,
  marginPerKgGreen: 340,
  marginUsd: 17000,
};

const BELOW_COST: LotMargin = {
  greenLotCode: "JC-902",
  variety: "Caturra",
  revenueUsd: 300,
  greenKg: 100,
  totalCost: 460,
  costPerKgGreen: 4.6,
  revenuePerKgGreen: 3,
  marginPerKgGreen: -1.6,
  marginUsd: -160,
};

// Revenue is booked but the lot has no cost on the books yet — its margin MUST stay
// blank (NULL ⇒ flagged, never a fabricated floor — rail §5 / the slice keystone).
const COST_PENDING: LotMargin = {
  greenLotCode: "JC-903",
  variety: null,
  revenueUsd: 1200,
  greenKg: null,
  totalCost: null,
  costPerKgGreen: null,
  revenuePerKgGreen: null,
  marginPerKgGreen: null,
  marginUsd: null,
};

const RATE: FxRate = {
  id: 1,
  asOfDate: "2026-06-20",
  base: "EUR",
  quote: "USD",
  rate: 1.08,
  source: "ecb",
};

beforeEach(() => {
  getLotMarginsMock.mockResolvedValue([POSITIVE, BELOW_COST, COST_PENDING]);
  getFxRatesMock.mockResolvedValue([RATE]);
});
afterEach(cleanup);

describe("/margins board (smoke)", () => {
  it("renders the page heading", async () => {
    render(await MarginsPage());
    expect(
      screen.getByRole("heading", { level: 1, name: "Margin & FX" }),
    ).toBeInTheDocument();
  });

  it("renders the realized per-kg margin and a Margin badge on a profitable lot", async () => {
    render(await MarginsPage());
    const card = screen.getByTestId("margin-card-JC-901");
    expect(within(card).getByText("Margin")).toBeInTheDocument();
    expect(within(card).getByText(/\$340/)).toBeInTheDocument();
    expect(within(card).queryByText("Cost pending")).not.toBeInTheDocument();
  });

  it("flags a lot that sold below its true cost with a Below cost badge", async () => {
    render(await MarginsPage());
    const card = screen.getByTestId("margin-card-JC-902");
    expect(within(card).getByText("Below cost")).toBeInTheDocument();
  });

  it("NEVER fabricates a margin for a lot whose cost is not booked (the keystone)", async () => {
    render(await MarginsPage());
    const card = screen.getByTestId("margin-card-JC-903");
    expect(within(card).getByText("Cost pending")).toBeInTheDocument();
    expect(within(card).getByText("Awaiting cost")).toBeInTheDocument();
    // No dollar figure anywhere on a fully cost-pending card — no fabricated number.
    expect(within(card).queryByText(/\$\d/)).not.toBeInTheDocument();
  });

  it("surfaces the canonical FX rate book", async () => {
    render(await MarginsPage());
    const book = screen.getByTestId("fx-rate-book");
    expect(within(book).getByText("EUR → USD")).toBeInTheDocument();
  });

  it("shows an empty state when no lot has realized margin yet", async () => {
    getLotMarginsMock.mockResolvedValue([]);
    render(await MarginsPage());
    expect(screen.getByText("No realized margin yet")).toBeInTheDocument();
  });
});
