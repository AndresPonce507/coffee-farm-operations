import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ReadinessList } from "@/components/sections/planning/readiness-list";
import type { PlotReadiness } from "@/lib/types";

afterEach(cleanup);

const ready: PlotReadiness = {
  plotId: "p-cuesta-piedra",
  plotName: "Cuesta de Piedra",
  variety: "Catuaí",
  altitudeMasl: 1360,
  bloomDate: "2026-01-15",
  gddAccumulated: 2200,
  gddToCherry: 2200,
  ndviLatest: 0.72,
  recentRipenessPct: 94,
  readiness: 0.96,
  confidence: "high",
  staggerDays: 0,
  predictedReadyDate: "2026-04-01",
};

const early: PlotReadiness = {
  plotId: "p-las-lagunas",
  plotName: "Las Lagunas",
  variety: "Geisha",
  altitudeMasl: 1700,
  bloomDate: null,
  gddAccumulated: 400,
  gddToCherry: 2200,
  ndviLatest: null,
  recentRipenessPct: null,
  readiness: 0.18,
  confidence: "low",
  staggerDays: 13.6,
  predictedReadyDate: null,
};

describe("ReadinessList (render/smoke)", () => {
  it("renders a row per plot with its name and a readiness meter", () => {
    render(<ReadinessList rows={[ready, early]} />);
    expect(screen.getByText("Cuesta de Piedra")).toBeInTheDocument();
    expect(screen.getByText("Las Lagunas")).toBeInTheDocument();
    // each row exposes its derived readiness via a progressbar (accessible).
    const meters = screen.getAllByRole("progressbar");
    expect(meters.length).toBe(2);
  });

  it("surfaces the readiness as an accessible aria-valuenow (derived, 0–100)", () => {
    render(<ReadinessList rows={[ready]} />);
    const meter = screen.getByRole("progressbar");
    expect(meter).toHaveAttribute("aria-valuenow", "96");
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "100");
  });

  it("shows the altitude (the gradient stagger) and the honest confidence note", () => {
    render(<ReadinessList rows={[early]} />);
    expect(screen.getByText(/1,?700/)).toBeInTheDocument();
    // low-confidence is shown, never hidden.
    expect(screen.getByText(/low confidence/i)).toBeInTheDocument();
  });

  it("shows an honest unknown when there is no predicted ready date", () => {
    render(<ReadinessList rows={[early]} />);
    const row = screen.getByTestId("readiness-p-las-lagunas");
    expect(within(row).getByText(/no bloom logged.*date unknown/i)).toBeInTheDocument();
  });

  it("formats the predicted ready date for humans, never the raw ISO string", () => {
    render(<ReadinessList rows={[ready]} />);
    const row = screen.getByTestId("readiness-p-cuesta-piedra");
    // human-readable, matching the app-wide longDate() convention (en-US)
    expect(within(row).getByText(/Apr 1, 2026/)).toBeInTheDocument();
    // the machine ISO string must never reach the card
    expect(within(row).queryByText(/2026-04-01/)).toBeNull();
  });

  it("renders an empty state when there are no plots", () => {
    render(<ReadinessList rows={[]} />);
    expect(screen.getByTestId("readiness-empty")).toBeInTheDocument();
  });

  it("wires each plot card to its plot dossier (no dead UI) — card wraps an EntityLink", () => {
    render(<ReadinessList rows={[ready, early]} />);
    const links = screen.getAllByRole("link");
    const hrefs = links.map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/plots/p-cuesta-piedra");
    expect(hrefs).toContain("/plots/p-las-lagunas");
  });

  it("plot name heading is navigable — rendered inside the EntityLink anchor", () => {
    render(<ReadinessList rows={[ready]} />);
    // EntityLink sets aria-label="Abrir parcela <name>" — human plotName, not slug.
    // WCAG 2.5.3: the accessible name must contain the visible label.
    const link = screen.getByRole("link", { name: /abrir parcela Cuesta de Piedra/i });
    expect(link).toHaveAttribute("href", "/plots/p-cuesta-piedra");
    // the card is nested inside the link
    expect(within(link).getByTestId("readiness-p-cuesta-piedra")).toBeInTheDocument();
  });

  it("links every card — each row has its own plot href", () => {
    render(<ReadinessList rows={[ready, early]} />);
    const links = screen.getAllByRole("link");
    const hrefs = links.map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/plots/p-cuesta-piedra");
    expect(hrefs).toContain("/plots/p-las-lagunas");
  });
});
