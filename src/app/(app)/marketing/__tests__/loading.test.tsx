import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import MarketingLoading from "@/app/(app)/marketing/loading";

afterEach(cleanup);

describe("/marketing loading skeleton (smoke)", () => {
  it("renders an aria-busy placeholder without throwing", () => {
    render(<MarketingLoading />);
    expect(screen.getByLabelText("Loading marketing")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });
});
