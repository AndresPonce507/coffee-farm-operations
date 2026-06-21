import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Plot, Worker } from "@/lib/types";
import type { IntakeActionState } from "@/app/(app)/harvests/actions";

/**
 * Render + behaviour test for the cherry-intake client island (the genesis WRITE:
 * a picker's lata of cherry recorded as a system-minted, traceable JC-NNN lot).
 * The Server Action is mocked (its own behaviour is pinned by its co-located
 * test); this proves the island's contract:
 *   - the plot / picker / cherries-kg / variety fields render with their options,
 *   - submitting drives the bound Server Action (useActionState) once,
 *   - a SUCCESS state surfaces the minted JC-NNN code with a link to /lots/[code],
 *   - a field error from the action renders inline (friendly, no raw SQL).
 *
 * Mirrors the action-mock + useActionState idiom in
 * src/components/sections/eudr/__tests__/declare-plot-form.test.tsx.
 */

// useActionState calls the action with (prevState, formData). The mock returns
// whatever `nextState` is set to, so each test scripts the action's outcome.
let nextState: IntakeActionState = { status: "idle" };
const actionSpy = vi.fn(
  async (
    _prev: IntakeActionState,
    _fd: FormData,
  ): Promise<IntakeActionState> => nextState,
);

vi.mock("@/app/(app)/harvests/actions", () => ({
  INTAKE_IDLE: { status: "idle" },
  recordCherryIntakeAction: (
    prev: IntakeActionState,
    fd: FormData,
  ): Promise<IntakeActionState> => actionSpy(prev, fd),
}));

import { CherryIntakeForm } from "@/components/sections/harvests/cherry-intake-form";

const plots = [
  { id: "p-tizingal-alto", name: "Tizingal Alto" },
  { id: "p-baru-vista", name: "Barú Vista" },
] as unknown as Plot[];
const pickers = [
  { id: "w-lucia", name: "Lucía Mendoza" },
  { id: "w-05", name: "Marisol Quintero" },
] as unknown as Worker[];

function renderForm() {
  return render(
    <CherryIntakeForm plots={plots} pickers={pickers} onDone={() => {}} />,
  );
}

describe("CherryIntakeForm", () => {
  it("renders the plot, picker, cherries-kg, and variety fields with options", () => {
    renderForm();

    expect(screen.getByLabelText(/plot/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/picker/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/cherries/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/variety/i)).toBeInTheDocument();

    // plot + picker options are driven by the passed read-port data
    expect(
      screen.getByRole("option", { name: "Tizingal Alto" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Lucía Mendoza" }),
    ).toBeInTheDocument();
    // every coffee_variety enum member is offered
    expect(screen.getByRole("option", { name: "Geisha" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Caturra" })).toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: /record intake/i }),
    ).toBeInTheDocument();
  });

  it("submitting the form drives the bound Server Action", async () => {
    nextState = { status: "idle" };
    actionSpy.mockClear();
    const { container } = renderForm();

    const form = container.querySelector("form") as HTMLFormElement;
    fireEvent.submit(form);

    await waitFor(() => expect(actionSpy).toHaveBeenCalledTimes(1));
  });

  it("on success surfaces the minted JC-NNN code with a link to its lot", async () => {
    nextState = { status: "success", message: "Lot JC-742 minted.", lotCode: "JC-742" };
    actionSpy.mockClear();
    const { container } = renderForm();

    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    // the minted code is shown and linked to the lot's traceability page.
    const link = await screen.findByRole("link", { name: /JC-742/i });
    expect(link).toHaveAttribute("href", "/lots/JC-742");
    // and it celebrates the mint (the genesis-of-traceability message).
    expect(screen.getByText(/traceable lot/i)).toBeInTheDocument();
  });

  it("renders a friendly field error inline (no raw SQL)", async () => {
    nextState = {
      status: "error",
      errors: { cherriesKg: "Cherries (kg) must be greater than 0." },
    };
    actionSpy.mockClear();
    const { container } = renderForm();

    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    expect(
      await screen.findByText(/must be greater than 0/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/constraint|violates|null value/i)).toBeNull();
  });
});
