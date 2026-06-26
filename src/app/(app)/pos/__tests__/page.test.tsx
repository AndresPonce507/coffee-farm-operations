import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  PosSaleRow,
  PosTerminal,
  SellableSku,
} from "@/app/(app)/pos/data";

// The POS board is a Server Component reading the co-located read port (it binds to the
// authoritative pos_terminals / finished_goods_atp / v_pos_sales_book surfaces the
// P3-S14 migration shipped). Stub the port so the async page resolves with no Supabase
// client, and stub the interactive register island so this test pins the page's ONE job:
// render the summary strip + the recent-sales history, with correct empty states.
const { getTerminalsMock, getSkusMock, getSalesMock } = vi.hoisted(() => ({
  getTerminalsMock: vi.fn(),
  getSkusMock: vi.fn(),
  getSalesMock: vi.fn(),
}));
vi.mock("@/app/(app)/pos/data", () => ({
  getPosTerminals: getTerminalsMock,
  getSellableSkus: getSkusMock,
  getPosSalesBook: getSalesMock,
}));
vi.mock("@/app/(app)/pos/pos-register.client", () => ({
  PosRegister: () => <div data-testid="pos-register-stub" />,
}));

import PosPage from "@/app/(app)/pos/page";

const TERMINAL: PosTerminal = {
  id: 1,
  code: "FARM-STORE",
  name: "Janson Farm Store",
  location: "Volcán",
  isActive: true,
};

const SKU: SellableSku = {
  skuId: 10,
  productName: "Geisha Natural",
  productSlug: "geisha-natural",
  greenLotCode: "JC-204",
  packFormat: "whole-bean",
  bagSize: "250g",
  priceUsdCents: 1800,
  isReserveClub: true,
  availableUnits: 12,
};

const SALE: PosSaleRow = {
  id: 5,
  saleNo: "POS-0007",
  terminalCode: "FARM-STORE",
  terminalName: "Janson Farm Store",
  status: "pending",
  currency: "USD",
  subtotalCents: 3600,
  dgiTaxCents: 252,
  totalCents: 3852,
  customerName: "Walk-in",
  lineCount: 2,
  dgiCufe: null,
  createdAt: "2026-06-25T15:00:00Z",
};

beforeEach(() => {
  getTerminalsMock.mockResolvedValue([TERMINAL]);
  getSkusMock.mockResolvedValue([SKU]);
  getSalesMock.mockResolvedValue([SALE]);
});
afterEach(cleanup);

describe("/pos board (smoke)", () => {
  it("renders the page heading", async () => {
    render(await PosPage());
    expect(
      screen.getByRole("heading", { level: 1, name: "Point of sale" }),
    ).toBeInTheDocument();
  });

  it("mounts the interactive register island", async () => {
    render(await PosPage());
    expect(screen.getByTestId("pos-register-stub")).toBeInTheDocument();
  });

  it("renders a recent-sale card with its folio, total and non-fiscal recibo badge", async () => {
    render(await PosPage());
    const card = screen.getByTestId("pos-sale-POS-0007");
    expect(within(card).getByText("POS-0007")).toBeInTheDocument();
    expect(within(card).getByText("$38.52")).toBeInTheDocument();
    // dgi_cufe is NULL on the $0 path → the non-fiscal recibo badge, never a fake CUFE.
    expect(within(card).getByText("Recibo (non-fiscal)")).toBeInTheDocument();
  });

  it("shows the no-terminals empty state and hides the register when no till exists", async () => {
    getTerminalsMock.mockResolvedValue([]);
    render(await PosPage());
    expect(screen.getByText("No register set up yet")).toBeInTheDocument();
    expect(screen.queryByTestId("pos-register-stub")).not.toBeInTheDocument();
  });

  it("shows the no-sales empty state when the day's book is empty", async () => {
    getSalesMock.mockResolvedValue([]);
    render(await PosPage());
    expect(screen.getByText("No sales yet today")).toBeInTheDocument();
  });
});
