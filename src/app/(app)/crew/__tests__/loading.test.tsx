import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import CrewLoading from "@/app/(app)/crew/loading";

afterEach(cleanup);

describe("/crew loading skeleton (smoke)", () => {
  it("renders an aria-busy placeholder without throwing", () => {
    render(<CrewLoading />);
    expect(screen.getByLabelText("Loading crew")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("matches the real CrewSummary's responsive grid so the layout never shifts on mobile", () => {
    const { container } = render(<CrewLoading />);
    // The summary strip is the only `gap-px` grid in the skeleton.
    const summaryStrip = container.querySelector(".gap-px");
    expect(summaryStrip).not.toBeNull();
    // Mobile stacks to one column, 3-up from `sm` — mirroring crew-summary.tsx
    // (`grid grid-cols-1 ... sm:grid-cols-3`) so there is no reflow when data lands.
    expect(summaryStrip?.className).toContain("grid-cols-1");
    expect(summaryStrip?.className).toContain("sm:grid-cols-3");
  });
});
