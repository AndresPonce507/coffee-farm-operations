import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MillRunFinalizeView } from "@/app/(app)/mill/[runId]/data";

// The finalize page is a Server Component. Stub the co-located read port + the two
// client islands so this test pins the SERVER page's job: render the run header, the
// closed mass-balance breakdown with the right balanced/unbalanced verdict, and route
// to the correct surface per run status (finalize form when open, minted result +
// re-grade when finalized, blocked empty-state when readiness is still pending).
const { getMillRunFinalizeMock } = vi.hoisted(() => ({
  getMillRunFinalizeMock: vi.fn(),
}));
vi.mock("@/app/(app)/mill/[runId]/data", () => ({
  getMillRunFinalize: getMillRunFinalizeMock,
}));
vi.mock("@/app/(app)/mill/[runId]/finalize-panel.client", () => ({
  FinalizePanel: () => <div data-testid="finalize-panel-stub" />,
  RegradePanel: () => <div data-testid="regrade-panel-stub" />,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import FinalizeRunPage from "@/app/(app)/mill/[runId]/page";

const BALANCED = {
  parchmentIn: 100,
  sumPassOutput: 82,
  sumReject: 3,
  sumByproduct: 12,
  greenOut: 82,
  accountedMoistureLoss: 2,
  unaccountedLoss: 1,
  lossCeiling: 2,
  balanceOk: true,
};

const OPEN_BALANCED: MillRunFinalizeView = {
  runId: 7,
  parchmentLotCode: "JC-310",
  variety: "Geisha",
  parchmentKgIn: 100,
  greenKgOut: null,
  outturnPct: null,
  status: "open",
  openedAt: "2026-06-20T10:00:00Z",
  balance: BALANCED,
  mintedGreenLotCode: null,
  grade: null,
};

const OPEN_UNBALANCED: MillRunFinalizeView = {
  ...OPEN_BALANCED,
  greenKgOut: null,
  balance: {
    ...BALANCED,
    greenOut: 64,
    sumByproduct: 0,
    sumReject: 0,
    unaccountedLoss: 18,
    balanceOk: false,
  },
};

const FINALIZED: MillRunFinalizeView = {
  runId: 8,
  parchmentLotCode: "JC-311",
  variety: "Caturra",
  parchmentKgIn: 2000,
  greenKgOut: 1640,
  outturnPct: 0.82,
  status: "finalized",
  openedAt: "2026-06-20T10:00:00Z",
  balance: { ...BALANCED, parchmentIn: 2000, greenOut: 1640 },
  mintedGreenLotCode: "JC-742",
  grade: {
    cat1Defects: 0,
    cat2Defects: 3,
    screenSize: 17,
    scaPrep: "EP-Specialty",
    gradedAt: "2026-06-21T09:00:00Z",
  },
};

const PENDING: MillRunFinalizeView = {
  ...OPEN_BALANCED,
  runId: 9,
  status: "readiness_pending",
  balance: null,
};

const renderRun = (runId: string) =>
  FinalizeRunPage({ params: Promise.resolve({ runId }) });

afterEach(cleanup);
beforeEach(() => getMillRunFinalizeMock.mockReset());

describe("/mill/[runId] finalize (smoke)", () => {
  it("renders the run header + the closed mass balance and mounts the finalize form on an OPEN run", async () => {
    getMillRunFinalizeMock.mockResolvedValue(OPEN_BALANCED);
    render(await renderRun("7"));

    expect(
      screen.getByRole("heading", { level: 1, name: /Finalize run #7/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Parchment lot JC-310/)).toBeInTheDocument();

    const balance = screen.getByTestId("mass-balance");
    expect(within(balance).getByText("Balanced")).toBeInTheDocument();
    expect(within(balance).queryByText("Unbalanced")).not.toBeInTheDocument();

    // open → the finalize form mounts; no minted result, no re-grade.
    expect(screen.getByTestId("finalize-panel-stub")).toBeInTheDocument();
    expect(screen.queryByTestId("regrade-panel-stub")).not.toBeInTheDocument();
    expect(screen.queryByTestId("finalize-result")).not.toBeInTheDocument();
  });

  it("flags the mass balance UNBALANCED so the operator sees the weight-loss mystery before minting", async () => {
    getMillRunFinalizeMock.mockResolvedValue(OPEN_UNBALANCED);
    render(await renderRun("7"));

    const balance = screen.getByTestId("mass-balance");
    expect(within(balance).getByText("Unbalanced")).toBeInTheDocument();
    expect(within(balance).queryByText("Balanced")).not.toBeInTheDocument();
    // the form still mounts — the DB is the real wall; the UI just disables the mint.
    expect(screen.getByTestId("finalize-panel-stub")).toBeInTheDocument();
  });

  it("shows the minted green lot + auto-grade and the re-grade control on a FINALIZED run", async () => {
    getMillRunFinalizeMock.mockResolvedValue(FINALIZED);
    render(await renderRun("8"));

    const result = screen.getByTestId("finalize-result");
    expect(within(result).getByText("Green lot minted")).toBeInTheDocument();
    expect(within(result).getByText(/JC-742/)).toBeInTheDocument();
    expect(within(result).getByText(/EP-Specialty/)).toBeInTheDocument();

    // finalized → the re-grade island mounts, the finalize form does NOT.
    expect(screen.getByTestId("regrade-panel-stub")).toBeInTheDocument();
    expect(screen.queryByTestId("finalize-panel-stub")).not.toBeInTheDocument();
  });

  it("blocks finalize behind an empty-state when readiness is still pending", async () => {
    getMillRunFinalizeMock.mockResolvedValue(PENDING);
    render(await renderRun("9"));

    expect(screen.getByText("Readiness gate not cleared")).toBeInTheDocument();
    expect(screen.queryByTestId("finalize-panel-stub")).not.toBeInTheDocument();
    expect(screen.queryByTestId("finalize-result")).not.toBeInTheDocument();
  });

  it("404s on an unknown run id (never a fabricated run)", async () => {
    getMillRunFinalizeMock.mockResolvedValue(null);
    await expect(renderRun("404")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("404s on a non-numeric run id WITHOUT hitting the database", async () => {
    await expect(renderRun("not-a-number")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getMillRunFinalizeMock).not.toHaveBeenCalled();
  });
});
