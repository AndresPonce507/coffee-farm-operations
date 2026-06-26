import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import FinanceLoading from "@/app/(app)/finance/loading";

afterEach(cleanup);

describe("/finance loading skeleton", () => {
  it("exposes an aria-busy region with the cockpit loading label", () => {
    render(<FinanceLoading />);
    const region = screen.getByLabelText("Loading finance cockpit");
    expect(region).toHaveAttribute("aria-busy", "true");
  });
});
