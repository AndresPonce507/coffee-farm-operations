import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import ShopLoading from "@/app/(app)/shop/loading";

afterEach(cleanup);

describe("/shop loading skeleton (smoke)", () => {
  it("renders an aria-busy placeholder without throwing", () => {
    render(<ShopLoading />);
    expect(screen.getByLabelText("Loading the storefront catalog")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });
});
