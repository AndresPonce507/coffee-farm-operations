import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import CostingLoading from "@/app/(app)/costing/loading";

afterEach(cleanup);

describe("/costing loading skeleton (smoke)", () => {
  it("renders an aria-busy placeholder without throwing", () => {
    render(<CostingLoading />);
    expect(
      screen.getByLabelText("Loading costing"),
    ).toHaveAttribute("aria-busy", "true");
  });
});
