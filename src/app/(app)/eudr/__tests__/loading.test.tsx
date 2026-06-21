import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import EudrLoading from "@/app/(app)/eudr/loading";

afterEach(cleanup);

describe("/eudr loading skeleton (smoke)", () => {
  it("renders an aria-busy placeholder without throwing", () => {
    render(<EudrLoading />);
    expect(screen.getByLabelText("Loading EUDR")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });
});
