import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PayPeriodSummary, Disbursement } from "@/lib/db/payroll";
import type { PayPeriodPayLine } from "@/lib/db/dossier/pay-period";

/**
 * /pay-period/[id] dossier — page behavior test (mirrors lots/[code]).
 *
 * The page is an async Server Component that resolves the ANCHOR period with ONE
 * getter (notFound() before any section fetch), then Promise.all's the section
 * reads and renders through <DossierShell> + four <…Section>s. We stub the read
 * ports (no Supabase) and the section components (so this asserts the PAGE's job:
 * the anchor gate, the parallel reads, the ordered section composition).
 */

const period: PayPeriodSummary = {
  id: "pp-1",
  periodStart: "2026-06-01",
  periodEnd: "2026-06-15",
  season: "2026 main",
  status: "calculated",
  calculatedAt: "2026-06-16",
  workerCount: 2,
  totalGrossUsd: 260,
  totalNetUsd: 210,
  totalMakeWholeUsd: 40,
  madeWholeCount: 1,
};

const lines: PayPeriodPayLine[] = [
  {
    id: 1,
    payPeriodId: "pp-1",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-15",
    workerId: "w-06",
    workerName: "Lucía Morales",
    crewName: "Crew Tizingal",
    crewId: "crew-tizingal",
    hoursWorked: 40,
    pieceRateUsd: 90,
    hourlyUsd: 0,
    minWageFloorUsd: 130,
    makeWholeUsd: 40,
    grossUsd: 130,
    cssUsd: 12,
    seguroEducativoUsd: 2,
    decimoAccrualUsd: 11,
    netUsd: 105,
    status: "calculated",
    reversesId: null,
    madeWhole: true,
  },
];

const disbursements: Disbursement[] = [
  {
    id: 1,
    payPeriodId: "pp-1",
    workerId: "w-06",
    payLineId: 1,
    amountUsd: 105,
    method: "yappy",
    ref: "YP-1",
    signatureRef: null,
    disbursedAt: "2026-06-17T14:00:00Z",
  },
];

vi.mock("@/lib/db/payroll", () => ({
  getPayPeriodById: vi.fn(async (id: string) => (id === "pp-1" ? period : null)),
  getDisbursementsForPeriod: vi.fn(async () => disbursements),
}));

vi.mock("@/lib/db/dossier/pay-period", () => ({
  getPayPeriodPayLines: vi.fn(async () => lines),
}));

const NOT_FOUND = new Error("NEXT_NOT_FOUND");
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw NOT_FOUND;
  }),
}));

// Stub the four sections so the page test stays a pure composition check.
vi.mock("@/components/sections/pay-period/pay-period-summary-section", () => ({
  PayPeriodSummarySection: ({ period: p }: { period: PayPeriodSummary }) => (
    <div data-testid="summary-stub">{p.id}</div>
  ),
}));
vi.mock("@/components/sections/pay-period/pay-period-lines-section", () => ({
  PayPeriodLinesSection: ({ lines: l }: { lines: PayPeriodPayLine[] }) => (
    <div data-testid="lines-stub">lines:{l.length}</div>
  ),
}));
vi.mock("@/components/sections/pay-period/pay-period-make-whole-section", () => ({
  PayPeriodMakeWholeSection: ({ lines: l }: { lines: PayPeriodPayLine[] }) => (
    <div data-testid="make-whole-stub">made-whole:{l.filter((x) => x.madeWhole).length}</div>
  ),
}));
vi.mock("@/components/sections/pay-period/pay-period-disbursements-section", () => ({
  PayPeriodDisbursementsSection: ({ disbursements: d }: { disbursements: Disbursement[] }) => (
    <div data-testid="disbursements-stub">disb:{d.length}</div>
  ),
}));

import PayPeriodDossierPage from "@/app/(app)/pay-period/[id]/page";
import { getPayPeriodById, getDisbursementsForPeriod } from "@/lib/db/payroll";
import { getPayPeriodPayLines } from "@/lib/db/dossier/pay-period";
import { notFound } from "next/navigation";

afterEach(cleanup);

describe("/pay-period/[id] page (smoke)", () => {
  it("resolves the anchor period and renders all four sections fed the fetched data", async () => {
    const ui = await PayPeriodDossierPage({
      params: Promise.resolve({ id: "pp-1" }),
    });
    render(ui);

    // anchor getter called with the route id.
    expect(getPayPeriodById).toHaveBeenCalledWith("pp-1");
    // section reads scoped to the period.
    expect(getPayPeriodPayLines).toHaveBeenCalledWith("pp-1");
    expect(getDisbursementsForPeriod).toHaveBeenCalledWith("pp-1");

    // dossier shell + ordered sections.
    expect(screen.getByTestId("dossier-pay-period")).toBeInTheDocument();
    expect(screen.getByTestId("summary-stub")).toHaveTextContent("pp-1");
    expect(screen.getByTestId("lines-stub")).toHaveTextContent("lines:1");
    expect(screen.getByTestId("make-whole-stub")).toHaveTextContent("made-whole:1");
    expect(screen.getByTestId("disbursements-stub")).toHaveTextContent("disb:1");
  });

  it("calls notFound() for an unknown period id instead of fabricating a dossier", async () => {
    vi.mocked(notFound).mockClear();
    vi.mocked(getPayPeriodById).mockResolvedValueOnce(null);
    vi.mocked(getPayPeriodPayLines).mockClear();

    await expect(
      PayPeriodDossierPage({ params: Promise.resolve({ id: "pp-404" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFound).toHaveBeenCalledTimes(1);
    // the 404 short-circuits BEFORE any section read (anchor gate first).
    expect(getPayPeriodPayLines).not.toHaveBeenCalled();
  });
});
