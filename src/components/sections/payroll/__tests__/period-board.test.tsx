import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PeriodBoard } from "@/components/sections/payroll/period-board";
import type { PayPeriodSummary } from "@/lib/db/payroll";

afterEach(cleanup);

function period(over: Partial<PayPeriodSummary> = {}): PayPeriodSummary {
  return {
    id: "pp-jun-a",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-15",
    season: "2026 main",
    status: "calculated",
    calculatedAt: "2026-06-16",
    workerCount: 12,
    totalGrossUsd: 4820.5,
    totalNetUsd: 4290.25,
    totalMakeWholeUsd: 88.4,
    madeWholeCount: 2,
    ...over,
  };
}

describe("PeriodBoard", () => {
  it("renders a card per period with its window, counts, and money", () => {
    render(
      <PeriodBoard
        periods={[
          period(),
          period({ id: "pp-may", status: "paid", madeWholeCount: 0 }),
        ]}
      />,
    );
    const board = screen.getByTestId("period-board");
    expect(within(board).getByTestId("period-card-pp-jun-a")).toBeInTheDocument();
    expect(within(board).getByTestId("period-card-pp-may")).toBeInTheDocument();

    // worker count + money rendered (USD 2-decimal)
    expect(within(board).getAllByText(/worker/i).length).toBeGreaterThan(0);
    expect(within(board).getAllByText("$4,820.50").length).toBeGreaterThan(0);
  });

  it("links each card to the /pay-period/[id] dossier", () => {
    render(<PeriodBoard periods={[period({ id: "pp-xyz" })]} />);
    const link = screen.getByTestId("period-card-pp-xyz");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/pay-period/pp-xyz");
  });

  it("shows the make-whole chip only for periods where the floor fired", () => {
    render(
      <PeriodBoard
        periods={[
          period({ id: "pp-with", madeWholeCount: 4 }),
          period({ id: "pp-without", madeWholeCount: 0 }),
        ]}
      />,
    );
    const withChip = screen.getByTestId("period-made-whole-pp-with");
    expect(withChip).toHaveTextContent(/4 made whole/i);
    expect(
      screen.queryByTestId("period-made-whole-pp-without"),
    ).not.toBeInTheDocument();
  });

  it("marks the active period as the current page", () => {
    render(
      <PeriodBoard
        periods={[period({ id: "pp-a" }), period({ id: "pp-b" })]}
        activePeriodId="pp-b"
      />,
    );
    expect(screen.getByTestId("period-card-pp-b")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByTestId("period-card-pp-a")).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("renders the empty state without throwing when there are no periods", () => {
    render(<PeriodBoard periods={[]} />);
    expect(screen.getByText(/no pay periods yet/i)).toBeInTheDocument();
  });

  it("maps each status to its labelled badge", () => {
    render(
      <PeriodBoard
        periods={[
          period({ id: "p-open", status: "open" }),
          period({ id: "p-calc", status: "calculated" }),
          period({ id: "p-appr", status: "approved" }),
          period({ id: "p-paid", status: "paid" }),
        ]}
      />,
    );
    const board = screen.getByTestId("period-board");
    expect(within(board).getByText("Open")).toBeInTheDocument();
    expect(within(board).getByText("Calculated")).toBeInTheDocument();
    expect(within(board).getByText("Approved")).toBeInTheDocument();
    expect(within(board).getByText("Paid")).toBeInTheDocument();
  });
});
