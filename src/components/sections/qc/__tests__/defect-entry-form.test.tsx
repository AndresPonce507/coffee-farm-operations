import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GreenDefect } from "@/lib/types";

/**
 * Render + behaviour test for the green-grading defect-entry form (P2-S6). This is
 * the UI half of the missing write path: before this slice, green_defects could
 * never be appended from the app, so the v_qc_status primary/secondary tallies and
 * the cup-to-cause "green-grading defects" box were permanently 0/0. The form lets a
 * grader append one defect (kind + count + primary/secondary band) through
 * recordDefectAction, and shows the append-only ledger that already exists for the
 * lot. Mirrors the cupping-scoresheet test idiom (mock the action, drive the form).
 */

const recordDefectAction = vi.fn();

vi.mock("@/app/(app)/qc/actions", () => ({
  recordDefectAction: (prev: unknown, fd: FormData) => recordDefectAction(prev, fd),
  QC_IDLE: { status: "idle" },
}));

import { DefectEntryForm } from "@/components/sections/qc/defect-entry-form";

const EXISTING: GreenDefect[] = [
  { id: 1, greenLotCode: "JC-9001", defectKind: "full black", count: 2, category: "primary" },
  { id: 2, greenLotCode: "JC-9001", defectKind: "broken", count: 4, category: "secondary" },
];

describe("DefectEntryForm (smoke)", () => {
  it("renders the defect-entry surface for a green lot", () => {
    render(<DefectEntryForm lotCode="JC-9001" defects={[]} />);
    expect(screen.getByText("JC-9001")).toBeInTheDocument();
    // a kind field, a count field, and the two bands are offered.
    expect(screen.getByLabelText(/defect kind/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/count/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add defect/i })).toBeInTheDocument();
  });

  it("offers both defect bands (primary and secondary)", () => {
    render(<DefectEntryForm lotCode="JC-9001" defects={[]} />);
    expect(screen.getByRole("button", { name: /primary/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /secondary/i })).toBeInTheDocument();
  });

  it("lists the lot's existing append-only defect ledger rows", () => {
    render(<DefectEntryForm lotCode="JC-9001" defects={EXISTING} />);
    expect(screen.getByText(/full black/i)).toBeInTheDocument();
    expect(screen.getByText(/broken/i)).toBeInTheDocument();
  });

  it("shows an honest empty state when the lot has no defects yet", () => {
    render(<DefectEntryForm lotCode="JC-9001" defects={[]} />);
    expect(screen.getByText(/no .* defects/i)).toBeInTheDocument();
  });
});

describe("DefectEntryForm (save path → defect ledger)", () => {
  beforeEach(() => {
    recordDefectAction.mockReset();
    recordDefectAction.mockResolvedValue({
      status: "success",
      message: "Defect recorded.",
    });
  });

  it("submits kind + count + the chosen band via recordDefectAction", async () => {
    render(<DefectEntryForm lotCode="JC-9001" defects={[]} />);

    fireEvent.change(screen.getByLabelText(/defect kind/i), {
      target: { value: "quaker" },
    });
    fireEvent.change(screen.getByLabelText(/count/i), { target: { value: "3" } });
    // pick the secondary band (default is primary).
    fireEvent.click(screen.getByRole("button", { name: /secondary/i }));

    fireEvent.click(screen.getByRole("button", { name: /add defect/i }));

    await waitFor(() => expect(recordDefectAction).toHaveBeenCalledTimes(1));
    const fd = recordDefectAction.mock.calls[0][1] as FormData;
    expect(fd.get("greenLotCode")).toBe("JC-9001");
    expect(fd.get("defectKind")).toBe("quaker");
    expect(fd.get("count")).toBe("3");
    expect(fd.get("category")).toBe("secondary");
  });

  it("defaults the band to primary when none is picked", async () => {
    render(<DefectEntryForm lotCode="JC-9001" defects={[]} />);

    fireEvent.change(screen.getByLabelText(/defect kind/i), {
      target: { value: "sour" },
    });
    fireEvent.change(screen.getByLabelText(/count/i), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /add defect/i }));

    await waitFor(() => expect(recordDefectAction).toHaveBeenCalledTimes(1));
    const fd = recordDefectAction.mock.calls[0][1] as FormData;
    expect(fd.get("category")).toBe("primary");
  });
});
