import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import PlotDossierLoading from "@/app/(app)/plots/[id]/loading";

describe("/plots/[id] loading skeleton", () => {
  it("mounts a pure animate-pulse glass skeleton with no throw", () => {
    const { container } = render(<PlotDossierLoading />);

    // The whole skeleton is decorative — hidden from the a11y tree.
    const root = container.firstElementChild as HTMLElement;
    expect(root).toBeTruthy();
    expect(root).toHaveAttribute("aria-hidden", "true");
    expect(root.className).toContain("animate-pulse");

    // It renders the forest hairline divider + at least one glass-card section
    // placeholder (so the streamed dossier doesn't pop into empty space).
    expect(container.querySelectorAll(".glass-card").length).toBeGreaterThan(0);
    expect(
      container.querySelector(".bg-gradient-to-r"),
    ).toBeInTheDocument();
  });
});
