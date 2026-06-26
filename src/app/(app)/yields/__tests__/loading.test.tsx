import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import YieldsLoading from "@/app/(app)/yields/loading";

afterEach(cleanup);

describe("/yields loading skeleton (smoke)", () => {
  it("renders a busy, labelled placeholder while the board resolves", () => {
    render(<YieldsLoading />);
    const region = screen.getByLabelText("Loading yield reference");
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute("aria-busy", "true");
  });
});
