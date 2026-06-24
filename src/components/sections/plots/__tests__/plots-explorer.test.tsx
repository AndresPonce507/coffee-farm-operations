import { fireEvent, render, screen } from "@testing-library/react";
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
    // The name now nests inside an EntityLink (es-PA aria-label), so assert by
    // visible text rather than the heading's accessible name.
    expect(screen.getByText("Tizingal Alto")).toBeInTheDocument();
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

  // Phase 5 D2 — formerly-COSMETIC grid card names now drill into /plots/[id].
  it("links each grid plot card name to its plot dossier", () => {
    render(<PlotsExplorer plots={plots} />);
    // EntityLink receives `name` so aria-label is "Open plot <plot.name>" (localized, human name,
    // not raw id) — far richer for es-PA screen readers per the updated EntityLink contract.
    const link = screen.getByRole("link", { name: /open plot tizingal alto/i });
    expect(link).toHaveAttribute("href", "/plots/p1");
    expect(link).toHaveTextContent("Tizingal Alto");
  });

  // Phase 5 D2 — the list view plot rows are dossier links too.
  it("links each list plot row name to its plot dossier", () => {
    render(<PlotsExplorer plots={plots} />);
    // Switch to list view.
    const listToggle = screen.getByRole("button", { name: /^List$/ });
    fireEvent.click(listToggle);
    // aria-label is "Open plot <plot.name>" (localized, human name, not raw id).
    const link = screen.getByRole("link", { name: /open plot paso ancho/i });
    expect(link).toHaveAttribute("href", "/plots/p2");
    expect(link).toHaveTextContent("Paso Ancho");
  });
});
