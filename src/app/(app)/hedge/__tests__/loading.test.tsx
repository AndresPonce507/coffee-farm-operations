import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import HedgeLoading from "@/app/(app)/hedge/loading";

afterEach(cleanup);

describe("/hedge loading skeleton (smoke)", () => {
  it("renders an aria-busy placeholder without throwing", () => {
    render(<HedgeLoading />);
    expect(
      screen.getByLabelText("Loading the hedge fixation cockpit"),
    ).toHaveAttribute("aria-busy", "true");
  });
});
