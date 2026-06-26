import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StorageBoard } from "@/app/(app)/storage/data";

// The board is a Server Component reading the co-located storage port (it binds to the
// authoritative v_storage_status + storage_certificates surface the P3-S20 migration
// shipped). Stub the port so the async page resolves without a Supabase client, and
// stub the client console island (its forms aren't this test's job) so the page test
// pins its ONE job: render every location as a gauge card with an HONEST band verdict
// (a location with no readings shows "No readings yet", NEVER a fabricated in-band).
const { getStorageBoardMock } = vi.hoisted(() => ({ getStorageBoardMock: vi.fn() }));
vi.mock("@/app/(app)/storage/data", () => ({ getStorageBoard: getStorageBoardMock }));
vi.mock("@/app/(app)/storage/storage-console.client", () => ({
  StorageConsole: () => <div data-testid="storage-console-stub" />,
}));

import StoragePage from "@/app/(app)/storage/page";

const IN_BAND = {
  locationId: 1,
  code: "BOD-1",
  name: "Bodega central",
  tempMinC: 15,
  tempMaxC: 25,
  rhMinPct: 50,
  rhMaxPct: 65,
  awMax: 0.65,
  latestTempC: 21,
  latestRhPct: 58,
  latestAw: 0.61,
  latestReadingAt: "2026-06-20T12:00:00Z",
  inBand: true as const,
};

const EXCURSION = {
  locationId: 2,
  code: "BOD-2",
  name: "Bodega norte",
  tempMinC: 15,
  tempMaxC: 25,
  rhMinPct: 50,
  rhMaxPct: 65,
  awMax: 0.65,
  latestTempC: 31,
  latestRhPct: 72,
  latestAw: 0.7,
  latestReadingAt: "2026-06-20T12:00:00Z",
  inBand: false as const,
};

const NO_DATA = {
  locationId: 3,
  code: "BOD-3",
  name: "Cuarto frío",
  tempMinC: 8,
  tempMaxC: 12,
  rhMinPct: 50,
  rhMaxPct: 60,
  awMax: 0.6,
  latestTempC: null,
  latestRhPct: null,
  latestAw: null,
  latestReadingAt: null,
  inBand: null,
};

const board = (over: Partial<StorageBoard> = {}): StorageBoard => ({
  locations: [IN_BAND, EXCURSION, NO_DATA],
  greenLots: [{ lotCode: "JC-901", location: "Bodega central" }],
  certificates: [
    {
      id: 7,
      greenLotCode: "JC-901",
      locationName: "Bodega central",
      windowStart: "2026-06-01T00:00:00Z",
      windowEnd: "2026-06-20T00:00:00Z",
      readingsCount: 18,
      inBandPct: 100,
      verdict: "in-band",
      issuedAt: "2026-06-20T13:00:00Z",
    },
  ],
  ...over,
});

beforeEach(() => getStorageBoardMock.mockResolvedValue(board()));
afterEach(cleanup);

describe("/storage controlled-environment board (smoke)", () => {
  it("renders the page heading", async () => {
    render(await StoragePage());
    expect(
      screen.getByRole("heading", { level: 1, name: "Storage" }),
    ).toBeInTheDocument();
  });

  it("renders an in-band location card holding target", async () => {
    render(await StoragePage());
    const card = screen.getByTestId("storage-card-1");
    expect(within(card).getByText("Bodega central")).toBeInTheDocument();
    expect(within(card).getByText("In band")).toBeInTheDocument();
  });

  it("flags an out-of-band location as an excursion", async () => {
    render(await StoragePage());
    const card = screen.getByTestId("storage-card-2");
    expect(within(card).getByText("Out of band")).toBeInTheDocument();
  });

  it("NEVER fabricates an in-band claim: a location with no readings shows the no-data state", async () => {
    render(await StoragePage());
    const card = screen.getByTestId("storage-card-3");
    expect(within(card).getAllByText("No readings yet").length).toBeGreaterThan(0);
    expect(within(card).queryByText("In band")).not.toBeInTheDocument();
  });

  it("lists an issued certificate with its verdict", async () => {
    render(await StoragePage());
    expect(screen.getByTestId("storage-cert-7")).toBeInTheDocument();
  });

  it("shows an empty state for the gauge cluster when no locations exist", async () => {
    getStorageBoardMock.mockResolvedValue(board({ locations: [] }));
    render(await StoragePage());
    expect(screen.getByText("No storage locations yet")).toBeInTheDocument();
  });

  it("always renders the console island so the owner can add the first location", async () => {
    getStorageBoardMock.mockResolvedValue(board({ locations: [] }));
    render(await StoragePage());
    expect(screen.getByTestId("storage-console-stub")).toBeInTheDocument();
  });
});
