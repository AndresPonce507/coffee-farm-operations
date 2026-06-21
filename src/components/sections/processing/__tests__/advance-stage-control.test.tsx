import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ProcessingBatch } from "@/lib/types";

// The control drives the advance Server Action via useActionState. Stub the
// action module so the island renders + submits without next/cache or Supabase.
const advanceMock = vi.fn();
vi.mock("@/app/(app)/processing/actions", () => ({
  advanceStageAction: (...args: unknown[]) => advanceMock(...args),
  PROCESSING_IDLE: { status: "idle" },
}));

import { AdvanceStageControl } from "@/components/sections/processing/advance-stage-control";

const BATCH: ProcessingBatch = {
  id: "b2",
  lotCode: "JC-561",
  variety: "Caturra",
  method: "Natural",
  stage: "drying",
  startedDate: "2026-06-14",
  cherriesKg: 980,
  currentKg: 420,
  moisturePct: 18,
  patio: "Bed 7",
  progressPct: 55,
};

describe("AdvanceStageControl (the pipeline advance island)", () => {
  it("renders an advance trigger for a lot that is not yet green", () => {
    render(<AdvanceStageControl batch={BATCH} />);
    expect(
      screen.getByRole("button", { name: /advance/i }),
    ).toBeInTheDocument();
  });

  it("opens the advance dialog carrying the lot code as a hidden field", () => {
    render(<AdvanceStageControl batch={BATCH} />);
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

  it("defaults the target stage to the NEXT forward stage (drying -> parchment)", () => {
    render(<AdvanceStageControl batch={BATCH} />);
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
  });

  it("does not render an advance trigger for a green (finished) lot", () => {
    render(<AdvanceStageControl batch={{ ...BATCH, stage: "green" }} />);
    expect(
      screen.queryByRole("button", { name: /advance/i }),
    ).not.toBeInTheDocument();
  });
});
