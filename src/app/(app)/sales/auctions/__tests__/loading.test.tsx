import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import AuctionsLoading from "@/app/(app)/sales/auctions/loading";
import AuctionDetailLoading from "@/app/(app)/sales/auctions/[id]/loading";

afterEach(cleanup);

describe("/sales/auctions loading skeletons (smoke)", () => {
  it("board: renders an aria-busy placeholder without throwing", () => {
    render(<AuctionsLoading />);
    expect(screen.getByLabelText("Loading auctions")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("detail: renders an aria-busy placeholder without throwing", () => {
    render(<AuctionDetailLoading />);
    expect(screen.getByLabelText("Loading auction")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });
});
