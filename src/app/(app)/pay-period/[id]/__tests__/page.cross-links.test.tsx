import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PayPeriodSummary, Disbursement } from "@/lib/db/payroll";
import type { PayPeriodPayLine } from "@/lib/db/dossier/pay-period";

/**
 * /pay-period/[id] dossier — cross-entity connectivity AC (REVIEWER-2 KPI 5:
 * every dossier surfaces ≥4 cross-entity links). Unlike page.test.tsx this does
 * NOT stub the sections — it renders the REAL sections so the assertion proves
 * the rendered dossier actually emits dossier links (worker + crew), not that a
 * stub said it would. Only the read ports are mocked (no Supabase).
 */

function line(over: Partial<PayPeriodPayLine> = {}): PayPeriodPayLine {
  return {
    id: 1,
    payPeriodId: "pp-1",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-15",
    workerId: "w-01",
    workerName: "Lucía Morales",
    crewName: "Crew Tizingal",
    crewId: "crew-tizingal",
    hoursWorked: 40,
    pieceRateUsd: 120,
    hourlyUsd: 0,
    minWageFloorUsd: 130,
    makeWholeUsd: 0,
    grossUsd: 130,
    cssUsd: 12,
    seguroEducativoUsd: 2,
    decimoAccrualUsd: 11,
    netUsd: 105,
    status: "calculated",
    reversesId: null,
    madeWhole: false,
    ...over,
  };
}

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
  line({ id: 1, workerId: "w-01", workerName: "Lucía Morales", crewId: "crew-tizingal", madeWhole: true, makeWholeUsd: 40 }),
  line({ id: 2, workerId: "w-02", workerName: "Eduardo Pérez", crewId: "crew-norte", crewName: "Crew Norte" }),
];

const disbursements: Disbursement[] = [
  { id: 1, payPeriodId: "pp-1", workerId: "w-01", payLineId: 1, amountUsd: 105, method: "yappy", ref: "YP-1", signatureRef: null, disbursedAt: "2026-06-17T14:00:00Z" },
  { id: 2, payPeriodId: "pp-1", workerId: "w-02", payLineId: 2, amountUsd: 105, method: "cash", ref: null, signatureRef: "sig-1", disbursedAt: "2026-06-17T15:00:00Z" },
];

vi.mock("@/lib/db/payroll", () => ({
  getPayPeriodById: vi.fn(async () => period),
  getDisbursementsForPeriod: vi.fn(async () => disbursements),
}));
vi.mock("@/lib/db/dossier/pay-period", () => ({
  getPayPeriodPayLines: vi.fn(async () => lines),
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

import PayPeriodDossierPage from "@/app/(app)/pay-period/[id]/page";

afterEach(cleanup);

describe("/pay-period/[id] cross-entity connectivity", () => {
  it("surfaces ≥4 cross-entity dossier links (workers + crews) from the real sections", async () => {
    const ui = await PayPeriodDossierPage({
      params: Promise.resolve({ id: "pp-1" }),
    });
    render(ui);

    const links = screen.getAllByRole("link");
    const hrefs = links
      .map((l) => l.getAttribute("href"))
      .filter((h): h is string => Boolean(h));

    // Distinct worker + crew dossier targets emitted across the dossier.
    const workerTargets = new Set(hrefs.filter((h) => h.startsWith("/workers/")));
    const crewTargets = new Set(hrefs.filter((h) => h.startsWith("/crew/")));

    expect(workerTargets).toContain("/workers/w-01");
    expect(workerTargets).toContain("/workers/w-02");
    expect(crewTargets).toContain("/crew/crew-tizingal");
    expect(crewTargets).toContain("/crew/crew-norte");

    // The KPI: ≥4 cross-entity links to other dossiers.
    const crossEntity = hrefs.filter(
      (h) => h.startsWith("/workers/") || h.startsWith("/crew/"),
    );
    expect(crossEntity.length).toBeGreaterThanOrEqual(4);
  });

  it("links back to the payroll list (the dossier's home)", async () => {
    const ui = await PayPeriodDossierPage({
      params: Promise.resolve({ id: "pp-1" }),
    });
    render(ui);
    expect(
      screen.getByRole("link", { name: /All payroll/i }),
    ).toHaveAttribute("href", "/payroll");
  });
});
