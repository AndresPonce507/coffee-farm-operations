import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BuildableContract, ShipmentRow } from "@/app/(app)/sales/shipments/data";

// The board is a Server Component reading the co-located port. Stub both getters and
// the build-form island so this test pins the page's job: render every shipment as a
// card with its status and live-doc count, and surface the empty state.
const { getShipmentsMock, getBuildableContractsMock } = vi.hoisted(() => ({
  getShipmentsMock: vi.fn(),
  getBuildableContractsMock: vi.fn(),
}));
vi.mock("@/app/(app)/sales/shipments/data", async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return {
    ...actual,
    getShipments: getShipmentsMock,
    getBuildableContracts: getBuildableContractsMock,
  };
});
vi.mock("@/app/(app)/sales/shipments/build-shipment.client", () => ({
  BuildShipment: () => <div data-testid="build-shipment-stub" />,
}));

import ShipmentsPage from "@/app/(app)/sales/shipments/page";

const SHIP: ShipmentRow = {
  id: 1,
  shipmentNo: "JC-S-0001",
  contractId: 7,
  contractNo: "JC-K-0007",
  buyerName: "Tokyo Roasters",
  countryCode: "JP",
  incoterm: "FOB",
  portOfLoading: "Balboa, PA",
  bagWeightKg: 30,
  status: "building",
  totalBags: 8,
  totalNetKg: 240,
  lineCount: 1,
  issuedCount: 2,
  departedAt: null,
  createdAt: "2026-06-20T00:00:00Z",
};

const CONTRACT: BuildableContract = {
  contractId: 7,
  contractNo: "JC-K-0007",
  buyerName: "Tokyo Roasters",
  incoterm: "FOB",
  status: "signed",
};

beforeEach(() => {
  getShipmentsMock.mockResolvedValue([SHIP]);
  getBuildableContractsMock.mockResolvedValue([CONTRACT]);
});
afterEach(cleanup);

describe("/sales/shipments board (smoke)", () => {
  it("renders the page heading", async () => {
    render(await ShipmentsPage());
    expect(
      screen.getByRole("heading", { level: 1, name: "Export shipments" }),
    ).toBeInTheDocument();
  });

  it("renders a card per shipment with its number, consignee and live-doc count", async () => {
    render(await ShipmentsPage());
    const card = screen.getByTestId("shipment-card-JC-S-0001");
    expect(within(card).getByText(/JC-S-0001/)).toBeInTheDocument();
    expect(within(card).getByText(/Tokyo Roasters/)).toBeInTheDocument();
    expect(within(card).getByText(/2 of 5/)).toBeInTheDocument();
  });

  it("links each card to its document-pack detail route", async () => {
    render(await ShipmentsPage());
    const card = screen.getByTestId("shipment-card-JC-S-0001");
    expect(card).toHaveAttribute("href", "/sales/shipments/JC-S-0001");
  });

  it("shows an empty state when there are no shipments", async () => {
    getShipmentsMock.mockResolvedValue([]);
    render(await ShipmentsPage());
    expect(screen.getByText("No shipments yet")).toBeInTheDocument();
  });
});
