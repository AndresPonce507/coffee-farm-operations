import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// HarvestPlanner is an async Server Component; stub it so this test asserts the
// PAGE's job: the header + the planner section, wired in order.
vi.mock("@/components/sections/planning/harvest-planner", () => ({
  HarvestPlanner: () => <div data-testid="harvest-planner-stub" />,
}));

import PlanPage from "@/app/(app)/plan/page";
import PlanLoading from "@/app/(app)/plan/loading";

afterEach(cleanup);

describe("/plan page (smoke)", () => {
  it("renders the header above the planner section", () => {
    render(<PlanPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: /harvest plan/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("harvest-planner-stub")).toBeInTheDocument();
  });
});

describe("/plan loading skeleton (smoke)", () => {
  it("renders an aria-busy placeholder without throwing", () => {
    render(<PlanLoading />);
    expect(screen.getByLabelText(/loading harvest plan/i)).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });
});
