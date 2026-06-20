import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Plot } from "@/lib/types";

import { PlotsExplorer } from "@/components/sections/plots/plots-explorer";

// Mixed varieties so the per-variety filter chips render alongside "All".
const plots: Plot[] = [
  {
    id: "p1", name: "Tizingal Alto", block: "Block A", variety: "Geisha",
    areaHa: 4.2, altitudeMasl: 1690, trees: 14800, shadePct: 55,
    establishedYear: 2014, status: "healthy", lastInspected: "2026-06-18",
    expectedYieldKg: 18600, harvestedKg: 12120,
  },
  {
    id: "p2", name: "Paso Ancho", block: "Block C", variety: "Pacamara",
    areaHa: 3.7, altitudeMasl: 1450, trees: 11200, shadePct: 44,
    establishedYear: 2017, status: "at-risk", lastInspected: "2026-06-15",
    expectedYieldKg: 12600, harvestedKg: 4100,
  },
  {
    id: "p3", name: "El Mirador", block: "Block B", variety: "Caturra",
    areaHa: 2.9, altitudeMasl: 1580, trees: 9800, shadePct: 48,
    establishedYear: 2019, status: "watch", lastInspected: "2026-06-16",
    expectedYieldKg: 9400, harvestedKg: 3200,
  },
];

describe("PlotsExplorer (smoke)", () => {
  it("renders the explorer and variety filter without throwing", () => {
    render(<PlotsExplorer plots={plots} />);

    // The "All" filter chip is always present (button label includes its count).
    expect(
      screen.getByRole("button", { name: /All/ }),
    ).toBeInTheDocument();
    // Per-variety filter chips render off the mixed mock data.
    expect(screen.getByRole("button", { name: /Geisha/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pacamara/ })).toBeInTheDocument();
    // Grid is the default view → each plot card renders its name heading.
    expect(
      screen.getByRole("heading", { name: "Tizingal Alto" }),
    ).toBeInTheDocument();
  });

  it("shows the result count for the rendered plots", () => {
    render(<PlotsExplorer plots={plots} />);

    // The "Showing N plots" summary line reflects all 3 plots. The line is split
    // across nested spans, so locate the paragraph and assert its normalized text.
    const summary = screen
      .getAllByText(/Showing/, { selector: "p" })
      .find((el) => el.textContent?.replace(/\s+/g, " ").trim() === "Showing 3 plots.");
    expect(summary).toBeDefined();
  });
});
