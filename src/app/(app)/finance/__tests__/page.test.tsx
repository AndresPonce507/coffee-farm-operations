import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgingRow, CashRunway, SyncHealthRow } from "@/app/(app)/finance/data";

// The cockpit is a Server Component reading the co-located accounting port (the
// authoritative v_cash_runway / v_ar_aging / v_sync_health surface). Stub the port
// so the async page resolves without a Supabase client, pinning the page's job:
// net both ledgers in the stat strip, list the aging board, and raise the
// dead-guard alarm when a sync target has failed posts.
const { getCashRunwayMock, getAgingMock, getSyncHealthMock } = vi.hoisted(() => ({
  getCashRunwayMock: vi.fn(),
  getAgingMock: vi.fn(),
  getSyncHealthMock: vi.fn(),
}));
vi.mock("@/app/(app)/finance/data", () => ({
  getCashRunway: getCashRunwayMock,
  getAging: getAgingMock,
  getSyncHealth: getSyncHealthMock,
}));

import FinancePage from "@/app/(app)/finance/page";

const RUNWAY: CashRunway = {
  arOutstandingUsd: 42000,
  committedCostUsd: 18000,
  netPositionUsd: 24000,
};

const AGING: AgingRow[] = [
  {
    arDocId: 1,
    kind: "commercial_invoice",
    docNumber: "JC-CI-0001",
    status: "issued",
    totalUsd: 14400,
    paidUsd: 0,
    balanceUsd: 14400,
    issuedAt: "2026-06-01T00:00:00Z",
    daysOutstanding: 20,
    agingBucket: "0-30",
  },
  {
    arDocId: 2,
    kind: "commercial_invoice",
    docNumber: "JC-CI-0002",
    status: "paid",
    totalUsd: 5000,
    paidUsd: 5000,
    balanceUsd: 0,
    issuedAt: "2026-05-01T00:00:00Z",
    daysOutstanding: 50,
    agingBucket: "31-60",
  },
];

const HEALTH: SyncHealthRow[] = [
  {
    target: "qbo",
    pending: 1,
    inFlight: 0,
    failed: 2,
    synced: 5,
    maxAttemptsFailed: 3,
    oldestUnsyncedAt: "2026-06-10T00:00:00Z",
  },
];

beforeEach(() => {
  getCashRunwayMock.mockResolvedValue(RUNWAY);
  getAgingMock.mockResolvedValue(AGING);
  getSyncHealthMock.mockResolvedValue(HEALTH);
});
afterEach(cleanup);

describe("/finance cockpit (smoke)", () => {
  it("renders the page heading", async () => {
    render(await FinancePage());
    expect(
      screen.getByRole("heading", { level: 1, name: "Finance" }),
    ).toBeInTheDocument();
  });

  it("nets both ledgers in the stat strip (AR outstanding + net position)", async () => {
    render(await FinancePage());
    expect(screen.getByText("$42,000")).toBeInTheDocument();
    expect(screen.getByText("$24,000")).toBeInTheDocument();
  });

  it("lists the receivables aging board", async () => {
    render(await FinancePage());
    expect(screen.getByTestId("aging-card-JC-CI-0001")).toBeInTheDocument();
  });

  it("raises the dead-guard alarm when a sync target has failed posts", async () => {
    render(await FinancePage());
    expect(screen.getByText("2 failed")).toBeInTheDocument();
  });

  it("shows the empty state when nothing is on the books", async () => {
    getAgingMock.mockResolvedValue([]);
    getCashRunwayMock.mockResolvedValue({
      arOutstandingUsd: 0,
      committedCostUsd: 0,
      netPositionUsd: 0,
    });
    getSyncHealthMock.mockResolvedValue([]);
    render(await FinancePage());
    expect(screen.getByText("Nothing on the books yet")).toBeInTheDocument();
  });
});
