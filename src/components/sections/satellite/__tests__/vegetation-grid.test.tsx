import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { VegetationGrid } from "@/components/sections/satellite/vegetation-grid";
import type { PlotVegetation } from "@/lib/types";

/**
 * Render/smoke test for the NDVI/SAR vegetation health grid (P2-S12). The
 * differentiator is HONESTY: the confidence badge is a first-class, always-visible
 * UI state — a SAR-fallback "medium" and a no-signal "low" are surfaced plainly,
 * never hidden behind a blank tile. These tests pin that the cloud is legible.
 */

afterEach(cleanup);

const highOptical: PlotVegetation = {
  plotId: "p-cuesta-piedra",
  plotName: "Cuesta de Piedra",
  variety: "Catuaí",
  altitudeMasl: 1360,
  value: 0.78,
  indexKind: "ndvi",
  confidence: "high",
  basis: "optical",
  cloudPct: 5,
  observedAt: "2026-06-20T12:00:00Z",
};

const sarMedium: PlotVegetation = {
  plotId: "p-talamanca",
  plotName: "Talamanca",
  variety: "Caturra",
  altitudeMasl: 1520,
  value: 0.61,
  indexKind: "sar-backscatter",
  confidence: "medium",
  basis: "sar",
  cloudPct: 0,
  observedAt: "2026-06-20T12:00:00Z",
};

const noSignal: PlotVegetation = {
  plotId: "p-las-lagunas",
  plotName: "Las Lagunas",
  variety: "Geisha",
  altitudeMasl: 1700,
  value: null,
  indexKind: null,
  confidence: "low",
  basis: "optical",
  cloudPct: null,
  observedAt: null,
};

describe("VegetationGrid (render/smoke)", () => {
  it("renders a tile per plot with its name", () => {
    render(<VegetationGrid rows={[highOptical, sarMedium, noSignal]} />);
    expect(screen.getByText("Cuesta de Piedra")).toBeInTheDocument();
    expect(screen.getByText("Talamanca")).toBeInTheDocument();
    expect(screen.getByText("Las Lagunas")).toBeInTheDocument();
  });

  it("surfaces a HIGH-confidence optical read with its value", () => {
    render(<VegetationGrid rows={[highOptical]} />);
    const tile = screen.getByTestId("veg-p-cuesta-piedra");
    expect(within(tile).getByText(/high/i)).toBeInTheDocument();
  });

  it("makes the SAR fallback HONEST — a 'radar' / 'medium' badge is shown, not hidden", () => {
    render(<VegetationGrid rows={[sarMedium]} />);
    const tile = screen.getByTestId("veg-p-talamanca");
    // the badge plainly names the radar basis + the medium confidence
    expect(within(tile).getByText(/radar · medium/i)).toBeInTheDocument();
  });

  it("a no-signal plot is honestly LOW confidence (never a fabricated value)", () => {
    render(<VegetationGrid rows={[noSignal]} />);
    const tile = screen.getByTestId("veg-p-las-lagunas");
    expect(within(tile).getByText(/low/i)).toBeInTheDocument();
    // no fabricated NDVI value — the honest unknown state
    expect(within(tile).queryByText(/0\.\d/)).not.toBeInTheDocument();
  });

  it("renders an empty state when there are no plots", () => {
    render(<VegetationGrid rows={[]} />);
    expect(screen.getByTestId("vegetation-empty")).toBeInTheDocument();
  });

  it("wires each plot card to its plot dossier vegetation section (no dead UI)", () => {
    render(<VegetationGrid rows={[highOptical]} />);
    // the formerly-COSMETIC card is now an entity link to the plot dossier,
    // deep-linked to its satellite/vegetation section. The card tile is nested
    // inside that link.
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/plots/p-cuesta-piedra#vegetation");
    expect(within(link).getByTestId("veg-p-cuesta-piedra")).toBeInTheDocument();
  });

  it("links every card — a SAR-fallback and a no-signal plot drill in too", () => {
    render(<VegetationGrid rows={[sarMedium, noSignal]} />);
    const hrefs = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/plots/p-talamanca#vegetation");
    expect(hrefs).toContain("/plots/p-las-lagunas#vegetation");
  });
});
