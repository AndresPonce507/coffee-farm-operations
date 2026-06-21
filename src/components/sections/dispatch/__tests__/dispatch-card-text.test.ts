import { describe, expect, it } from "vitest";

import {
  renderDispatchCardText,
  renderDispatchCardTitle,
} from "@/components/sections/dispatch/dispatch-card-text";
import type { DispatchCard, DispatchPlot } from "@/lib/types";

function plot(overrides: Partial<DispatchPlot> = {}): DispatchPlot {
  return {
    id: 1,
    dispatchRunId: 10,
    plotId: "p1",
    plotName: "Plot 1",
    variety: "Geisha",
    altitudeMasl: 1500,
    taskKind: "picking",
    targetKg: null,
    ripenessTarget: "high",
    readiness: 0.9,
    ord: 1,
    ...overrides,
  };
}

function card(overrides: Partial<DispatchCard> = {}): DispatchCard {
  const plots = overrides.plots ?? [
    plot({ id: 1, plotId: "p1", plotName: "El Alto", altitudeMasl: 1500, ord: 1 }),
    plot({
      id: 2,
      plotId: "p2",
      plotName: "La Quebrada",
      variety: "Caturra",
      altitudeMasl: 1350,
      ripenessTarget: "medium",
      ord: 2,
    }),
  ];
  return {
    id: 10,
    crewId: "c1",
    crewName: "Norte",
    dispatchDate: "2026-06-21",
    season: "2026",
    status: "draft",
    sentChannel: null,
    readinessThreshold: 0.7,
    idempotencyKey: null,
    plotCount: plots.length,
    plots,
    ...overrides,
  };
}

describe("renderDispatchCardText", () => {
  it("renders a header line with the crew name and date", () => {
    const text = renderDispatchCardText(card());
    const header = text.split("\n")[0];
    expect(header).toContain("Norte");
    expect(header).toContain("2026-06-21");
  });

  it('includes the "A cosechar hoy" pick-today copy in the header', () => {
    const text = renderDispatchCardText(card());
    expect(text).toContain("A cosechar hoy");
  });

  it("renders one line per plot, in card.plots order, with name, variety and altitude", () => {
    const text = renderDispatchCardText(card());
    const lines = text.split("\n");

    const elAlto = lines.find((l) => l.includes("El Alto"));
    const laQuebrada = lines.find((l) => l.includes("La Quebrada"));

    expect(elAlto).toBeDefined();
    expect(laQuebrada).toBeDefined();
    expect(elAlto).toContain("Geisha");
    expect(elAlto).toContain("1500");
    expect(laQuebrada).toContain("Caturra");
    expect(laQuebrada).toContain("1350");

    // order preserved: El Alto (ord 1) appears before La Quebrada (ord 2)
    expect(text.indexOf("El Alto")).toBeLessThan(text.indexOf("La Quebrada"));
  });

  it("renders a footer line with the plot count", () => {
    const text = renderDispatchCardText(card());
    expect(text).toMatch(/2\s*(parcelas|plots)/i);
  });

  it("renders a 'no plots ready' line when the card has no plots", () => {
    const text = renderDispatchCardText(card({ plots: [], plotCount: 0 }));
    expect(text).toContain("Norte");
    expect(text.toLowerCase()).toMatch(/ninguna|no plots|sin parcelas/);
  });

  it("is Spanish-only when the crew does not speak ngäbere", () => {
    const text = renderDispatchCardText(card(), { languages: ["es"] });
    expect(text).not.toContain("·");
  });

  it("renders bilingual 'es · ngäbere' terms when the crew speaks ngäbere", () => {
    const text = renderDispatchCardText(card(), { languages: ["es", "ngäbere"] });
    // the ngäbere separator and at least the pick-today ng term appear
    expect(text).toContain("·");
    expect(text).toContain("A cosechar hoy");
  });

  it("is deterministic — same input yields byte-identical output", () => {
    const c = card();
    const a = renderDispatchCardText(c, { languages: ["es", "ngäbere"] });
    const b = renderDispatchCardText(c, { languages: ["es", "ngäbere"] });
    expect(a).toBe(b);
  });

  it("does not depend on the wall clock (no Date.now leakage)", () => {
    const c = card({ dispatchDate: "2099-01-01" });
    const text = renderDispatchCardText(c);
    expect(text).toContain("2099-01-01");
  });

  it("returns a single newline-separated WhatsApp-pasteable string", () => {
    const text = renderDispatchCardText(card());
    expect(typeof text).toBe("string");
    expect(text).toContain("\n");
    expect(text.startsWith("\n")).toBe(false);
    expect(text.endsWith("\n")).toBe(false);
  });
});

describe("renderDispatchCardTitle", () => {
  it("produces a short share-sheet title with the farm, crew and date", () => {
    const title = renderDispatchCardTitle(card());
    expect(title).toContain("Janson");
    expect(title).toContain("Norte");
    expect(title).toContain("2026-06-21");
  });

  it("is deterministic", () => {
    const c = card();
    expect(renderDispatchCardTitle(c)).toBe(renderDispatchCardTitle(c));
  });
});
