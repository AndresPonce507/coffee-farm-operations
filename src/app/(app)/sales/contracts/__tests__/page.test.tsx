import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Buyer, ContractRow } from "@/app/(app)/sales/contracts/data";

// The contracts board is a Server Component reading the co-located b2b read port.
// Stub the port so the async page resolves with no Supabase client, and stub the
// create-contract client island so this test pins the page's job: render every
// contract as a status-correct glass card linking to its workspace.
const { getContractsMock, getBuyersMock } = vi.hoisted(() => ({
  getContractsMock: vi.fn(),
  getBuyersMock: vi.fn(),
}));
vi.mock("@/app/(app)/sales/contracts/data", () => ({
  getContracts: getContractsMock,
  getBuyers: getBuyersMock,
}));
vi.mock("@/app/(app)/sales/contracts/create-contract.client", () => ({
  CreateContract: () => <div data-testid="create-contract-stub" />,
}));

import ContractsPage from "@/app/(app)/sales/contracts/page";

const DRAFT: ContractRow = {
  contractId: 1,
  contractNo: "JC-K-0001",
  buyerId: 7,
  buyerName: "Tokyo Roasters",
  status: "draft",
  pricingBasis: "fixed",
  incoterm: "FOB",
  currency: "USD",
  totalKg: 250,
  fixedValue: 120000,
  fixationPct: 1,
};

const SIGNED: ContractRow = {
  contractId: 2,
  contractNo: "JC-K-0002",
  buyerId: 8,
  buyerName: "Zurich Importers",
  status: "signed",
  pricingBasis: "differential",
  incoterm: "CIF",
  currency: "USD",
  totalKg: 2000,
  fixedValue: 0,
  fixationPct: 0,
};

const BUYERS: Buyer[] = [
  {
    id: 7,
    name: "Tokyo Roasters",
    countryCode: "JP",
    buyerType: "roaster",
    defaultIncoterm: "FOB",
    defaultCurrency: "USD",
  },
];

beforeEach(() => {
  getContractsMock.mockResolvedValue([DRAFT, SIGNED]);
  getBuyersMock.mockResolvedValue(BUYERS);
});
afterEach(cleanup);

describe("/sales/contracts board (smoke)", () => {
  it("renders the page heading", async () => {
    render(await ContractsPage());
    expect(
      screen.getByRole("heading", { level: 1, name: "Contracts" }),
    ).toBeInTheDocument();
  });

  it("renders a card per contract with the buyer name and the status", async () => {
    render(await ContractsPage());
    const card = screen.getByTestId("contract-card-JC-K-0001");
    expect(within(card).getByText("JC-K-0001")).toBeInTheDocument();
    expect(within(card).getByText("Tokyo Roasters")).toBeInTheDocument();
    expect(within(card).getByText("Draft")).toBeInTheDocument();
  });

  it("links each card to its contract workspace", async () => {
    render(await ContractsPage());
    const link = screen.getByTestId("contract-card-JC-K-0002");
    expect(link).toHaveAttribute("href", "/sales/contracts/JC-K-0002");
  });

  it("shows an empty state when there are no contracts", async () => {
    getContractsMock.mockResolvedValue([]);
    render(await ContractsPage());
    expect(screen.getByText("No contracts yet")).toBeInTheDocument();
  });
});
