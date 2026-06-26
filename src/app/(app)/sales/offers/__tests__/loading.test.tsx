import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import OffersLoading from "@/app/(app)/sales/offers/loading";

afterEach(cleanup);

describe("/sales/offers loading skeleton (smoke)", () => {
  it("renders an aria-busy placeholder without throwing", () => {
    render(<OffersLoading />);
    expect(screen.getByLabelText("Loading the offer board")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });
});
