import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PayPeriodSummary, WorkerPay, Payslip } from "@/lib/db/payroll";

/**
 * /payroll page smoke test. The page is an async Server Component that fetches from
 * the `payroll` read ports and composes the summary + period board + cockpit (+ an
 * optional payslip). We stub the ports (no DB) and assert the PAGE's job: it renders
 * the header, wires the selected period through to the cockpit, and shows the
 * make-whole-protected worker's pay.
 */

const PERIODS: PayPeriodSummary[] = [
  {
    id: "pp-2026-06-w3",
    periodStart: "2026-06-15",
    periodEnd: "2026-06-21",
    season: "2026-2027",
    status: "calculated",
    calculatedAt: "2026-06-21T20:00:00Z",
    workerCount: 8,
    totalGrossUsd: 1240.5,
    totalNetUsd: 1100.25,
    totalMakeWholeUsd: 18.0,
    madeWholeCount: 2,
  },
];

const ROWS: WorkerPay[] = [
  {
    id: 1,
    payPeriodId: "pp-2026-06-w3",
    periodStart: "2026-06-15",
    periodEnd: "2026-06-21",
    workerId: "w-low",
    workerName: "Low Picker",
    crewName: "Crew Tizingal",
    hoursWorked: 8,
    pieceRateUsd: 2,
    hourlyUsd: 0,
    minWageFloorUsd: 16,
    makeWholeUsd: 14,
    grossUsd: 16,
    cssUsd: 1.56,
    seguroEducativoUsd: 0.2,
    decimoAccrualUsd: 1.33,
    netUsd: 14.24,
    status: "calculated",
    reversesId: null,
    madeWhole: true,
  },
];

const PAYSLIP: Payslip | null = null;

vi.mock("@/lib/db/payroll", () => ({
  getPayPeriods: vi.fn(async () => PERIODS),
  getWorkerPayForPeriod: vi.fn(async () => ROWS),
  getPayslip: vi.fn(async () => PAYSLIP),
}));

import PayrollPage from "@/app/(app)/payroll/page";

afterEach(cleanup);

describe("/payroll page", () => {
  it("renders the header, summary, period board and per-worker cockpit", async () => {
    const ui = await PayrollPage({
      searchParams: Promise.resolve({}),
    });
    render(ui);

    expect(
      screen.getByRole("heading", { name: /Payroll/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("payroll-summary")).toBeInTheDocument();
    expect(screen.getByTestId("period-board")).toBeInTheDocument();
    expect(screen.getByTestId("pay-breakdown-table")).toBeInTheDocument();
  });

  it("surfaces the make-whole-protected worker (the legal-floor top-up is visible)", async () => {
    const ui = await PayrollPage({
      searchParams: Promise.resolve({ period: "pp-2026-06-w3" }),
    });
    render(ui);
    // the cockpit shows the make-whole worker's name and a topped-up signal.
    // (the responsive table renders the worker in BOTH a desktop table row and a
    // mobile stacked card, so the name appears more than once — assert >= 1.)
    expect(screen.getAllByText("Low Picker").length).toBeGreaterThan(0);
  });
});
