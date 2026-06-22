import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PayPeriodSummarySection } from "@/components/sections/pay-period/pay-period-summary-section";
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

describe("PayPeriodSummarySection", () => {
  it("renders the period window, status and money roll-ups inside an anchored section", () => {
    render(<PayPeriodSummarySection period={period()} />);
    const section = screen.getByTestId("section-summary");
    expect(within(section).getByText(/2026-06-01/)).toBeInTheDocument();
    expect(within(section).getByText(/2026-06-15/)).toBeInTheDocument();
    expect(within(section).getByText("$4,820.50")).toBeInTheDocument();
    expect(within(section).getByText("$4,290.25")).toBeInTheDocument();
  });

  it("drills the computed gross/net totals to the editable pay lines (#lines anchor)", () => {
    render(<PayPeriodSummarySection period={period()} />);
    const section = screen.getByTestId("section-summary");
    // a computed total is not editable here — it drills to the source pay lines.
    const drill = within(section).getByTestId("summary-drill-lines");
    expect(drill).toHaveAttribute("href", "#lines");
  });

  it("renders without throwing when the period is still open (no calculated totals)", () => {
    render(
      <PayPeriodSummarySection
        period={period({ status: "open", calculatedAt: null, totalGrossUsd: 0, totalNetUsd: 0 })}
      />,
    );
    expect(screen.getByTestId("section-summary")).toBeInTheDocument();
  });
});
