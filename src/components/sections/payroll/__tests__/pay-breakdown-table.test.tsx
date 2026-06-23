import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PayBreakdownTable } from "@/components/sections/payroll/pay-breakdown-table";
import type { WorkerPay } from "@/lib/db/payroll";

afterEach(cleanup);

function row(over: Partial<WorkerPay> = {}): WorkerPay {
  return {
    id: 1,
    payPeriodId: "pp-1",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-15",
    workerId: "w-1",
    workerName: "Miguel Santos",
    crewName: "Crew Alba",
    hoursWorked: 88,
    pieceRateUsd: 210.0,
    hourlyUsd: 0,
    minWageFloorUsd: 240.0,
    makeWholeUsd: 0,
    grossUsd: 210.0,
    cssUsd: 19.95,
    seguroEducativoUsd: 2.63,
    decimoAccrualUsd: 17.5,
    netUsd: 169.92,
    status: "calculated",
    reversesId: null,
    madeWhole: false,
    ...over,
  };
}

const aboveFloor: WorkerPay[] = [
  row({ id: 1, workerName: "Miguel Santos", grossUsd: 310.0 }),
  row({ id: 2, workerName: "Lucía Vega", workerId: "w-2", grossUsd: 295.5 }),
];

const withMakeWhole: WorkerPay[] = [
  row({ id: 1, workerName: "Miguel Santos", grossUsd: 310.0 }),
  row({
    id: 2,
    workerName: "Ana Pérez",
    workerId: "w-2",
    crewName: "Crew Río",
    pieceRateUsd: 180.0,
    grossUsd: 240.0,
    makeWholeUsd: 60.0,
    madeWhole: true,
    netUsd: 198.4,
  }),
];

describe("PayBreakdownTable", () => {
  it("links worker names to /workers/[id] in both desktop and mobile views", () => {
    render(<PayBreakdownTable rows={aboveFloor} />);
    const table = screen.getByTestId("pay-breakdown-table");
    // Each worker name should be wrapped in an anchor pointing to the worker dossier.
    // aboveFloor has workerId "w-1" (Miguel Santos) and "w-2" (Lucía Vega).
    // EntityLink renders aria-label="Abrir trabajador <id>" per the contract.
    // Both desktop and mobile render the name, so getAllByRole returns >=2 per worker.
    const miguelLinks = within(table).getAllByRole("link", {
      name: /abrir trabajador w-1/i,
    });
    expect(miguelLinks.length).toBeGreaterThan(0);
    expect(miguelLinks[0]).toHaveAttribute("href", "/workers/w-1");

    const luciaLinks = within(table).getAllByRole("link", {
      name: /abrir trabajador w-2/i,
    });
    expect(luciaLinks.length).toBeGreaterThan(0);
    expect(luciaLinks[0]).toHaveAttribute("href", "/workers/w-2");
  });

  it("renders the per-worker rows and totals without throwing", () => {
    render(<PayBreakdownTable rows={aboveFloor} />);
    const table = screen.getByTestId("pay-breakdown-table");
    expect(within(table).getAllByText("Miguel Santos").length).toBeGreaterThan(0);
    expect(within(table).getAllByText("Lucía Vega").length).toBeGreaterThan(0);
    // footer totals row label
    expect(within(table).getAllByText("Totals").length).toBeGreaterThan(0);
    // gross total = 310 + 295.50 = 605.50, USD 2-decimal
    expect(within(table).getAllByText("$605.50").length).toBeGreaterThan(0);
  });

  it("surfaces the make-whole top-up with its dignified label when the floor fired", () => {
    render(<PayBreakdownTable rows={withMakeWhole} />);
    const table = screen.getByTestId("pay-breakdown-table");

    // the honey pill rendered for the protected worker (desktop + mobile = 2 copies)
    expect(
      within(table).getAllByTestId("make-whole-pill-2").length,
    ).toBeGreaterThan(0);
    // the top-up amount is shown
    expect(within(table).getAllByText("$60.00").length).toBeGreaterThan(0);
    // the dignified legal label is present (sr-only + title)
    expect(
      within(table).getAllByText(/topped up to the legal minimum/i).length,
    ).toBeGreaterThan(0);

    // the protected row is flagged for the honey accent
    const desktop = screen.getByTestId("pay-breakdown-desktop");
    const flagged = desktop.querySelectorAll('[data-made-whole="true"]');
    expect(flagged.length).toBe(1);
  });

  it("does NOT show the make-whole highlight when every row is above the floor", () => {
    render(<PayBreakdownTable rows={aboveFloor} />);
    expect(
      screen.queryByText(/topped up to the legal minimum/i),
    ).not.toBeInTheDocument();
    const desktop = screen.getByTestId("pay-breakdown-desktop");
    expect(
      desktop.querySelectorAll('[data-made-whole="true"]').length,
    ).toBe(0);
  });

  it("renders the décimo, CSS, and Seguro Educativo columns", () => {
    render(<PayBreakdownTable rows={aboveFloor} />);
    const desktop = screen.getByTestId("pay-breakdown-desktop");
    expect(within(desktop).getByText("Décimo")).toBeInTheDocument();
    expect(within(desktop).getByText("CSS")).toBeInTheDocument();
    expect(within(desktop).getByText("Seguro Educativo")).toBeInTheDocument();
  });

  it("renders the empty state without throwing when there are no rows", () => {
    render(<PayBreakdownTable rows={[]} />);
    expect(screen.getByTestId("pay-breakdown-table")).toBeInTheDocument();
    expect(
      screen.getByText(/no pay lines for this period/i),
    ).toBeInTheDocument();
  });
});
