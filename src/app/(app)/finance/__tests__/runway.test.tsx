import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CashRunway, Preharvest } from "@/app/(app)/finance/data";

const { getCashRunwayMock, getPreharvestMock } = vi.hoisted(() => ({
  getCashRunwayMock: vi.fn(),
  getPreharvestMock: vi.fn(),
}));
vi.mock("@/app/(app)/finance/data", () => ({
  getCashRunway: getCashRunwayMock,
  getPreharvest: getPreharvestMock,
}));

import RunwayPage from "@/app/(app)/finance/runway/page";

const RUNWAY: CashRunway = {
  arOutstandingUsd: 42000,
  committedCostUsd: 18000,
  netPositionUsd: 24000,
};

const PREHARVEST: Preharvest = {
  presoldKg: 1200,
  activePorObraContracts: 4,
  indicativeLaborRateUsd: 9000,
};

beforeEach(() => {
  getCashRunwayMock.mockResolvedValue(RUNWAY);
  getPreharvestMock.mockResolvedValue(PREHARVEST);
});
afterEach(cleanup);

describe("/finance/runway (smoke)", () => {
  it("renders the page heading", async () => {
    render(await RunwayPage());
    expect(
      screen.getByRole("heading", { level: 1, name: "Cash runway" }),
    ).toBeInTheDocument();
  });

  it("nets AR due against committed cost", async () => {
    render(await RunwayPage());
    expect(screen.getByText("$42,000")).toBeInTheDocument();
    expect(screen.getByText("$24,000")).toBeInTheDocument();
  });

  it("surfaces the pre-harvest financing gap (pre-sold vs labour)", async () => {
    render(await RunwayPage());
    const pre = screen.getByTestId("preharvest");
    expect(within(pre).getByText(/1,200 kg/)).toBeInTheDocument();
    expect(within(pre).getByText("4")).toBeInTheDocument();
  });
});
