import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import OrdersLoading from "@/app/(app)/orders/loading";

describe("/orders loading skeleton", () => {
  it("renders an aria-busy placeholder that mirrors the board shape", () => {
    render(<OrdersLoading />);
    const region = screen.getByLabelText("Loading orders");
    expect(region).toHaveAttribute("aria-busy", "true");
  });
});
