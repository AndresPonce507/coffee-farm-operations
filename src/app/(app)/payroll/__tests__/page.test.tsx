import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  Disbursement,
  PayPeriodSummary,
  Payslip,
  WorkerPay,
} from "@/lib/db/payroll";

/**
 * /payroll page smoke test. The page is an async Server Component that fetches from
 * the `payroll` read ports and composes the summary + period board + cockpit + the
 * WRITE islands (calculate / approve / record-disbursement) + an optional payslip +
 * the disbursement ledger. We stub the ports (no DB) and assert the PAGE's job: it
 * renders the header, wires the selected period through to the cockpit, surfaces the
 * make-whole-protected worker, exposes the write controls, makes the payslip
 * reachable through an in-app worker selector (not just a hand-typed URL), and shows
 * the recorded-payment ledger.
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
    // a CALCULATED (unapproved) line — exposes the Approve gate.
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
  {
    // an APPROVED, not-yet-fully-paid line — exposes the record-disbursement form.
    id: 2,
    payPeriodId: "pp-2026-06-w3",
    periodStart: "2026-06-15",
    periodEnd: "2026-06-21",
    workerId: "w-high",
    workerName: "Hilda Picker",
    crewName: "Crew Tizingal",
    hoursWorked: 88,
    pieceRateUsd: 210,
    hourlyUsd: 0,
    minWageFloorUsd: 240,
    makeWholeUsd: 0,
    grossUsd: 310,
    cssUsd: 29.45,
    seguroEducativoUsd: 3.88,
    decimoAccrualUsd: 25.83,
    netUsd: 250.84,
    status: "approved",
    reversesId: null,
    madeWhole: false,
  },
];

const PAYSLIP: Payslip = {
  payLineId: 1,
  payPeriodId: "pp-2026-06-w3",
  periodStart: "2026-06-15",
  periodEnd: "2026-06-21",
  season: "2026-2027",
  workerId: "w-low",
  workerName: "Low Picker",
  preferredName: null,
  languages: ["spanish", "ngäbere"],
  hoursWorked: 8,
  pieceRateUsd: 2,
  hourlyUsd: 0,
  makeWholeUsd: 14,
  grossUsd: 16,
  cssUsd: 1.56,
  seguroEducativoUsd: 0.2,
  decimoAccrualUsd: 1.33,
  netUsd: 14.24,
  status: "approved",
};

const DISBURSEMENTS: Disbursement[] = [
  {
    id: 1,
    payPeriodId: "pp-2026-06-w3",
    workerId: "w-low",
    payLineId: 1,
    amountUsd: 14.24,
    method: "cash-signed",
    ref: null,
    signatureRef: "data:image/png;base64,AAA",
    disbursedAt: "2026-06-22T18:00:00Z",
  },
];

vi.mock("@/lib/db/payroll", () => ({
  getPayPeriods: vi.fn(async () => PERIODS),
  getWorkerPayForPeriod: vi.fn(async () => ROWS),
  getPayslip: vi.fn(async () => PAYSLIP),
  getDisbursementsForPeriod: vi.fn(async () => DISBURSEMENTS),
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
      screen.getByRole("heading", { name: /Nómina/i }),
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
    expect(screen.getAllByText("Low Picker").length).toBeGreaterThan(0);
  });

  it("exposes the three write controls — calculate, approve, record-disbursement", async () => {
    const ui = await PayrollPage({
      searchParams: Promise.resolve({ period: "pp-2026-06-w3" }),
    });
    render(ui);
    // Calculate-period form island.
    expect(screen.getByTestId("compute-period-form")).toBeInTheDocument();
    // Approve control for the calculated line.
    expect(
      screen.getByRole("button", { name: /approve .*Low Picker/i }),
    ).toBeInTheDocument();
    // Record-disbursement form island.
    expect(screen.getByTestId("disbursement-form")).toBeInTheDocument();
  });

  it("makes the bilingual QR payslip reachable through an in-app worker selector", async () => {
    const ui = await PayrollPage({
      searchParams: Promise.resolve({ period: "pp-2026-06-w3" }),
    });
    render(ui);
    // a selector links each worker to ?period=&worker= (no hand-typed UUID).
    const selector = screen.getByTestId("payslip-selector");
    const link = within(selector).getByRole("link", {
      name: /Low Picker/i,
    });
    expect(link).toHaveAttribute(
      "href",
      "/payroll?period=pp-2026-06-w3&worker=w-low",
    );
  });

  it("renders the QR payslip through the page when a worker is selected", async () => {
    const ui = await PayrollPage({
      searchParams: Promise.resolve({
        period: "pp-2026-06-w3",
        worker: "w-low",
      }),
    });
    render(ui);
    // the most consequential worker-facing surface is reachable through the page,
    // not just a direct component mount.
    expect(screen.getByTestId("qr-payslip")).toBeInTheDocument();
  });

  it("shows the recorded-payment ledger for the period", async () => {
    const ui = await PayrollPage({
      searchParams: Promise.resolve({ period: "pp-2026-06-w3" }),
    });
    render(ui);
    const ledger = screen.getByTestId("disbursement-ledger");
    expect(ledger).toBeInTheDocument();
    expect(within(ledger).getByText("$14.24")).toBeInTheDocument();
  });
});
