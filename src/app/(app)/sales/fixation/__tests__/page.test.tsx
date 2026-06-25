import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FixationLine } from "@/app/(app)/sales/fixation/data";

// The fixation cockpit is a Server Component reading the co-located port (it binds to
// v_fixation_cockpit, which by construction holds ONLY un-fixed differential lines —
// reserve lots are off the C and never appear). Stub the port + the per-line client
// island so this test pins the page's job: render each open differential line as a
// card carrying the live C + implied price.
const { getFixationCockpitMock } = vi.hoisted(() => ({
  getFixationCockpitMock: vi.fn(),
}));
vi.mock("@/app/(app)/sales/fixation/data", () => ({
  getFixationCockpit: getFixationCockpitMock,
}));
vi.mock("@/app/(app)/sales/fixation/fix-line.client", () => ({
  FixLine: () => <div data-testid="fix-line-stub" />,
}));

import FixationPage from "@/app/(app)/sales/fixation/page";

const READY: FixationLine = {
  contractLineId: 11,
  contractId: 1,
  contractNo: "JC-K-0002",
  greenLotCode: "JC-310",
  kg: 2000,
  differentialCents: 35,
  iceCMonth: "DEC25",
  currentCPrice: 1.85,
  impliedUnitPrice: 4.85,
};

const NO_MARK: FixationLine = {
  contractLineId: 12,
  contractId: 1,
  contractNo: "JC-K-0002",
  greenLotCode: "JC-311",
  kg: 1000,
  differentialCents: 40,
  iceCMonth: "MAR26",
  currentCPrice: null,
  impliedUnitPrice: null,
};

beforeEach(() => getFixationCockpitMock.mockResolvedValue([READY, NO_MARK]));
afterEach(cleanup);

describe("/sales/fixation cockpit (smoke)", () => {
  it("renders the page heading", async () => {
    render(await FixationPage());
    expect(
      screen.getByRole("heading", { level: 1, name: "Fixation" }),
    ).toBeInTheDocument();
  });

  it("renders a card per un-fixed differential line with its contract and lot", async () => {
    render(await FixationPage());
    const card = screen.getByTestId("fix-card-11");
    expect(within(card).getByText(/JC-K-0002/)).toBeInTheDocument();
    expect(within(card).getByText("JC-310")).toBeInTheDocument();
  });

  it("shows a no-mark notice on a line whose C month has no mark yet", async () => {
    render(await FixationPage());
    const card = screen.getByTestId("fix-card-12");
    expect(
      within(card).getByText("No C mark for this month yet"),
    ).toBeInTheDocument();
  });

  it("renders exactly the lines the cockpit view returns (reserve lots are excluded upstream, never fabricated)", async () => {
    render(await FixationPage());
    // v_fixation_cockpit holds ONLY un-fixed differential lines — the page renders
    // exactly what it returns, never a reserve card and never a duplicate.
    expect(screen.getAllByTestId(/^fix-card-/)).toHaveLength(2);
  });

  it("shows an empty state when nothing is awaiting a fix", async () => {
    getFixationCockpitMock.mockResolvedValue([]);
    render(await FixationPage());
    expect(screen.getByText("Nothing to fix right now")).toBeInTheDocument();
  });
});
