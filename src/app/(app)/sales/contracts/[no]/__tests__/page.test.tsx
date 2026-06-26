import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ContractDetail } from "@/app/(app)/sales/contracts/[no]/data";

// The workspace is a Server Component reading the co-located detail port. Stub the
// port + the interactive client island so this test pins the server page's job:
// render the contract header + status spine, and 404 on an unknown contract_no.
const { getContractDetailMock } = vi.hoisted(() => ({
  getContractDetailMock: vi.fn(),
}));
vi.mock("@/app/(app)/sales/contracts/[no]/data", () => ({
  getContractDetail: getContractDetailMock,
}));
vi.mock("@/app/(app)/sales/contracts/[no]/contract-workspace.client", () => ({
  ContractWorkspace: () => <div data-testid="contract-workspace-stub" />,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import WorkspacePage from "@/app/(app)/sales/contracts/[no]/page";

const DETAIL: ContractDetail = {
  contractId: 1,
  contractNo: "JC-K-0001",
  buyerId: 7,
  buyerName: "Tokyo Roasters",
  buyerCountry: "JP",
  status: "draft",
  pricingBasis: "differential",
  incoterm: "FOB",
  namedPlace: "Balboa, PA",
  standard: "GCA",
  currency: "USD",
  signedAt: null,
  totalKg: 250,
  fixedValue: 0,
  fixationPct: 0,
  lines: [
    {
      id: 11,
      greenLotCode: "JC-204",
      kg: 250,
      unitPrice: null,
      differentialCents: 35,
      iceCMonth: "DEC25",
      reservationId: 99,
      fixedAt: null,
    },
  ],
  availableLots: [
    { greenLotCode: "JC-204", regime: "commodity", atpKg: 50 },
  ],
};

const renderNo = (no: string) =>
  WorkspacePage({ params: Promise.resolve({ no }) });

beforeEach(() => getContractDetailMock.mockReset());
afterEach(cleanup);

describe("/sales/contracts/[no] workspace (smoke)", () => {
  it("renders the contract number heading and buyer", async () => {
    getContractDetailMock.mockResolvedValue(DETAIL);
    render(await renderNo("JC-K-0001"));
    expect(
      screen.getByRole("heading", { level: 1, name: "JC-K-0001" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Tokyo Roasters/)).toBeInTheDocument();
  });

  it("renders the status spine with the current status marked", async () => {
    getContractDetailMock.mockResolvedValue(DETAIL);
    render(await renderNo("JC-K-0001"));
    const status = screen.getByTestId("contract-status");
    expect(within(status).getByText("Draft")).toBeInTheDocument();
  });

  it("mounts the interactive workspace island", async () => {
    getContractDetailMock.mockResolvedValue(DETAIL);
    render(await renderNo("JC-K-0001"));
    expect(screen.getByTestId("contract-workspace-stub")).toBeInTheDocument();
  });

  it("404s when the contract is unknown (never a fabricated contract)", async () => {
    getContractDetailMock.mockResolvedValue(null);
    await expect(renderNo("JC-K-9999")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
