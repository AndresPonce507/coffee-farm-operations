import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Plot } from "@/lib/types";

// PlotHealthCard is an async Server Component that awaits getPlots.
// Mock the plots module so the smoke test renders against a known plot set.
vi.mock("@/lib/db/plots", () => ({
  getPlots: vi.fn(
    async (): Promise<Plot[]> => [
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
        id: "p3", name: "La Loma", block: "Block B", variety: "Caturra",
        areaHa: 2.9, altitudeMasl: 1520, trees: 9000, shadePct: 50,
        establishedYear: 2012, status: "watch", lastInspected: "2026-06-16",
        expectedYieldKg: 9000, harvestedKg: 3600,
      },
    ],
  ),
}));

import { PlotHealthCard } from "@/components/sections/dashboard/plot-health-card";

// vitest config has no globals, so RTL's auto afterEach(cleanup) isn't registered;
// register it explicitly so each test renders into a fresh document body.
afterEach(cleanup);

describe("PlotHealthCard (smoke)", () => {
  it("renders the card title and View-all link without throwing", async () => {
    const ui = await PlotHealthCard();
    render(ui);

    expect(screen.getByText("Plot health")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View all" })).toBeInTheDocument();
  });

  it("renders a row per plot with status badge and progress from the data layer", async () => {
    const ui = await PlotHealthCard();
    render(ui);

    expect(screen.getByText("Tizingal Alto")).toBeInTheDocument();
    expect(screen.getByText("Paso Ancho")).toBeInTheDocument();
    expect(screen.getByText("La Loma")).toBeInTheDocument();
    // Problems-first ordering surfaces the at-risk badge.
    expect(screen.getByText("At risk")).toBeInTheDocument();
    // Paso Ancho progress = round(4100 / 12600 * 100) = 33% → "33%".
    expect(screen.getByText("33%")).toBeInTheDocument();
  });

  it("wires each plot row to its plot dossier (no dead UI)", async () => {
    const ui = await PlotHealthCard();
    render(ui);

    // Each entity-bearing row is now a real <a href> to /plots/[id].
    const tizingal = screen.getByText("Tizingal Alto").closest("a");
    expect(tizingal).not.toBeNull();
    expect(tizingal).toHaveAttribute("href", "/plots/p1");

    const pasoAncho = screen.getByText("Paso Ancho").closest("a");
    expect(pasoAncho).toHaveAttribute("href", "/plots/p2");
  });
});
