import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DryingActionState } from "@/app/(app)/drying/actions";

/**
 * Render + behaviour test for the record-moisture client island — the write that
 * APPENDS a reading to a lot's drying curve (the EVIDENCE the reposo gate reads).
 * The Server Action is mocked (its own behaviour is pinned by its co-located
 * test); this proves the island's contract:
 *   - the lot + moisture-pct fields render, the lot select offers the passed lots,
 *   - it carries a STABLE hidden idempotencyKey (double-submit dedupes),
 *   - submitting drives the bound Server Action once,
 *   - a SUCCESS state confirms the reading, a field error renders inline (no SQL).
 *
 * Mirrors the action-mock + useActionState idiom in cherry-intake-form.test.tsx.
 */

let nextState: DryingActionState = { status: "idle" };
const actionSpy = vi.fn(
  async (
    _prev: DryingActionState,
    _fd: FormData,
  ): Promise<DryingActionState> => nextState,
);

vi.mock("@/app/(app)/drying/actions", () => ({
  DRYING_IDLE: { status: "idle" },
  recordMoistureAction: (
    prev: DryingActionState,
    fd: FormData,
  ): Promise<DryingActionState> => actionSpy(prev, fd),
}));

import { RecordMoistureForm } from "@/components/sections/drying/record-moisture-form";

const lots = ["JC-571", "JC-572"];

function renderForm() {
  return render(<RecordMoistureForm lots={lots} onDone={() => {}} />);
}

describe("RecordMoistureForm", () => {
  it("renders the lot + moisture fields with the passed lot options", () => {
    renderForm();

    expect(screen.getByLabelText(/lot/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/moisture/i)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "JC-571" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "JC-572" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /record reading/i }),
    ).toBeInTheDocument();
  });

  it("marks the mandatory fields (lot, moisture) as required", () => {
    const { container } = renderForm();
    expect(container.querySelector('[name="lotCode"]')).toHaveAttribute("required");
    expect(container.querySelector('[name="moisturePct"]')).toHaveAttribute("required");
  });

  it("carries a stable hidden idempotencyKey that does not change across re-renders", () => {
    const { container, rerender } = renderForm();
    const hidden = container.querySelector(
      'input[name="idempotencyKey"]',
    ) as HTMLInputElement | null;
    expect(hidden?.type).toBe("hidden");
    const key = hidden?.value;
    expect(key).toBeTruthy();

    rerender(<RecordMoistureForm lots={lots} onDone={() => {}} />);
    const after = container.querySelector(
      'input[name="idempotencyKey"]',
    ) as HTMLInputElement | null;
    expect(after?.value).toBe(key);
  });

  it("submitting drives the bound Server Action once", async () => {
    nextState = { status: "idle" };
    actionSpy.mockClear();
    const { container } = renderForm();
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    await waitFor(() => expect(actionSpy).toHaveBeenCalledTimes(1));
  });

  it("on success confirms the reading", async () => {
    nextState = {
      status: "success",
      message: "Reading recorded for JC-571.",
      lotCode: "JC-571",
    };
    actionSpy.mockClear();
    const { container } = renderForm();
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    // the dynamic confirmation (with the lot code) is unique to the success state.
    expect(
      await screen.findByText(/reading recorded for JC-571/i),
    ).toBeInTheDocument();
  });

  it("renders a friendly field error inline (no raw SQL)", async () => {
    nextState = {
      status: "error",
      errors: { moisturePct: "Moisture must be a percentage between 0 and 100." },
    };
    actionSpy.mockClear();
    const { container } = renderForm();
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    expect(
      await screen.findByText(/percentage between 0 and 100/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/constraint|violates|null value/i)).toBeNull();
  });
});
