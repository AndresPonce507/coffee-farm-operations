import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MillLotRow, MillMachine } from "@/app/(app)/mill/data";

// The /mill board is a Server Component that reads the co-located mill read port
// (it binds to the authoritative v_mill_readiness / v_milling_runs / mill_machines /
// v_reposo_status surface the P3-S7 migration shipped). Stub the port so the async
// page resolves with no Supabase client, and stub the gate client island so this test
// pins the page's ONE job: render every parchment lot in its CORRECT gate state and
// — the keystone — never let a not-in-spec lot read as "ready" or "milling".
const { getMillBoardMock, getMillChainMock } = vi.hoisted(() => ({
  getMillBoardMock: vi.fn(),
  getMillChainMock: vi.fn(),
}));
vi.mock("@/app/(app)/mill/data", () => ({
  getMillBoard: getMillBoardMock,
  getMillChain: getMillChainMock,
}));
vi.mock("@/app/(app)/mill/mill-gate.client", () => ({
  MillGate: () => <div data-testid="mill-gate-stub" />,
}));

import MillPage from "@/app/(app)/mill/page";

const MACHINES: MillMachine[] = [
  {
    id: 1,
    kind: "huller",
    name: "Pinhalense huller",
    hoursRun: 120,
    calibrationDue: "2026-09-01",
  },
  {
    id: 2,
    kind: "polisher",
    name: "Pinhalense polisher",
    hoursRun: 80,
    calibrationDue: null,
  },
];

// Rested + in spec, no run yet — the gate is CLEAR, ready to open a run.
const READY: MillLotRow = {
  parchmentLotCode: "JC-501",
  reposoReady: true,
  reposoReason: "rest-stable, clear to mill",
  latestMoisture: 11.0,
  readiness: {
    moisturePct: 11.0,
    waterActivityAw: 0.55,
    reposoReady: true,
    passed: true,
    measuredAt: "2026-06-20T10:00:00Z",
  },
  run: null,
};

// Still too wet AND not rested — the gate is CLOSED (the no-mill-out-of-spec lot).
const BLOCKED: MillLotRow = {
  parchmentLotCode: "JC-502",
  reposoReady: false,
  reposoReason: "resting 2/15 days",
  latestMoisture: 13.2,
  readiness: null,
  run: null,
};

// Already milled — a finalized run with its green outturn booked.
const FINALIZED: MillLotRow = {
  parchmentLotCode: "JC-503",
  reposoReady: true,
  reposoReason: "rest-stable, clear to mill",
  latestMoisture: 10.9,
  readiness: {
    moisturePct: 10.9,
    waterActivityAw: 0.52,
    reposoReady: true,
    passed: true,
    measuredAt: "2026-06-18T10:00:00Z",
  },
  run: {
    runId: 7,
    parchmentKgIn: 500,
    greenKgOut: 400,
    outturnPct: 0.8,
    status: "finalized",
    openedAt: "2026-06-19T08:00:00Z",
  },
};

beforeEach(() => {
  getMillChainMock.mockResolvedValue(MACHINES);
  getMillBoardMock.mockResolvedValue([READY, BLOCKED, FINALIZED]);
});
afterEach(cleanup);

describe("/mill dry-mill board (smoke)", () => {
  it("renders the page heading", async () => {
    render(await MillPage());
    expect(
      screen.getByRole("heading", { level: 1, name: "Milling" }),
    ).toBeInTheDocument();
  });

  it("renders the dry-mill chain registry with each machine", async () => {
    render(await MillPage());
    expect(screen.getByText("Pinhalense huller")).toBeInTheDocument();
    expect(screen.getByText("Pinhalense polisher")).toBeInTheDocument();
  });

  it("mounts the gate client island (the spec-gate launcher)", async () => {
    render(await MillPage());
    expect(screen.getByTestId("mill-gate-stub")).toBeInTheDocument();
  });

  it("shows a rested, in-spec lot as Ready to mill", async () => {
    render(await MillPage());
    const card = screen.getByTestId("mill-lot-JC-501");
    expect(within(card).getByText("Ready to mill")).toBeInTheDocument();
  });

  it("KEYSTONE: a not-in-spec lot reads as Gate closed and NEVER as ready or milling", async () => {
    render(await MillPage());
    const card = screen.getByTestId("mill-lot-JC-502");
    expect(within(card).getByText("Gate closed")).toBeInTheDocument();
    expect(within(card).queryByText("Ready to mill")).not.toBeInTheDocument();
    expect(within(card).queryByText("Milling")).not.toBeInTheDocument();
    // The lot surfaces WHY it is blocked — the auditor-honest gate note.
    expect(
      within(card).getByText(/Record an in-spec reading/i),
    ).toBeInTheDocument();
  });

  it("shows a finalized run with its green outturn", async () => {
    render(await MillPage());
    const card = screen.getByTestId("mill-lot-JC-503");
    expect(within(card).getByText("Finalized")).toBeInTheDocument();
    expect(within(card).getByText(/80% outturn/)).toBeInTheDocument();
  });

  it("renders an empty state when no parchment lots are in the pipeline", async () => {
    getMillBoardMock.mockResolvedValue([]);
    render(await MillPage());
    expect(
      screen.getByText("No parchment lots in the mill pipeline"),
    ).toBeInTheDocument();
  });
});
