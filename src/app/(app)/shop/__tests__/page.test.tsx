import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CatalogSku } from "@/app/(app)/shop/data";

// The /shop board is a Server Component reading the co-located storefront port
// (finished_goods_atp + product_skus gtin + products variety). Stub the port so the
// async page resolves with no Supabase client, and stub the client island (it pulls
// useRouter, which has no app-router context under jsdom) to a sync marker — this test
// pins the page's ONE job: render every SKU as a lot-traceable glass card.
const { getCatalogMock, getProductsMock, getLotPicksMock } = vi.hoisted(() => ({
  getCatalogMock: vi.fn(),
  getProductsMock: vi.fn(),
  getLotPicksMock: vi.fn(),
}));
vi.mock("@/app/(app)/shop/data", () => ({
  getCatalog: getCatalogMock,
  getProducts: getProductsMock,
  getLotPicks: getLotPicksMock,
}));
vi.mock("@/app/(app)/shop/catalog-manager.client", () => ({
  CatalogManager: () => <div data-testid="catalog-manager-stub" />,
}));

import ShopPage from "@/app/(app)/shop/page";

const RESERVE: CatalogSku = {
  skuId: 1,
  productId: 10,
  productSlug: "bop-geisha",
  productName: "Best of Panama Geisha",
  variety: "Geisha",
  greenLotCode: "JC-901",
  roastSkuId: 5,
  packFormat: "whole-bean",
  bagSize: "250g",
  priceUsdCents: 4800,
  gtin: "0123456789012",
  isReserveClub: true,
  isActive: true,
  onHandUnits: 40,
  allocatedUnits: 8,
  availableUnits: 32,
};

const HOUSE: CatalogSku = {
  skuId: 2,
  productId: 11,
  productSlug: "volcan-house",
  productName: "Volcan House",
  variety: "Caturra",
  greenLotCode: "JC-902",
  roastSkuId: null,
  packFormat: "ground",
  bagSize: "340g",
  priceUsdCents: 1600,
  gtin: null,
  isReserveClub: false,
  isActive: true,
  onHandUnits: 120,
  allocatedUnits: 0,
  availableUnits: 120,
};

beforeEach(() => {
  getCatalogMock.mockResolvedValue([RESERVE, HOUSE]);
  getProductsMock.mockResolvedValue([]);
  getLotPicksMock.mockResolvedValue([]);
});
afterEach(cleanup);

describe("/shop catalog board (smoke)", () => {
  it("renders the page heading", async () => {
    render(await ShopPage());
    expect(
      screen.getByRole("heading", { level: 1, name: "Storefront" }),
    ).toBeInTheDocument();
  });

  it("renders each SKU with its green-lot traceability link (every bag → its lot)", async () => {
    render(await ShopPage());
    const card = screen.getByTestId("sku-card-1");
    expect(within(card).getByText("Best of Panama Geisha")).toBeInTheDocument();
    expect(within(card).getByText(/JC-901/)).toBeInTheDocument();
  });

  it("flags a Reserve Club bag, and a house bag carries no Reserve Club badge", async () => {
    render(await ShopPage());
    expect(
      within(screen.getByTestId("sku-card-1")).getByText("Reserve Club"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("sku-card-2")).queryByText("Reserve Club"),
    ).not.toBeInTheDocument();
  });

  it("surfaces available finished-goods units per SKU", async () => {
    render(await ShopPage());
    expect(screen.getByTestId("sku-available-2")).toHaveTextContent("120");
    expect(screen.getByTestId("sku-available-1")).toHaveTextContent("32");
  });

  it("shows an empty state when the catalog has no SKUs", async () => {
    getCatalogMock.mockResolvedValue([]);
    render(await ShopPage());
    expect(screen.getByText("No SKUs in the catalog yet")).toBeInTheDocument();
  });
});
