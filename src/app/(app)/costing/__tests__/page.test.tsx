import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// CostingSummary + CostLotList are async Server Components; RTL can't resolve
// nested async server components in one synchronous render (the codebase tests
// each section on its own). Stub them to sync markers so this test asserts the
// PAGE'S job: header + the summary strip + the per-lot list, wired in order.
vi.mock("@/components/sections/costing/costing-summary", () => ({
  CostingSummary: () => <div data-testid="costing-summary-stub" />,
}));
vi.mock("@/components/sections/costing/cost-lot-list", () => ({
  CostLotList: () => <div data-testid="cost-lot-list-stub" />,
}));

import CostingPage from "@/app/(app)/costing/page";

afterEach(cleanup);

describe("/costing page (smoke)", () => {
  it("renders the header and composes the summary strip above the lot list", () => {
    render(<CostingPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Costing" }),
    ).toBeInTheDocument();

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
