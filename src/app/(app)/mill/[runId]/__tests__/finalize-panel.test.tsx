import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MillRunFinalizeView } from "@/app/(app)/mill/[runId]/data";

// Both Server Actions are mocked — these are CLIENT islands, so the test pins their
// own job: render the form, preview the SCA band live from the defect counts (the UI
// courtesy mirror of the GENERATED column), gate the mint behind a closed mass balance
// + a human confirm (money/mass-shaped write), and fire the action with a fresh
// idempotency key. We never assert the DB behaviour here — that is the db test's job.
const { finalizeMock, regradeMock } = vi.hoisted(() => ({
  finalizeMock: vi.fn(),
  regradeMock: vi.fn(),
}));
vi.mock("@/app/(app)/mill/[runId]/actions", () => ({
  finalizeMillingRunAction: finalizeMock,
  recordGreenGradeAction: regradeMock,
}));

import { FinalizePanel, RegradePanel } from "@/app/(app)/mill/[runId]/finalize-panel.client";

const BALANCED = {
  parchmentIn: 100,
  sumPassOutput: 82,
  sumReject: 3,
  sumByproduct: 12,
  greenOut: 82,
  accountedMoistureLoss: 2,
  unaccountedLoss: 1,
  lossCeiling: 2,
  balanceOk: true,
};

const OPEN: MillRunFinalizeView = {
  runId: 7,
  parchmentLotCode: "JC-310",
  variety: "Geisha",
  parchmentKgIn: 100,
  greenKgOut: null,
  outturnPct: null,
  status: "open",
  openedAt: "2026-06-20T10:00:00Z",
  balance: BALANCED,
  mintedGreenLotCode: null,
  grade: null,
};

const OPEN_UNBALANCED: MillRunFinalizeView = {
  ...OPEN,
  balance: { ...BALANCED, unaccountedLoss: 18, balanceOk: false },
};

beforeEach(() => {
  finalizeMock.mockReset();
  regradeMock.mockReset();
});
afterEach(cleanup);

describe("FinalizePanel (client island)", () => {
  it("defaults the green-out field to the final machine-pass output and previews the SCA band live", () => {
    render(<FinalizePanel view={OPEN} />);

    const greenKg = screen.getByLabelText(/Green out/) as HTMLInputElement;
    expect(greenKg.value).toBe("82");

    // 0 primary + 0 secondary → EP-Specialty preview band.
    expect(screen.getByTestId("sca-preview")).toHaveTextContent("EP-Specialty");

    // bump category-1 defects to 1 → the preview drops to Premium live.
    fireEvent.change(screen.getByLabelText(/Category 1/), { target: { value: "1" } });
    expect(screen.getByTestId("sca-preview")).toHaveTextContent("Premium");
  });

  it("disables the mint when the mass balance does not close (the DB is the real wall)", () => {
    render(<FinalizePanel view={OPEN_UNBALANCED} />);
    const mint = screen.getByRole("button", { name: "Mint green lot" });
    expect(mint).toBeDisabled();
    expect(screen.getByText(/mass balance must close/i)).toBeInTheDocument();
  });

  it("requires a human confirm before firing the money/mass-shaped finalize write", async () => {
    finalizeMock.mockResolvedValue({ ok: true, greenLotCode: "JC-742" });
    render(<FinalizePanel view={OPEN} />);

    fireEvent.change(screen.getByLabelText(/Store location/), {
      target: { value: "Bodega A" },
    });
    // opening the form does not call the action — a human must confirm first.
    fireEvent.click(screen.getByRole("button", { name: "Mint green lot" }));
    expect(finalizeMock).not.toHaveBeenCalled();

    // the irreversible confirm dialog appears; confirming fires the action.
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Mint green lot" }));
    expect(finalizeMock).toHaveBeenCalledTimes(1);
    const arg = finalizeMock.mock.calls[0][0];
    expect(arg).toMatchObject({
      runId: 7,
      greenKgOut: 82,
      location: "Bodega A",
      cat1Defects: 0,
      cat2Defects: 0,
    });
    expect(typeof arg.idempotencyKey).toBe("string");
    expect(arg.idempotencyKey.length).toBeGreaterThan(0);
  });
});

describe("RegradePanel (client island)", () => {
  it("fires record_green_grade for the minted lot with a fresh idempotency key", async () => {
    regradeMock.mockResolvedValue({ ok: true, gradeId: 55 });
    render(<RegradePanel greenLotCode="JC-742" />);

    fireEvent.click(screen.getByRole("button", { name: "Re-grade" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Category 2/), {
      target: { value: "4" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save grade" }));

    expect(regradeMock).toHaveBeenCalledTimes(1);
    const arg = regradeMock.mock.calls[0][0];
    expect(arg).toMatchObject({ greenLotCode: "JC-742", cat2Defects: 4 });
    expect(typeof arg.idempotencyKey).toBe("string");
  });
});
