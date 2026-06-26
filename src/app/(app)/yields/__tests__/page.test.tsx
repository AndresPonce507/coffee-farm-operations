import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { YieldStageRow } from "@/app/(app)/yields/data";

// The board is a Server Component that reads the co-located yield-curve port (it
// binds to the authoritative `lot_yield_curve` reference the P3-S6 migration
// extended). Stub the port so the async page resolves without a Supabase client,
// pinning the page's ONE job: render every house yield factor as a glass card and
// surface the two new transform factors (mill outturn, roast shrinkage) as headline
// KPIs.
// Partial mock: stub ONLY the Supabase-touching read; the pure helpers
// (factorFor / classifyYield / cherryToGreenFactor) are deterministic and the page
// genuinely uses them, so they come from the real module.
const { getYieldCurveMock } = vi.hoisted(() => ({ getYieldCurveMock: vi.fn() }));
vi.mock("@/app/(app)/yields/data", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/app/(app)/yields/data")>();
  return { ...actual, getYieldCurve: getYieldCurveMock };
});

import YieldsPage from "@/app/(app)/yields/page";

// The canonical chain cherry → fermentation → drying → parchment → green → roasted,
// using the two direct transform factors P3-S6 seeds (parchment→green 0.80 dry-mill
// outturn, green→roasted 0.84 roast shrinkage).
const ROWS: YieldStageRow[] = [
  { fromStage: "cherry", toStage: "fermentation", yieldFactor: 0.95 },
  { fromStage: "fermentation", toStage: "drying", yieldFactor: 0.5 },
  { fromStage: "drying", toStage: "parchment", yieldFactor: 0.9 },
  { fromStage: "parchment", toStage: "green", yieldFactor: 0.8 },
  { fromStage: "green", toStage: "roasted", yieldFactor: 0.84 },
];

beforeEach(() => getYieldCurveMock.mockResolvedValue(ROWS));
afterEach(cleanup);

describe("/yields yield-reference board (smoke)", () => {
  it("renders the page heading", async () => {
    render(await YieldsPage());
    expect(
      screen.getByRole("heading", { level: 1, name: "Yield reference" }),
    ).toBeInTheDocument();
  });

  it("surfaces the dry-mill outturn (parchment → green = 80%) as a headline KPI", async () => {
    render(await YieldsPage());
    const kpi = screen.getByTestId("kpi-mill-outturn");
    expect(within(kpi).getByText("80%")).toBeInTheDocument();
  });

  it("surfaces the roast shrinkage (green → roasted, 16% lost) as a headline KPI", async () => {
    render(await YieldsPage());
    const kpi = screen.getByTestId("kpi-roast-shrinkage");
    expect(within(kpi).getByText("16%")).toBeInTheDocument();
  });

  it("renders a yield card for the new dry-mill transform with its flow and retained factor", async () => {
    render(await YieldsPage());
    const card = screen.getByTestId("yield-card-parchment-green");
    expect(within(card).getByText("Parchment → Green")).toBeInTheDocument();
    expect(within(card).getByText("80%")).toBeInTheDocument();
    // The new edge-kind is named on the card (mill / roast / byproduct legend).
    expect(within(card).getByText(/Dry mill/i)).toBeInTheDocument();
  });

  it("renders the roast transform card tagged as a roast edge", async () => {
    render(await YieldsPage());
    const card = screen.getByTestId("yield-card-green-roasted");
    expect(within(card).getByText("Green → Roasted")).toBeInTheDocument();
    // Exact match so the kind badge is asserted, not the "Roasted" in the flow.
    expect(within(card).getByText("Roast")).toBeInTheDocument();
  });

  it("renders the new-transform-edges legend (mill / roast / byproduct)", async () => {
    render(await YieldsPage());
    expect(screen.getByText("New transform edges")).toBeInTheDocument();
    // Byproduct has no yield-curve row of its own, but the schema now tracks it —
    // the legend states that honestly rather than fabricating a factor.
    expect(screen.getByText(/Byproduct/)).toBeInTheDocument();
  });

  it("renders the no-write outturn calculator island", async () => {
    render(await YieldsPage());
    expect(screen.getByTestId("yield-calculator")).toBeInTheDocument();
  });

  it("shows an empty state when no yield factors are on file", async () => {
    getYieldCurveMock.mockResolvedValue([]);
    render(await YieldsPage());
    expect(
      screen.getByText("No yield factors on file yet"),
    ).toBeInTheDocument();
  });
});
