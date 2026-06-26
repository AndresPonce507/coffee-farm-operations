import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import MarginsLoading from "@/app/(app)/margins/loading";

afterEach(cleanup);

describe("/margins loading skeleton (smoke)", () => {
  it("renders an aria-busy placeholder without throwing", () => {
    render(<MarginsLoading />);
    expect(screen.getByLabelText("Loading margins")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });
});
