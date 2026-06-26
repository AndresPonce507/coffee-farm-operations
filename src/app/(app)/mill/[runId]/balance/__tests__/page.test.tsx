import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MillRunWorkspace } from "@/app/(app)/mill/[runId]/balance/data";

/**
 * P3-S8 — /mill/[runId]/balance, the closed mass-balance + machine-chain workspace.
 *
 * The page is a Server Component that reads the co-located port (it binds to the
 * authoritative v_milling_runs / mill_run_balance / mill_passes / mill_byproducts
 * surface the S8 migration shipped). Stub the port so the async page resolves with
 * no Supabase client, and stub the interactive island so this test pins the page's
 * one job: render the Sankey mass-balance gauge (forest-green ONLY when balance_ok),
 * the horizontal machine-chain rail, and the byproduct ledger — 404ing an unknown run.
 */
const { getMillRunWorkspaceMock } = vi.hoisted(() => ({
  getMillRunWorkspaceMock: vi.fn(),
}));
vi.mock("@/app/(app)/mill/[runId]/balance/data", () => ({
  getMillRunWorkspace: getMillRunWorkspaceMock,
}));
vi.mock(
  "@/app/(app)/mill/[runId]/balance/mass-balance-workspace.client",
  () => ({
    MassBalanceWorkspace: () => <div data-testid="mass-balance-workspace-stub" />,
  }),
);
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import MillBalancePage from "@/app/(app)/mill/[runId]/balance/page";

const BALANCED: MillRunWorkspace = {
  run: {
    runId: 712,
    parchmentLotCode: "JC-712",
    variety: "Geisha",
    parchmentKgIn: 1000,
    greenKgOut: 820,
    outturnPct: 0.82,
    status: "open",
    openedAt: "2026-06-24T10:00:00Z",
  },
  balance: {
    parchmentIn: 1000,
    sumPassOutput: 820,
    sumReject: 30,
    sumByproduct: 100,
    greenOut: 820,
    accountedMoistureLoss: 45,
    unaccountedLoss: 5,
    lossCeiling: 20,
    balanceOk: true,
  },
  passes: [
    {
      passNo: 1,
      machineKind: "huller",
      inputKg: 1000,
      outputKg: 880,
      rejectKg: 20,
      recordedAt: "2026-06-24T10:10:00Z",
    },
    {
      passNo: 2,
      machineKind: "polisher",
      inputKg: 880,
      outputKg: 850,
      rejectKg: 10,
      recordedAt: "2026-06-24T10:20:00Z",
    },
  ],
  byproducts: [
    {
      byproductLotCode: "JC-805",
      kind: "husk",
      kg: 80,
      recordedAt: "2026-06-24T10:25:00Z",
    },
    {
      byproductLotCode: "JC-806",
      kind: "chaff",
      kg: 20,
      recordedAt: "2026-06-24T10:26:00Z",
    },
  ],
};

const UNBALANCED: MillRunWorkspace = {
  ...BALANCED,
  balance: {
    ...BALANCED.balance!,
    unaccountedLoss: 180,
    lossCeiling: 20,
    balanceOk: false,
  },
};

const EMPTY: MillRunWorkspace = {
  run: { ...BALANCED.run, greenKgOut: null, outturnPct: null },
  balance: {
    parchmentIn: 1000,
    sumPassOutput: 0,
    sumReject: 0,
    sumByproduct: 0,
    greenOut: null,
    accountedMoistureLoss: 0,
    unaccountedLoss: 1000,
    lossCeiling: 20,
    balanceOk: false,
  },
  passes: [],
  byproducts: [],
};

const renderRun = (runId: string) =>
  MillBalancePage({ params: Promise.resolve({ runId }) });

beforeEach(() => getMillRunWorkspaceMock.mockReset());
afterEach(cleanup);

describe("/mill/[runId]/balance mass-balance workspace (smoke)", () => {
  it("renders the page heading and the parchment lot", async () => {
    getMillRunWorkspaceMock.mockResolvedValue(BALANCED);
    render(await renderRun("712"));
    expect(
      screen.getByRole("heading", { level: 1, name: "Mill Balance" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/JC-712/)).toBeInTheDocument();
  });

  it("renders the Sankey mass-balance gauge with each accounted stream", async () => {
    getMillRunWorkspaceMock.mockResolvedValue(BALANCED);
    render(await renderRun("712"));
    const gauge = screen.getByTestId("mass-balance-gauge");
    expect(within(gauge).getByTestId("mass-segment-green")).toBeInTheDocument();
    expect(
      within(gauge).getByTestId("mass-segment-byproduct"),
    ).toBeInTheDocument();
    expect(within(gauge).getByTestId("mass-segment-reject")).toBeInTheDocument();
    expect(
      within(gauge).getByTestId("mass-segment-moisture"),
    ).toBeInTheDocument();
  });

  it("reads forest-green BALANCED only when balance_ok is true", async () => {
    getMillRunWorkspaceMock.mockResolvedValue(BALANCED);
    render(await renderRun("712"));
    const gauge = screen.getByTestId("mass-balance-gauge");
    expect(gauge).toHaveAttribute("data-balance-ok", "true");
    expect(
      within(gauge).getByText(/Every kilo is accounted for/i),
    ).toBeInTheDocument();
  });

  it("flags an 18%-vanished run as NOT balanced and surfaces the unaccounted kg", async () => {
    getMillRunWorkspaceMock.mockResolvedValue(UNBALANCED);
    render(await renderRun("712"));
    const gauge = screen.getByTestId("mass-balance-gauge");
    expect(gauge).toHaveAttribute("data-balance-ok", "false");
    expect(within(gauge).getByText(/unaccounted/i)).toBeInTheDocument();
    expect(within(gauge).queryByText(/Every kilo is accounted/i)).toBeNull();
  });

  it("renders the horizontal machine-chain rail, one card per recorded pass in order", async () => {
    getMillRunWorkspaceMock.mockResolvedValue(BALANCED);
    render(await renderRun("712"));
    const pass1 = screen.getByTestId("mill-pass-1");
    const pass2 = screen.getByTestId("mill-pass-2");
    expect(within(pass1).getByText("Huller")).toBeInTheDocument();
    expect(within(pass2).getByText("Polisher")).toBeInTheDocument();
  });

  it("renders each byproduct as its own traceable lot row", async () => {
    getMillRunWorkspaceMock.mockResolvedValue(BALANCED);
    render(await renderRun("712"));
    const husk = screen.getByTestId("byproduct-JC-805");
    expect(within(husk).getByText("Husk")).toBeInTheDocument();
    expect(screen.getByTestId("byproduct-JC-806")).toBeInTheDocument();
  });

  it("mounts the interactive recorder island", async () => {
    getMillRunWorkspaceMock.mockResolvedValue(BALANCED);
    render(await renderRun("712"));
    expect(
      screen.getByTestId("mass-balance-workspace-stub"),
    ).toBeInTheDocument();
  });

  it("shows the empty state when no passes have been milled yet", async () => {
    getMillRunWorkspaceMock.mockResolvedValue(EMPTY);
    render(await renderRun("712"));
    expect(
      screen.getByText("Nothing milled on this run yet"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("mill-pass-1")).toBeNull();
  });

  it("404s when the run does not exist (never a fabricated run)", async () => {
    getMillRunWorkspaceMock.mockResolvedValue(null);
    await expect(renderRun("999")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("404s on a non-numeric run id", async () => {
    getMillRunWorkspaceMock.mockResolvedValue(null);
    await expect(renderRun("not-a-number")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
