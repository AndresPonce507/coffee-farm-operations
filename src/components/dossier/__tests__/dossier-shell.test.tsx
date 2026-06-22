import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DossierShell } from "@/components/dossier/dossier-shell";

// Globals are off — register RTL cleanup so each render gets a fresh body.
afterEach(cleanup);

describe("DossierShell", () => {
  it("renders the title, eyebrow, and subtitle", () => {
    render(
      <DossierShell
        kind="plot"
        title="Tizingal-Alto"
        eyebrow="Lote"
        subtitle="Geisha · 2.4 ha · 1650 msnm"
        backHref="/plots"
        backLabel="Todos los lotes"
      >
        <p>contenido</p>
      </DossierShell>,
    );
    expect(screen.getByRole("heading", { name: "Tizingal-Alto" })).toBeInTheDocument();
    expect(screen.getByText("Lote")).toBeInTheDocument();
    expect(screen.getByText("Geisha · 2.4 ha · 1650 msnm")).toBeInTheDocument();
  });

  it("renders a back link to the list route with its es-PA label", () => {
    render(
      <DossierShell
        kind="worker"
        title="Lupita González"
        eyebrow="Trabajador"
        backHref="/workers"
        backLabel="Todos los trabajadores"
      >
        <p>contenido</p>
      </DossierShell>,
    );
    const back = screen.getByRole("link", { name: /Todos los trabajadores/ });
    expect(back).toHaveAttribute("href", "/workers");
  });

  it("omits the subtitle when none is supplied", () => {
    render(
      <DossierShell
        kind="crew"
        title="Cuadrilla Norte"
        eyebrow="Cuadrilla"
        backHref="/workers"
        backLabel="Atrás"
      >
        <p>contenido</p>
      </DossierShell>,
    );
    expect(screen.getByRole("heading", { name: "Cuadrilla Norte" })).toBeInTheDocument();
    // No stray subtitle paragraph beside the heading.
    expect(screen.queryByText(/msnm/)).toBeNull();
  });

  it("renders header-right actions when provided", () => {
    render(
      <DossierShell
        kind="plot"
        title="Tizingal-Alto"
        eyebrow="Lote"
        backHref="/plots"
        backLabel="Atrás"
        actions={<button type="button">Editar</button>}
      >
        <p>contenido</p>
      </DossierShell>,
    );
    expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
  });

  it("renders its children (the section stack) and tags the kind for testing", () => {
    render(
      <DossierShell
        kind="batch"
        title="JC-204"
        eyebrow="Lote de fermentación"
        backHref="/ferment"
        backLabel="Atrás"
      >
        <section data-testid="child-section">cuerpo</section>
      </DossierShell>,
    );
    expect(screen.getByTestId("child-section")).toBeInTheDocument();
    expect(screen.getByTestId("dossier-batch")).toHaveAttribute("data-dossier", "batch");
  });
});
