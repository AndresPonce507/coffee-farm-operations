import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SMART_IDLE,
  SmartForm,
  type SmartActionState,
} from "@/components/ui/smart-form";
// The LIVE ActionState the whole app already uses — imported here to PROVE the
// compatibility contract (C4): an existing route action's return type must pass
// straight into SmartForm with no adapter.
import type { ActionState } from "@/lib/actions/plots";

afterEach(cleanup);

describe("SMART_IDLE", () => {
  it("is the idle state", () => {
    expect(SMART_IDLE).toEqual({ status: "idle" });
  });
});

describe("SmartActionState ↔ ActionState compatibility (C4 — superset)", () => {
  it("accepts every live ActionState variant as a SmartActionState", () => {
    // Compile-time superset proof: each live variant is assignable to the smart
    // type. (If SmartActionState ever stops being a superset, this stops compiling.)
    const idle: SmartActionState = { status: "idle" } satisfies ActionState;
    const ok: SmartActionState = {
      status: "success",
      message: "Listo",
    } satisfies ActionState;
    const bad: SmartActionState = {
      status: "error",
      message: "No",
      errors: { x: "y" },
    } satisfies ActionState;
    expect([idle.status, ok.status, bad.status]).toEqual([
      "idle",
      "success",
      "error",
    ]);
  });
});

describe("SmartForm", () => {
  it("renders the supplied fields and a submit button", () => {
    render(
      <SmartForm
        action={() => SMART_IDLE}
        submitLabel="Guardar"
        pendingLabel="Guardando…"
      >
        {() => <input aria-label="Sombra %" name="shadePct" />}
      </SmartForm>,
    );
    expect(screen.getByLabelText("Sombra %")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Guardar" }),
    ).toBeInTheDocument();
  });

  it("on success shows the success pane with the message", async () => {
    const action = vi.fn(
      (): SmartActionState => ({ status: "success", message: "Lote creado" }),
    );
    render(
      <SmartForm action={action} submitLabel="Guardar" pendingLabel="…">
        {() => <input aria-label="x" name="x" />}
      </SmartForm>,
    );
    fireEvent.submit(
      screen.getByRole("button", { name: "Guardar" }).closest("form")!,
    );
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Lote creado"),
    );
    // The form fields are gone once it succeeds.
    expect(screen.queryByLabelText("x")).not.toBeInTheDocument();
  });

  it("on success WITH an href renders a follow-through deep-link (the SmartActionState superset)", async () => {
    const action = (): SmartActionState => ({
      status: "success",
      message: "Lote creado",
      href: "/lots/JC-712",
    });
    render(
      <SmartForm action={action} submitLabel="Guardar" pendingLabel="…">
        {() => <input aria-label="x" name="x" />}
      </SmartForm>,
    );
    fireEvent.submit(
      screen.getByRole("button", { name: "Guardar" }).closest("form")!,
    );
    await waitFor(() =>
      expect(screen.getByRole("link")).toHaveAttribute("href", "/lots/JC-712"),
    );
  });

  it("on error surfaces the per-field error AND the top-level role=alert message", async () => {
    const action = (): SmartActionState => ({
      status: "error",
      message: "Revisá los campos",
      errors: { shadePct: "Debe ser 0–100" },
    });
    render(
      <SmartForm action={action} submitLabel="Guardar" pendingLabel="…">
        {({ fieldError }) => (
          <>
            <input aria-label="Sombra %" name="shadePct" />
            {fieldError("shadePct") && (
              <span data-testid="field-err">{fieldError("shadePct")}</span>
            )}
          </>
        )}
      </SmartForm>,
    );
    fireEvent.submit(
      screen.getByRole("button", { name: "Guardar" }).closest("form")!,
    );
    await waitFor(() =>
      expect(screen.getByTestId("field-err")).toHaveTextContent(
        "Debe ser 0–100",
      ),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Revisá los campos");
    // Still a form (not the success pane) so the user can correct + resubmit.
    expect(screen.getByLabelText("Sombra %")).toBeInTheDocument();
  });

  it("renders a hidden idempotencyKey input only when idempotent is set", () => {
    const { container, rerender } = render(
      <SmartForm action={() => SMART_IDLE} submitLabel="G" pendingLabel="…">
        {() => <input aria-label="x" name="x" />}
      </SmartForm>,
    );
    expect(
      container.querySelector('input[name="idempotencyKey"]'),
    ).toBeNull();

    rerender(
      <SmartForm
        action={() => SMART_IDLE}
        idempotent
        submitLabel="G"
        pendingLabel="…"
      >
        {() => <input aria-label="x" name="x" />}
      </SmartForm>,
    );
    const hidden = container.querySelector<HTMLInputElement>(
      'input[name="idempotencyKey"]',
    );
    expect(hidden).not.toBeNull();
    expect(hidden).toHaveAttribute("type", "hidden");
    expect(hidden?.value).toBeTruthy();
  });

  it("renders Cancel/Done affordances only when onDone is provided", () => {
    const { rerender } = render(
      <SmartForm action={() => SMART_IDLE} submitLabel="G" pendingLabel="…">
        {() => <input aria-label="x" name="x" />}
      </SmartForm>,
    );
    expect(
      screen.queryByRole("button", { name: "Cancel" }),
    ).not.toBeInTheDocument();

    rerender(
      <SmartForm
        action={() => SMART_IDLE}
        onDone={() => {}}
        submitLabel="G"
        pendingLabel="…"
      >
        {() => <input aria-label="x" name="x" />}
      </SmartForm>,
    );
    expect(
      screen.getByRole("button", { name: "Cancel" }),
    ).toBeInTheDocument();
  });
});
