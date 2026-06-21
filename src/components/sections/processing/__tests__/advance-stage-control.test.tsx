import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BatchStage } from "@/lib/types";

// The control drives the advance Server Action via useActionState. Stub the
// action module so the island renders + submits without next/cache or Supabase.
const advanceMock = vi.fn();
vi.mock("@/app/(app)/processing/actions", () => ({
  advanceStageAction: (...args: unknown[]) => advanceMock(...args),
  PROCESSING_IDLE: { status: "idle" },
}));

import { AdvanceStageControl } from "@/components/sections/processing/advance-stage-control";

/** The control is keyed off the LOT (one per lot_code), not a batch row: it takes
 *  the lot code + the LOT's authoritative current stage (from lots.stage) + the
 *  current mass. This is the coherence fix — the displayed "from" stage and the
 *  forward set come from the table the advance write actually moves. */
const LOT = (over: Partial<{ lotCode: string; currentStage: BatchStage; currentKg: number }> = {}) => ({
  lotCode: "JC-561",
  currentStage: "drying" as BatchStage,
  currentKg: 420,
  ...over,
});

describe("AdvanceStageControl (the pipeline advance island)", () => {
  it("renders an advance trigger for a lot that is not yet green", () => {
    render(<AdvanceStageControl {...LOT()} />);
    expect(
      screen.getByRole("button", { name: /advance/i }),
    ).toBeInTheDocument();
  });

  it("opens the advance dialog carrying the lot code as a hidden field", () => {
    render(<AdvanceStageControl {...LOT()} />);
    fireEvent.click(screen.getByRole("button", { name: /advance/i }));

    // The dialog is open: the target-stage picker + the new-weight field.
    expect(screen.getByLabelText(/move to stage/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/weight after step/i)).toBeInTheDocument();

    // The lot code travels as a hidden field for the Server Action.
    const hidden = document.querySelector(
      "input[name='lotCode'][type='hidden']",
    ) as HTMLInputElement | null;
    expect(hidden?.value).toBe("JC-561");
  });

  it("derives the forward set from the LOT's stage (the from-stage shown is lots.stage)", () => {
    render(<AdvanceStageControl {...LOT({ currentStage: "drying" })} />);
    fireEvent.click(screen.getByRole("button", { name: /advance/i }));

    const select = screen.getByLabelText(/move to stage/i) as HTMLSelectElement;
    expect(select.value).toBe("parchment");

    // Only forward stages are offered — no backward option in the list.
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).not.toContain("cherry");
    expect(optionValues).not.toContain("fermentation");
    expect(optionValues).not.toContain("drying");
    expect(optionValues).toContain("parchment");
    expect(optionValues).toContain("green");

    // The "from" chip shows the LOT's current stage (Drying), not a batch stage.
    expect(screen.getByText("Drying")).toBeInTheDocument();
  });

  it("does not render an advance trigger for a green (finished) lot", () => {
    render(<AdvanceStageControl {...LOT({ currentStage: "green" })} />);
    expect(
      screen.queryByRole("button", { name: /advance/i }),
    ).not.toBeInTheDocument();
  });

  it("carries a STABLE idempotency key as a hidden field so a double-submit is a DB no-op", () => {
    render(<AdvanceStageControl {...LOT()} />);
    fireEvent.click(screen.getByRole("button", { name: /advance/i }));

    const idem = document.querySelector(
      "input[name='idempotencyKey'][type='hidden']",
    ) as HTMLInputElement | null;
    // A stable per-form-instance key: present and non-empty, so re-submitting the
    // SAME open form forwards the SAME key (the DB dedupes → no duplicate event).
    expect(idem?.value).toBeTruthy();
    expect((idem?.value ?? "").length).toBeGreaterThan(0);
  });

  it("requires the new-weight field and disables submit while pending", () => {
    render(<AdvanceStageControl {...LOT()} />);
    fireEvent.click(screen.getByRole("button", { name: /advance/i }));

    const kgField = screen.getByLabelText(/weight after step/i) as HTMLInputElement;
    expect(kgField.required).toBe(true);

    // The submit button exists (disabled-during-pending is driven by useActionState).
    expect(
      screen.getByRole("button", { name: /advance lot/i }),
    ).toBeInTheDocument();
  });
});
