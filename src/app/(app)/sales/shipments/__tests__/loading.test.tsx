import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import ShipmentsLoading from "@/app/(app)/sales/shipments/loading";
import ShipmentDetailLoading from "@/app/(app)/sales/shipments/[no]/loading";

afterEach(cleanup);

describe("/sales/shipments loading skeletons (smoke)", () => {
  it("board: renders an aria-busy placeholder without throwing", () => {
    render(<ShipmentsLoading />);
    expect(screen.getByLabelText("Loading shipments")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("detail: renders an aria-busy placeholder without throwing", () => {
    render(<ShipmentDetailLoading />);
    expect(screen.getByLabelText("Loading shipment")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });
});
