import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FIELD, FormField, LABEL } from "@/components/ui/form-field";

afterEach(cleanup);

/**
 * FormField is the one home for the glass input styling (FIELD/LABEL classnames,
 * verbatim from start-ferment-form.tsx etc.) so every Phase-5 form imports the
 * literal instead of re-declaring it. It wires label↔input + per-field error.
 */
describe("FormField", () => {
  it("exports the canonical glass FIELD/LABEL classnames", () => {
    expect(FIELD).toContain("rounded-xl");
    expect(FIELD).toContain("border-line");
    expect(LABEL).toContain("text-muted-fg");
  });

  it("renders a label bound to its input via htmlFor/id", () => {
    render(<FormField label="Sombra %" name="shadePct" />);
    const input = screen.getByLabelText("Sombra %");
    expect(input).toHaveAttribute("name", "shadePct");
    expect(input).toHaveClass("rounded-xl");
  });

  it("forwards defaultValue and disabled to the input", () => {
    render(
      <FormField label="Sombra %" name="shadePct" defaultValue="40" disabled />,
    );
    const input = screen.getByLabelText<HTMLInputElement>("Sombra %");
    expect(input).toHaveValue("40");
    expect(input).toBeDisabled();
  });

  it("shows a per-field error and marks the input aria-invalid", () => {
    render(
      <FormField
        label="Sombra %"
        name="shadePct"
        error="Debe ser 0–100"
      />,
    );
    expect(screen.getByText("Debe ser 0–100")).toBeInTheDocument();
    expect(screen.getByLabelText("Sombra %")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("omits aria-invalid and the error node when there is no error", () => {
    render(<FormField label="Sombra %" name="shadePct" />);
    expect(screen.getByLabelText("Sombra %")).not.toHaveAttribute(
      "aria-invalid",
    );
  });
});
