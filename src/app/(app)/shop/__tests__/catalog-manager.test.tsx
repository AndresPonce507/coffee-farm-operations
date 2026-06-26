import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CatalogProduct, LotPick } from "@/app/(app)/shop/data";

// The island drives the three Server Actions and refreshes the route on success.
// Stub the actions so the dialogs render + submit with no Supabase round-trip, and
// stub the router so router.refresh() is a no-op. next-intl is mocked globally in
// setup.ts (real EN copy), so the labels come back as the strings the owner sees.
const { createProductMock, createSkuMock, recordMovementMock } = vi.hoisted(() => ({
  createProductMock: vi.fn(),
  createSkuMock: vi.fn(),
  recordMovementMock: vi.fn(),
}));
vi.mock("@/app/(app)/shop/actions", () => ({
  createProductAction: createProductMock,
  createSkuAction: createSkuMock,
  recordFgMovementAction: recordMovementMock,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { CatalogManager } from "@/app/(app)/shop/catalog-manager.client";

const products: CatalogProduct[] = [
  {
    id: 10,
    slug: "bop-geisha",
    name: "Best of Panama Geisha",
    variety: "Geisha",
    process: "Washed",
    tastingNotes: null,
    isActive: true,
  },
];

const lots: LotPick[] = [
  {
    greenLotCode: "JC-901",
    scaGrade: "Presidential",
    location: "Warehouse A",
    currentKg: 50,
    reservedKg: 10,
    shippedKg: 8,
    atpKg: 32,
  },
];

const skus = [{ skuId: 2, label: "Volcan House · ground/340g · JC-902", availableUnits: 120 }];

beforeEach(() => {
  createProductMock.mockReset();
  createSkuMock.mockReset();
  recordMovementMock.mockReset();
});
afterEach(cleanup);

function renderManager() {
  return render(<CatalogManager products={products} lots={lots} skus={skus} />);
}

describe("CatalogManager (client island)", () => {
  it("exposes the three catalog write affordances", () => {
    renderManager();
    expect(screen.getByRole("button", { name: "New product" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New SKU" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record movement" })).toBeInTheDocument();
  });

  it("creates a product through the dialog", async () => {
    createProductMock.mockResolvedValue({ ok: true, productId: 12 });
    renderManager();
    fireEvent.click(screen.getByRole("button", { name: "New product" }));
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "house" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Volcan House" } });
    fireEvent.click(screen.getByRole("button", { name: "Create product" }));
    await screen.findByText("Product created.");
    expect(createProductMock).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "house", name: "Volcan House" }),
    );
  });

  it("shows the lot picker with its live ATP and mints a lot-linked SKU", async () => {
    createSkuMock.mockResolvedValue({ ok: true, skuId: 99 });
    renderManager();
    fireEvent.click(screen.getByRole("button", { name: "New SKU" }));
    // The lot picker surfaces ATP straight off green_lots_atp (the spec requirement).
    expect(screen.getByText(/JC-901/)).toBeInTheDocument();
    expect(screen.getByText(/32 kg available/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Price (USD)"), { target: { value: "48" } });
    fireEvent.click(screen.getByRole("button", { name: "Create SKU" }));
    await screen.findByText("SKU created.");
    expect(createSkuMock).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: 10,
        greenLotCode: "JC-901",
        packFormat: "whole-bean",
        bagSize: "250g",
        priceUsdCents: 4800,
      }),
    );
  });

  it("records a sale as a NEGATIVE finished-goods movement (reason drives the sign)", async () => {
    recordMovementMock.mockResolvedValue({ ok: true, ledgerId: 5 });
    renderManager();
    fireEvent.click(screen.getByRole("button", { name: "Record movement" }));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "sale" } });
    fireEvent.change(screen.getByLabelText("Units"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save movement" }));
    await screen.findByText("Movement recorded.");
    expect(recordMovementMock).toHaveBeenCalledWith(
      expect.objectContaining({ skuId: 2, qtyUnits: -3, reason: "sale" }),
    );
  });

  it("surfaces a server error without claiming success", async () => {
    createProductMock.mockResolvedValue({ ok: false, error: "That was already saved." });
    renderManager();
    fireEvent.click(screen.getByRole("button", { name: "New product" }));
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "dup" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Dup" } });
    fireEvent.click(screen.getByRole("button", { name: "Create product" }));
    expect(await screen.findByText("That was already saved.")).toBeInTheDocument();
    expect(screen.queryByText("Product created.")).not.toBeInTheDocument();
  });
});
