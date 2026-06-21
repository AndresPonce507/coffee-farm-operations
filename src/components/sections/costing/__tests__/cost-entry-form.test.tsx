import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CostEntryForm } from "@/components/sections/costing/cost-entry-form";
import type { BookCostEntryInput } from "@/app/(app)/costing/actions";

type BookResult = { ok: true } | { ok: false; error: string };
type BookAction = (input: BookCostEntryInput) => Promise<BookResult>;

/**
 * Render/smoke test for the S7 `CostEntryForm` — the WRITE UI that books a cost
 * onto the append-only `cost_entry` ledger. Mounts the form with a no-op action
 * and asserts:
 *   - every field renders (driver / rule / target_kind / amount / memo + submit),
 *   - the conditional `target_code` input toggles with `target_kind`: present &
 *     enabled for plot/lot, hidden/disabled for farm (a farm row carries no
 *     target, mirroring the DB CHECK),
 *   - selectable lots/plots surface as options on the target_code control.
 */

const lots = ["JC-701", "JC-702"];
const plots = [{ id: "plot-A", name: "Tizingal Alto" }];

function renderForm(action: BookAction = async () => ({ ok: true })) {
  return render(
    <CostEntryForm
      lots={lots}
      plots={plots}
      action={action}
      onDone={() => {}}
    />,
  );
}

describe("CostEntryForm (smoke)", () => {
  it("renders every field and the submit control", () => {
    renderForm();

    expect(screen.getByLabelText("Driver")).toBeInTheDocument();
    expect(screen.getByLabelText("Allocation rule")).toBeInTheDocument();
    expect(screen.getByLabelText("Target")).toBeInTheDocument();
    expect(screen.getByLabelText("Amount (USD)")).toBeInTheDocument();
    expect(screen.getByLabelText("Memo")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /book cost/i }),
    ).toBeInTheDocument();
  });

  it("defaults to a target_kind that requires a target_code, and shows it enabled", () => {
    renderForm();
    // default kind is plot or lot (not farm) → the code input is interactive.
    const code = screen.getByLabelText("Target code") as HTMLSelectElement;
    expect(code).toBeInTheDocument();
    expect(code).not.toBeDisabled();
  });

  it("hides/disables the target_code input when target_kind is farm", () => {
    renderForm();
    const kind = screen.getByLabelText("Target") as HTMLSelectElement;

    fireEvent.change(kind, { target: { value: "farm" } });

    // farm rows carry no target — the code control is gone or disabled.
    const code = screen.queryByLabelText("Target code") as HTMLElement | null;
    if (code) {
      expect(code).toBeDisabled();
    } else {
      expect(code).toBeNull();
    }
  });

  it("re-shows the target_code input when switching back to lot", () => {
    renderForm();
    const kind = screen.getByLabelText("Target") as HTMLSelectElement;

    fireEvent.change(kind, { target: { value: "farm" } });
    fireEvent.change(kind, { target: { value: "lot" } });

    const code = screen.getByLabelText("Target code") as HTMLSelectElement;
    expect(code).toBeInTheDocument();
    expect(code).not.toBeDisabled();
  });

  it("offers the supplied lots as target_code options for a lot target", () => {
    renderForm();
    const kind = screen.getByLabelText("Target") as HTMLSelectElement;
    fireEvent.change(kind, { target: { value: "lot" } });

    expect(screen.getByRole("option", { name: "JC-701" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "JC-702" })).toBeInTheDocument();
  });

  it("offers the supplied plots as target_code options for a plot target", () => {
    renderForm();
    const kind = screen.getByLabelText("Target") as HTMLSelectElement;
    fireEvent.change(kind, { target: { value: "plot" } });

    expect(
      screen.getByRole("option", { name: "Tizingal Alto" }),
    ).toBeInTheDocument();
  });

  it("shows an inline error and does not call the action on a missing target_code", async () => {
    const action = vi.fn(async () => ({ ok: true as const }));
    renderForm(action);

    const kind = screen.getByLabelText("Target") as HTMLSelectElement;
    fireEvent.change(kind, { target: { value: "lot" } });
    // leave target_code unset, give a valid amount
    fireEvent.change(screen.getByLabelText("Amount (USD)"), {
      target: { value: "10" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /book cost/i }).closest("form")!);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
  });
});
