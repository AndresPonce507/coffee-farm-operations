import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import PosLoading from "@/app/(app)/pos/loading";

afterEach(cleanup);

describe("/pos loading skeleton", () => {
  it("renders an aria-busy placeholder mirroring the board shape", () => {
    render(<PosLoading />);
    const region = screen.getByLabelText("Loading the register");
    expect(region).toHaveAttribute("aria-busy", "true");
  });
});
