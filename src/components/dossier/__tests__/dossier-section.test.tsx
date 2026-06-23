import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DossierSection } from "@/components/dossier/dossier-section";

// Globals are off — register RTL cleanup so each render gets a fresh body.
afterEach(cleanup);

describe("DossierSection", () => {
  it("renders the heading and a deep-linkable #anchor id", () => {
    render(
      <DossierSection id="satellite" title="Satélite">
        <p>cuerpo</p>
      </DossierSection>,
    );
    expect(screen.getByRole("heading", { name: "Satélite" })).toBeInTheDocument();
    // The section element carries id="satellite" so /plots/[id]#satellite scrolls here.
    expect(screen.getByTestId("section-satellite")).toHaveAttribute("id", "satellite");
  });

  it("renders a count badge when count is a number", () => {
    render(
      <DossierSection id="harvests" title="Cosechas" count={8}>
        <p>cuerpo</p>
      </DossierSection>,
    );
    expect(screen.getByText("8")).toBeInTheDocument();
  });

  it("omits the count badge when count is undefined", () => {
    render(
      <DossierSection id="harvests" title="Cosechas">
        <p data-testid="body">cuerpo</p>
      </DossierSection>,
    );
    expect(screen.getByTestId("body")).toBeInTheDocument();
    // No numeric badge rendered when count is absent.
    expect(screen.queryByText(/^\d+$/)).toBeNull();
  });

  it("renders the count badge for an explicit zero", () => {
    render(
      <DossierSection id="harvests" title="Cosechas" count={0}>
        <p>cuerpo</p>
      </DossierSection>,
    );
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("renders the empty state instead of children when empty", () => {
    render(
      <DossierSection id="harvests" title="Cosechas" empty emptyLabel="Sin cosechas todavía">
        <p data-testid="body">cuerpo</p>
      </DossierSection>,
    );
    expect(screen.getByText("Sin cosechas todavía")).toBeInTheDocument();
    // The real children are NOT rendered in the empty state.
    expect(screen.queryByTestId("body")).toBeNull();
  });

  it("falls back to default es-PA empty copy when no emptyLabel is given", () => {
    render(
      <DossierSection id="harvests" title="Cosechas" empty>
        <p data-testid="body">cuerpo</p>
      </DossierSection>,
    );
    expect(screen.getByText("Sin registros todavía")).toBeInTheDocument();
    expect(screen.queryByTestId("body")).toBeNull();
  });

  it("renders children when not empty", () => {
    render(
      <DossierSection id="cost" title="Costo" empty={false}>
        <p data-testid="body">cuerpo</p>
      </DossierSection>,
    );
    expect(screen.getByTestId("body")).toBeInTheDocument();
    expect(screen.queryByText("Sin registros todavía")).toBeNull();
  });
});
