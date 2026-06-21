import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SprayLogForm } from "@/components/sections/ipm/spray-log-form";
import type { CertifiedApplicator, PlotOption } from "@/components/sections/ipm/spray-log-form";

/**
 * Render/interaction test for the cert-gated spray-log form (P2-S12) — the UI half
 * of the slice's keystone invariant. The DB `log_spray` is the REAL fail-closed
 * gate; the form's job is to make that gate VISIBLE and refuse to submit an
 * uncertified applicator BEFORE the round-trip, so the field worker gets an
 * immediate, dignified "you need a valid cert" rather than a cryptic DB error.
 */

afterEach(cleanup);

const plots: PlotOption[] = [
  { id: "p-talamanca", name: "Talamanca" },
  { id: "p-cuesta-piedra", name: "Cuesta de Piedra" },
];

const applicators: CertifiedApplicator[] = [
  { id: "w-agro", name: "Lucía Mendez", certified: true },
  { id: "w-06", name: "Ana Pérez", certified: false }, // NO valid pesticide cert
];

describe("SprayLogForm (cert-gate UI)", () => {
  it("renders the form with a product field and an applicator picker", () => {
    render(<SprayLogForm plots={plots} applicators={applicators} />);
    expect(screen.getByLabelText(/product/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/applicator|worker/i)).toBeInTheDocument();
  });

  it("marks an uncertified applicator option as such (the cert state is visible)", () => {
    render(<SprayLogForm plots={plots} applicators={applicators} />);
    // the uncertified worker is flagged in the picker (e.g. disabled option / "no cert")
    const picker = screen.getByLabelText(/applicator|worker/i) as HTMLSelectElement;
    const uncertOption = within(picker).getByRole("option", { name: /Ana Pérez/i }) as HTMLOptionElement;
    expect(uncertOption.disabled).toBe(true);
  });

  it("REFUSES to submit when the chosen applicator lacks a valid cert — shows the gate reason", () => {
    render(<SprayLogForm plots={plots} applicators={applicators} />);

    // force-select the uncertified worker (the value the gate must catch) and submit.
    fireEvent.change(screen.getByLabelText(/product/i), { target: { value: "Verdadero 600" } });
    fireEvent.change(screen.getByLabelText(/applicator|worker/i), { target: { value: "w-06" } });
    fireEvent.submit(screen.getByTestId("spray-form"));

    // the form blocks it client-side with a clear cert reason — the dignified refusal.
    expect(screen.getByRole("alert")).toHaveTextContent(/cert|certif|valid/i);
  });

  it("allows a certified applicator to be chosen without the cert error", () => {
    render(<SprayLogForm plots={plots} applicators={applicators} />);
    fireEvent.change(screen.getByLabelText(/product/i), { target: { value: "Verdadero 600" } });
    fireEvent.change(screen.getByLabelText(/applicator|worker/i), { target: { value: "w-agro" } });
    fireEvent.submit(screen.getByTestId("spray-form"));
    // no cert refusal for a certified applicator (other validation may apply, but
    // not the cert gate).
    const alert = screen.queryByRole("alert");
    if (alert) expect(alert).not.toHaveTextContent(/lacks a valid|not certified|no valid cert/i);
  });

  it("warns honestly when NO applicator on the crew holds a valid cert (the work cannot be logged)", () => {
    render(
      <SprayLogForm
        plots={plots}
        applicators={[{ id: "w-06", name: "Ana Pérez", certified: false }]}
      />,
    );
    // the prominent status banner names the gap and disables the submit.
    expect(screen.getByRole("status")).toHaveTextContent(/no crew member holds a valid/i);
    expect(screen.getByRole("button", { name: /log spray/i })).toBeDisabled();
  });
});
