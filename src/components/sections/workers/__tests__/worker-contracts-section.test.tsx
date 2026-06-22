import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WorkerContractsSection } from "@/components/sections/workers/worker-contracts-section";
import type { PorObraContract } from "@/lib/db/people";

afterEach(cleanup);

const contracts: PorObraContract[] = [
  {
    id: 2,
    workerId: "w-001",
    taskKind: "Recolección",
    rateBasis: "lata",
    rateUsd: 3.5,
    effectiveFrom: "2026-05-01",
    effectiveTo: null,
    signedAt: "2026-04-28",
    signatureRef: "sig-2",
    supersededBy: null, // active
  },
  {
    id: 1,
    workerId: "w-001",
    taskKind: "Recolección",
    rateBasis: "lata",
    rateUsd: 3.0,
    effectiveFrom: "2025-05-01",
    effectiveTo: "2026-04-30",
    signedAt: "2025-04-28",
    signatureRef: "sig-1",
    supersededBy: 2, // superseded
  },
];

describe("WorkerContractsSection", () => {
  it("renders each contract with its rate and basis", () => {
    render(<WorkerContractsSection contracts={contracts} />);
    expect(screen.getByTestId("contract-2")).toBeInTheDocument();
    expect(within(screen.getByTestId("contract-2")).getByText("$3.50")).toBeInTheDocument();
    expect(within(screen.getByTestId("contract-2")).getByText("/lata")).toBeInTheDocument();
  });

  it("marks the active vs superseded contracts", () => {
    render(<WorkerContractsSection contracts={contracts} />);
    expect(
      within(screen.getByTestId("contract-2")).getByText("Vigente"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("contract-1")).getByText("Reemplazado"),
    ).toBeInTheDocument();
  });

  it("renders the empty state with no contracts", () => {
    render(<WorkerContractsSection contracts={[]} />);
    expect(
      screen.getByText("Sin contratos por obra todavía"),
    ).toBeInTheDocument();
  });
});
