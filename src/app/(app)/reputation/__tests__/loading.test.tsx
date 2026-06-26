import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import ReputationLoading from "@/app/(app)/reputation/loading";
import LotReputationLoading from "@/app/(app)/reputation/[lot]/loading";

afterEach(cleanup);

describe("/reputation loading skeletons (smoke)", () => {
  it("wall: renders an aria-busy placeholder without throwing", () => {
    render(<ReputationLoading />);
    expect(screen.getByLabelText("Loading the wall of fame")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("detail: renders an aria-busy placeholder without throwing", () => {
    render(<LotReputationLoading />);
    expect(
      screen.getByLabelText("Loading the reputation ledger"),
    ).toHaveAttribute("aria-busy", "true");
  });
});
