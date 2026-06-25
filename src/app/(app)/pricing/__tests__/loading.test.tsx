import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import PricingLoading from "@/app/(app)/pricing/loading";
import ComposerLoading from "@/app/(app)/pricing/[lot]/loading";

afterEach(cleanup);

describe("/pricing loading skeletons (smoke)", () => {
  it("board: renders an aria-busy placeholder without throwing", () => {
    render(<PricingLoading />);
    expect(screen.getByLabelText("Loading price book")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("composer: renders an aria-busy placeholder without throwing", () => {
    render(<ComposerLoading />);
    expect(screen.getByLabelText("Loading quote composer")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });
});
