import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import SamplesLoading from "@/app/(app)/sales/samples/loading";

afterEach(cleanup);

describe("/sales/samples loading skeleton (smoke)", () => {
  it("renders an aria-busy placeholder without throwing", () => {
    render(<SamplesLoading />);
    expect(screen.getByLabelText("Loading samples")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });
});
