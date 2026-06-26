import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  Roaster,
  RoastableGreenLot,
  RoastBatchRow,
  RoastProfile,
} from "@/app/(app)/roast/data";

// The /roast board is a Server Component that reads the co-located roast read port
// (it binds to the authoritative roast_profiles / roasters / green_lots_atp /
// roast_traceability surface the P3-S10 migration shipped). Stub the port so the
// async page resolves with no Supabase client, and stub the interactive client
// islands so this test pins the page's ONE job: render the golden-curve library with
// each profile in its CORRECT status, and every roast batch as a link to its detail.
const {
  getRoastProfilesMock,
  getRoastersMock,
  getRoastableGreenLotsMock,
  getRoastBatchesMock,
} = vi.hoisted(() => ({
  getRoastProfilesMock: vi.fn(),
  getRoastersMock: vi.fn(),
  getRoastableGreenLotsMock: vi.fn(),
  getRoastBatchesMock: vi.fn(),
}));
vi.mock("@/app/(app)/roast/data", () => ({
  getRoastProfiles: getRoastProfilesMock,
  getRoasters: getRoastersMock,
  getRoastableGreenLots: getRoastableGreenLotsMock,
  getRoastBatches: getRoastBatchesMock,
}));
vi.mock("@/app/(app)/roast/roast-console.client", () => ({
  RoastConsole: () => <div data-testid="roast-console-stub" />,
}));
vi.mock("@/app/(app)/roast/lock-profile-button.client", () => ({
  LockProfileButton: () => <div data-testid="lock-profile-stub" />,
}));

import RoastPage from "@/app/(app)/roast/page";

const GOLDEN: RoastProfile = {
  id: 1,
  name: "Geisha Filter",
  version: 2,
  variety: "Geisha",
  roastLevel: "medium-light",
  targetChargeTempC: 200,
  targetDropTempC: 205,
  targetTotalTimeS: 600,
  targetDtrPct: 22,
  status: "approved",
  lockedAt: "2026-06-20T10:00:00Z",
};

const DRAFT: RoastProfile = {
  id: 2,
  name: "Caturra City",
  version: 1,
  variety: "Caturra",
  roastLevel: "medium",
  targetChargeTempC: 195,
  targetDropTempC: 210,
  targetTotalTimeS: 660,
  targetDtrPct: null,
  status: "draft",
  lockedAt: null,
};

const ROASTERS: Roaster[] = [
  { id: 1, name: "Probat L12 (drum)", kind: "drum", capacityKg: 12 },
];

const GREEN: RoastableGreenLot[] = [
  {
    greenLotCode: "JC-701",
    variety: "Geisha",
    scaGrade: "Presidential",
    cuppingScore: 92,
    atpKg: 80,
  },
];

const OPEN_BATCH: RoastBatchRow = {
  roastBatchId: 11,
  greenLotCode: "JC-701",
  roastedLotCode: null,
  greenInKg: 12,
  roastedKgOut: null,
  shrinkagePct: null,
  status: "open",
  profileName: "Geisha Filter",
  profileVersion: 2,
  roastLevel: "medium-light",
  profileStatus: "approved",
  cuppingScore: 92,
  scaGrade: "Presidential",
  scaPrep: "European Prep",
};

const FINALIZED_BATCH: RoastBatchRow = {
  roastBatchId: 9,
  greenLotCode: "JC-702",
  roastedLotCode: "JC-880",
  greenInKg: 10,
  roastedKgOut: 8.4,
  shrinkagePct: 0.16,
  status: "finalized",
  profileName: "Caturra City",
  profileVersion: 1,
  roastLevel: "medium",
  profileStatus: "approved",
  cuppingScore: 84,
  scaGrade: "Specialty",
  scaPrep: "European Prep",
};

beforeEach(() => {
  getRoastProfilesMock.mockResolvedValue([GOLDEN, DRAFT]);
  getRoastersMock.mockResolvedValue(ROASTERS);
  getRoastableGreenLotsMock.mockResolvedValue(GREEN);
  getRoastBatchesMock.mockResolvedValue([OPEN_BATCH, FINALIZED_BATCH]);
});
afterEach(cleanup);

describe("/roast roast board (smoke)", () => {
  it("renders the page heading", async () => {
    render(await RoastPage());
    expect(
      screen.getByRole("heading", { level: 1, name: "Roasting" }),
    ).toBeInTheDocument();
  });

  it("mounts the roast console island (new-profile + open-batch launcher)", async () => {
    render(await RoastPage());
    expect(screen.getByTestId("roast-console-stub")).toBeInTheDocument();
  });

  it("renders a GOLDEN profile with its golden badge (roast-ready)", async () => {
    render(await RoastPage());
    const card = screen.getByTestId("roast-profile-1");
    expect(within(card).getByText("Geisha Filter")).toBeInTheDocument();
    expect(within(card).getByText("Golden")).toBeInTheDocument();
  });

  it("KEYSTONE: a DRAFT profile reads as Draft and NEVER as Golden (a draft can't be roasted against)", async () => {
    render(await RoastPage());
    const card = screen.getByTestId("roast-profile-2");
    expect(within(card).getByText("Draft")).toBeInTheDocument();
    expect(within(card).queryByText("Golden")).not.toBeInTheDocument();
    // The draft card surfaces the lock-to-golden affordance.
    expect(within(card).getByTestId("lock-profile-stub")).toBeInTheDocument();
  });

  it("renders each roast batch as a link to its detail, with its green lot and status", async () => {
    render(await RoastPage());
    const open = screen.getByTestId("roast-batch-11");
    expect(open).toHaveAttribute("href", "/roast/11");
    expect(within(open).getByText("JC-701")).toBeInTheDocument();
    expect(within(open).getByText("Open")).toBeInTheDocument();

    const done = screen.getByTestId("roast-batch-9");
    expect(done).toHaveAttribute("href", "/roast/9");
    expect(within(done).getByText("Finalized")).toBeInTheDocument();
    // A finalized batch shows its realized shrinkage.
    expect(within(done).getByText(/16% shrinkage/)).toBeInTheDocument();
  });

  it("shows an empty state when there are no roast profiles yet", async () => {
    getRoastProfilesMock.mockResolvedValue([]);
    render(await RoastPage());
    expect(screen.getByText("No roast profiles yet")).toBeInTheDocument();
  });

  it("shows an empty state when there are no roast batches yet", async () => {
    getRoastBatchesMock.mockResolvedValue([]);
    render(await RoastPage());
    expect(screen.getByText("No roast batches yet")).toBeInTheDocument();
  });
});
