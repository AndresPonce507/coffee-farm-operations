import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EntityLink } from "@/components/ui/entity-link";

afterEach(cleanup);

/**
 * EntityLink is the NAVIGATE/DRILL primitive. It IMPORTS the entityHref SSOT (never
 * redefines it) and renders a real `<a href>` with an es-PA aria-label, so a
 * formerly-COSMETIC entity row becomes keyboard- and screen-reader-reachable.
 */
describe("EntityLink", () => {
  it("renders an <a href> resolved through entityHref for the kind+id", () => {
    render(
      <EntityLink kind="plot" id="p1">
        <span>Lote La Cima</span>
      </EntityLink>,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/plots/p1");
    expect(link).toHaveTextContent("Lote La Cima");
  });

  it("appends a #anchor for a DRILL link", () => {
    render(
      <EntityLink kind="lot" id="JC-712" anchor="cost-entries">
        <span>$3.40/kg</span>
      </EntityLink>,
    );
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/lots/JC-712#cost-entries",
    );
  });

  it("does NOT set aria-label when name is omitted — visible children supply the accessible name (WCAG 2.5.3)", () => {
    render(
      <EntityLink kind="worker" id="w42">
        Ana
      </EntityLink>,
    );
    // The link must be reachable by its visible text — NOT by a slug aria-label that
    // shadows and discards it (2.5.3 Label-in-Name violation).
    const link = screen.getByRole("link", { name: "Ana" });
    expect(link).toBeInTheDocument();
    expect(link).not.toHaveAttribute("aria-label");
  });

  it("uses the visible name in the aria-label when a name prop is provided", () => {
    render(
      <EntityLink kind="worker" id="w42" name="Lupita González">
        Lupita González
      </EntityLink>,
    );
    expect(
      screen.getByRole("link", { name: /open worker lupita gonzález/i }),
    ).toBeInTheDocument();
  });

  it("uses locale-aware kind labels in aria-label when name prop is provided, for all dossier kinds", () => {
    const cases: Array<[Parameters<typeof EntityLink>[0]["kind"], string]> = [
      ["lot", "lot"],
      ["plot", "plot"],
      ["crew", "crew"],
      ["batch", "batch"],
      ["dispatch", "dispatch"],
      ["pay-period", "pay period"],
    ];
    for (const [kind, kindLabel] of cases) {
      const humanName = `Entidad ${kindLabel}`;
      const { unmount } = render(
        <EntityLink kind={kind} id="x1" name={humanName}>
          {humanName}
        </EntityLink>,
      );
      expect(
        screen.getByRole("link", {
          name: new RegExp(`open ${kindLabel} entidad`, "i"),
        }),
      ).toBeInTheDocument();
      unmount();
    }
  });

  it("forwards a className so the existing card markup keeps its styling", () => {
    render(
      <EntityLink kind="crew" id="c3" className="block glass-row">
        Cuadrilla 3
      </EntityLink>,
    );
    expect(screen.getByRole("link")).toHaveClass("block", "glass-row");
  });

  it("encodes ids in the rendered href", () => {
    render(
      <EntityLink kind="lot" id="JC 7/12">
        x
      </EntityLink>,
    );
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/lots/JC%207%2F12",
    );
  });

  // WCAG 2.4.7 / 2.4.11 — Focus not obscured / Focus Appearance
  // EntityLink must carry a default focus-visible ring so every call site gains a
  // keyboard focus indicator without 24 per-call edits.
  it("carries a default focus-visible ring class so keyboard focus is always visible (WCAG 2.4.7 / 2.4.11)", () => {
    render(
      <EntityLink kind="plot" id="p1">
        Plot
      </EntityLink>,
    );
    const link = screen.getByRole("link");
    // The rendered element must include the focus-visible ring utilities even when the
    // caller passes no className at all.
    expect(link.className).toMatch(/focus-visible:ring-2/);
    expect(link.className).toMatch(/focus-visible:ring-forest/);
  });

  it("merges caller className with the default focus-visible ring (no duplication, caller classes preserved)", () => {
    render(
      <EntityLink kind="crew" id="c3" className="block glass-row">
        Cuadrilla 3
      </EntityLink>,
    );
    const link = screen.getByRole("link");
    // Caller classes preserved.
    expect(link).toHaveClass("block", "glass-row");
    // Default focus ring still present.
    expect(link.className).toMatch(/focus-visible:ring-2/);
  });
});
