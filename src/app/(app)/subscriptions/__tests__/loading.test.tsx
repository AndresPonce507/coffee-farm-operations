import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import SubscriptionsLoading from "@/app/(app)/subscriptions/loading";

describe("/subscriptions loading skeleton", () => {
  it("renders an aria-busy placeholder that mirrors the board shape", () => {
    render(<SubscriptionsLoading />);
    const region = screen.getByLabelText("Loading subscriptions");
    expect(region).toHaveAttribute("aria-busy", "true");
  });
});
