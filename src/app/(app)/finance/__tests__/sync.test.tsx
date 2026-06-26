import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AccountMapRow,
  SyncHealthRow,
  SyncOutboxRow,
} from "@/app/(app)/finance/data";

// The console reads the sync port. Stub it; stub the interactive island (process-queue
// buttons + account-map editor) so the server page's job is pinned: the per-target
// health cards (the dead-guard alarm in red on failures), the account map, and the
// failed-post list.
const { getSyncHealthMock, getAccountMapMock, getFailedSyncsMock } = vi.hoisted(
  () => ({
    getSyncHealthMock: vi.fn(),
    getAccountMapMock: vi.fn(),
    getFailedSyncsMock: vi.fn(),
  }),
);
vi.mock("@/app/(app)/finance/data", () => ({
  getSyncHealth: getSyncHealthMock,
  getAccountMap: getAccountMapMock,
  getFailedSyncs: getFailedSyncsMock,
}));
vi.mock("@/app/(app)/finance/sync/sync-console.client", () => ({
  SyncConsole: () => <div data-testid="sync-console-stub" />,
}));

import SyncPage from "@/app/(app)/finance/sync/page";

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
  {
    target: "xero",
    pending: 0,
    inFlight: 0,
    failed: 0,
    synced: 9,
    maxAttemptsFailed: null,
    oldestUnsyncedAt: null,
  },
];

const MAP: AccountMapRow[] = [
  {
    id: 1,
    target: "qbo",
    entryKind: "revenue",
    matchKey: "green_sale",
    accountCode: "4000",
    accountName: "Coffee sales",
  },
];

const FAILED: SyncOutboxRow[] = [
  {
    id: 5,
    target: "qbo",
    entityKind: "ar_doc",
    entityRef: "JC-CI-0001",
    state: "failed",
    externalId: null,
    attempts: 3,
    lastError: "sandbox 500",
    createdAt: "2026-06-10T00:00:00Z",
  },
];

beforeEach(() => {
  getSyncHealthMock.mockResolvedValue(HEALTH);
  getAccountMapMock.mockResolvedValue(MAP);
  getFailedSyncsMock.mockResolvedValue(FAILED);
});
afterEach(cleanup);

describe("/finance/sync console (smoke)", () => {
  it("renders the page heading", async () => {
    render(await SyncPage());
    expect(
      screen.getByRole("heading", { level: 1, name: "Accounting sync" }),
    ).toBeInTheDocument();
  });

  it("raises the dead-guard alarm in red on a target with failures, healthy otherwise", async () => {
    render(await SyncPage());
    const qbo = screen.getByTestId("sync-health-qbo");
    expect(within(qbo).getByText("Sync stalled")).toBeInTheDocument();
    const xero = screen.getByTestId("sync-health-xero");
    expect(within(xero).getByText("Healthy")).toBeInTheDocument();
  });

  it("renders the account map mappings", async () => {
    render(await SyncPage());
    const map = screen.getByTestId("account-map");
    expect(within(map).getByText("green_sale")).toBeInTheDocument();
    expect(within(map).getByText("4000")).toBeInTheDocument();
  });

  it("renders the failed-post list", async () => {
    render(await SyncPage());
    const failed = screen.getByTestId("failed-posts");
    expect(within(failed).getByText("JC-CI-0001")).toBeInTheDocument();
  });

  it("shows the empty health state when nothing is queued", async () => {
    getSyncHealthMock.mockResolvedValue([]);
    render(await SyncPage());
    expect(
      screen.getByText("Nothing queued. Issue an invoice to start a sync."),
    ).toBeInTheDocument();
  });
});
