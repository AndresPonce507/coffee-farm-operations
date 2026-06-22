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

  it("carries an es-PA aria-label naming the entity for screen readers", () => {
    render(
      <EntityLink kind="worker" id="w42">
        Ana
      </EntityLink>,
    );
    expect(
      screen.getByRole("link", { name: /worker w42/i }),
    ).toBeInTheDocument();
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
});
