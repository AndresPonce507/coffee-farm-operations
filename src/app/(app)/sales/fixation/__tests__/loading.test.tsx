import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import FixationLoading from "@/app/(app)/sales/fixation/loading";

afterEach(cleanup);

describe("/sales/fixation loading skeleton (smoke)", () => {
  it("renders an aria-busy placeholder without throwing", () => {
    render(<FixationLoading />);
    expect(screen.getByLabelText("Loading the fixation cockpit")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });
});
