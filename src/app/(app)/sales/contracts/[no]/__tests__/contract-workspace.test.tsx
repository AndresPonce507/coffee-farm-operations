import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ContractDetail } from "@/app/(app)/sales/contracts/[no]/data";

// The workspace owns the interactive line editor + sign control. Stub the Server
// Actions + the router so this smoke test pins the island's job: render the lines, the
// draft-only add form, and gate the sign control behind ≥1 line.
const { addLineMock, signMock, refreshMock } = vi.hoisted(() => ({
  addLineMock: vi.fn(),
  signMock: vi.fn(),
  refreshMock: vi.fn(),
}));
vi.mock("@/app/(app)/sales/contracts/[no]/actions", () => ({
  addContractLineAction: addLineMock,
  signContractAction: signMock,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { ContractWorkspace } from "@/app/(app)/sales/contracts/[no]/contract-workspace.client";

function detail(overrides: Partial<ContractDetail> = {}): ContractDetail {
  return {
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
    availableLots: [{ greenLotCode: "JC-204", regime: "commodity", atpKg: 50 }],
    ...overrides,
  };
}

beforeEach(() => {
  addLineMock.mockReset();
  signMock.mockReset();
  refreshMock.mockReset();
});
afterEach(cleanup);

describe("ContractWorkspace (smoke)", () => {
  it("renders each existing contract line", () => {
    render(<ContractWorkspace detail={detail()} />);
    const line = screen.getByTestId("contract-line-11");
    expect(line).toBeInTheDocument();
    expect(screen.getByText("JC-204")).toBeInTheDocument();
  });

  it("shows the add-line form and a sign control on a draft contract with lines", () => {
    render(<ContractWorkspace detail={detail()} />);
    expect(screen.getByText("Add line")).toBeInTheDocument();
    expect(screen.getByText("Sign contract")).toBeInTheDocument();
  });

  it("renders an empty-lines hint when a draft has no lines yet", () => {
    render(<ContractWorkspace detail={detail({ lines: [], totalKg: 0 })} />);
    expect(
      screen.getByText("No lines yet. Add the lots this buyer is taking."),
    ).toBeInTheDocument();
  });

  it("hides the add-line form once the contract is signed", () => {
    render(<ContractWorkspace detail={detail({ status: "signed" })} />);
    expect(screen.queryByText("Add line")).not.toBeInTheDocument();
  });
});
