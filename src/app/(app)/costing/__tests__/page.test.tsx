import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// CostingSummary + CostLotList are async Server Components; RTL can't resolve
// nested async server components in one synchronous render (the codebase tests
// each section on its own). Stub them to sync markers so this test asserts the
// PAGE'S job: header + the WRITE affordance + the summary strip + the per-lot
// list, wired in order. BookCostButton is a client component (uses a Dialog) —
// stub it to a marker too. The lot/plot read ports are stubbed so the async
// page resolves without a Supabase client.
vi.mock("@/components/sections/costing/costing-summary", () => ({
  CostingSummary: () => <div data-testid="costing-summary-stub" />,
}));
vi.mock("@/components/sections/costing/cost-lot-list", () => ({
  CostLotList: () => <div data-testid="cost-lot-list-stub" />,
}));
vi.mock("@/components/sections/costing/cost-entry-form", () => ({
  BookCostButton: () => <div data-testid="book-cost-button-stub" />,
}));
// The page feeds the form the GREEN-REACHABLE target lists (not the raw
// lots/plots), so a cost can never be booked onto a COGS-orphan target.
vi.mock("@/lib/db/cogs", () => ({
  getGreenReachableLots: () => Promise.resolve(["JC-701", "JC-702"]),
  getGreenReachablePlots: () =>
    Promise.resolve([{ id: "plot-A", name: "Tizingal Alto" }]),
}));

import CostingPage from "@/app/(app)/costing/page";

afterEach(cleanup);

describe("/costing page (smoke)", () => {
  it("renders the header, the book-cost affordance, and the summary strip above the lot list", async () => {
    // CostingPage is an async Server Component — resolve it to its element tree.
    render(await CostingPage());

    expect(
      screen.getByRole("heading", { level: 1, name: "Costing" }),
    ).toBeInTheDocument();

    expect(screen.getByTestId("book-cost-button-stub")).toBeInTheDocument();

    const summary = screen.getByTestId("costing-summary-stub");
    const list = screen.getByTestId("cost-lot-list-stub");
    expect(summary).toBeInTheDocument();
    expect(list).toBeInTheDocument();
    // Summary strip sits above the per-lot list (the headline before the detail).
    expect(
      summary.compareDocumentPosition(list) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
