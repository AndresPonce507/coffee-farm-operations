import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PayrollSummary } from "@/components/sections/payroll/payroll-summary";
import type { PayPeriodSummary } from "@/lib/db/payroll";

afterEach(cleanup);

function period(over: Partial<PayPeriodSummary> = {}): PayPeriodSummary {
  return {
    id: "pp-1",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-15",
    season: "2026 main",
    status: "calculated",
    calculatedAt: "2026-06-16",
    workerCount: 12,
    totalGrossUsd: 4820.5,
    totalNetUsd: 4290.25,
    totalMakeWholeUsd: 88.4,
    madeWholeCount: 3,
    ...over,
  };
}

describe("PayrollSummary", () => {
  it("renders the period count, gross, net, and made-whole figures from the latest period", () => {
    render(
      <PayrollSummary
        periods={[period(), period({ id: "pp-0", madeWholeCount: 0 })]}
      />,
    );
    const strip = screen.getByTestId("payroll-summary");

    // two periods in the list
    expect(within(strip).getByText("Pay periods")).toBeInTheDocument();
    expect(within(strip).getByText("2")).toBeInTheDocument();

    // latest period's money, 2-decimal USD, tabular
    expect(within(strip).getByText("$4,820.50")).toBeInTheDocument();
    expect(within(strip).getByText("$4,290.25")).toBeInTheDocument();

    // the standout count
    expect(within(strip).getByText("Made whole")).toBeInTheDocument();
    expect(within(strip).getByText("3")).toBeInTheDocument();
  });

  it("surfaces the made-whole protection prominently when the floor fired", () => {
    render(<PayrollSummary periods={[period({ madeWholeCount: 3 })]} />);
    const highlight = screen.getByTestId("payroll-summary-made-whole");
    expect(highlight).toBeInTheDocument();
    expect(
      within(highlight).getByText(/lifted to the legal floor/i),
    ).toBeInTheDocument();
  });

  it("shows the calm 'all above the floor' sub-label when nobody was made whole", () => {
    render(<PayrollSummary periods={[period({ madeWholeCount: 0 })]} />);
    const highlight = screen.getByTestId("payroll-summary-made-whole");
    expect(
      within(highlight).getByText(/all above the floor/i),
    ).toBeInTheDocument();
  });

  it("renders with no periods without throwing (zeros)", () => {
    render(<PayrollSummary periods={[]} />);
    const strip = screen.getByTestId("payroll-summary");
    expect(within(strip).getByText("Pay periods")).toBeInTheDocument();
    // period count + made-whole count both 0
    expect(within(strip).getAllByText("0")).toHaveLength(2);
    expect(within(strip).getAllByText("$0.00")).toHaveLength(2);
  });
});
