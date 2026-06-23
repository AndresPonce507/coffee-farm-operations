import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PayPeriodDisbursementsSection } from "@/components/sections/pay-period/pay-period-disbursements-section";
import type { Disbursement } from "@/lib/db/payroll";

afterEach(cleanup);

function disbursement(over: Partial<Disbursement> = {}): Disbursement {
  return {
    id: 1,
    payPeriodId: "pp-1",
    workerId: "w-06",
    payLineId: 1,
    amountUsd: 105,
    method: "yappy",
    ref: "YP-2231",
    signatureRef: null,
    disbursedAt: "2026-06-17T14:00:00Z",
    ...over,
  };
}

describe("PayPeriodDisbursementsSection", () => {
  it("links each recorded payment's worker to their /workers/[id] dossier", () => {
    render(
      <PayPeriodDisbursementsSection
        disbursements={[disbursement({ workerId: "w-06" })]}
        workerNames={{ "w-06": "Lucía Morales" }}
      />,
    );
    // EntityLink carries the es-PA aria-label (the contract); the component passes
    // the resolved worker name so the label is "Abrir trabajador Lucía Morales"
    // (richer than the raw slug) — the page hands in the workerId→name map.
    const link = screen.getByRole("link", { name: /trabajador lucía morales/i });
    expect(link).toHaveAttribute("href", "/workers/w-06");
    expect(link).toHaveTextContent("Lucía Morales");
  });

  it("shows the amount and method of each payment", () => {
    render(
      <PayPeriodDisbursementsSection
        disbursements={[disbursement({ amountUsd: 105, method: "yappy" })]}
        workerNames={{ "w-06": "Lucía Morales" }}
      />,
    );
    const section = screen.getByTestId("section-disbursements");
    expect(within(section).getByText("$105.00")).toBeInTheDocument();
    expect(within(section).getByText(/yappy/i)).toBeInTheDocument();
  });

  it("renders the es-PA empty state when no payments have been recorded", () => {
    render(<PayPeriodDisbursementsSection disbursements={[]} workerNames={{}} />);
    const section = screen.getByTestId("section-disbursements");
    expect(within(section).getByText(/Sin/i)).toBeInTheDocument();
  });

  it("falls back to the worker id when the name is unknown (still links to the dossier)", () => {
    render(
      <PayPeriodDisbursementsSection
        disbursements={[disbursement({ workerId: "w-x" })]}
        workerNames={{}}
      />,
    );
    const link = screen.getByRole("link", { name: /w-x/ });
    expect(link).toHaveAttribute("href", "/workers/w-x");
  });
});
