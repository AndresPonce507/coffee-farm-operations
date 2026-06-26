import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P3-S8 — the <MassBalanceWorkspace> client island smoke + behaviour test.
 *
 * The island is the ONE interactive surface in /mill/[runId]/balance. Mock the two
 * Server Actions + next/navigation's router so this test pins the island's job:
 * collect a pass / byproduct, fire the correct action with the continuity-locked
 * envelope (next pass-no, input pre-filled from the prior pass output), refresh the
 * server tree on success, and refuse to render the forms once the run is not open.
 */
const { recordMillPassActionMock, recordMillByproductActionMock } = vi.hoisted(
  () => ({
    recordMillPassActionMock: vi.fn(),
    recordMillByproductActionMock: vi.fn(),
  }),
);
const refreshMock = vi.fn();

vi.mock("@/app/(app)/mill/[runId]/balance/actions", () => ({
  recordMillPassAction: recordMillPassActionMock,
  recordMillByproductAction: recordMillByproductActionMock,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { MassBalanceWorkspace } from "@/app/(app)/mill/[runId]/balance/mass-balance-workspace.client";

const openProps = {
  runId: 712,
  status: "open" as const,
  parchmentKgIn: 1000,
  lastPassNo: 2,
  lastPassOutputKg: 850,
};

beforeEach(() => {
  recordMillPassActionMock.mockReset();
  recordMillByproductActionMock.mockReset();
  refreshMock.mockReset();
});
afterEach(cleanup);

describe("MassBalanceWorkspace (open run)", () => {
  it("renders both the pass and byproduct recorders", () => {
    render(<MassBalanceWorkspace {...openProps} />);
    expect(screen.getByText("Record a machine pass")).toBeInTheDocument();
    expect(screen.getByText("Record a byproduct")).toBeInTheDocument();
  });

  it("fires record_mill_pass with the continuity-locked envelope, then refreshes the tree", async () => {
    recordMillPassActionMock.mockResolvedValue({ ok: true, passId: 9 });
    render(<MassBalanceWorkspace {...openProps} />);

    fireEvent.change(screen.getByLabelText("Machine"), {
      target: { value: "polisher" },
    });
    fireEvent.change(screen.getByLabelText("Clean output (kg)"), {
      target: { value: "850" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record pass" }));

    await waitFor(() =>
      expect(recordMillPassActionMock).toHaveBeenCalledTimes(1),
    );
    expect(recordMillPassActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 712,
        passNo: 3, // lastPassNo + 1
        machineKind: "polisher",
        inputKg: 850, // pre-filled from the prior pass output (continuity)
        outputKg: 850,
        rejectKg: 0,
      }),
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("surfaces a failed pass write and does NOT refresh", async () => {
    recordMillPassActionMock.mockResolvedValue({
      ok: false,
      error: "milling run 712 is finalized",
    });
    render(<MassBalanceWorkspace {...openProps} />);

    fireEvent.change(screen.getByLabelText("Machine"), {
      target: { value: "huller" },
    });
    fireEvent.change(screen.getByLabelText("Clean output (kg)"), {
      target: { value: "800" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record pass" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/finalized/),
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("fires record_mill_byproduct with the chosen stream + kg, then shows the minted lot", async () => {
    recordMillByproductActionMock.mockResolvedValue({
      ok: true,
      byproductLotCode: "JC-805",
    });
    render(<MassBalanceWorkspace {...openProps} />);

    fireEvent.change(screen.getByLabelText("Byproduct kind"), {
      target: { value: "husk" },
    });
    fireEvent.change(screen.getByLabelText("Kilograms"), {
      target: { value: "80" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record byproduct" }));

    await waitFor(() =>
      expect(recordMillByproductActionMock).toHaveBeenCalledWith(
        expect.objectContaining({ runId: 712, kind: "husk", kg: 80 }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByText(/JC-805/)).toBeInTheDocument(),
    );
  });
});

describe("MassBalanceWorkspace (closed run)", () => {
  it("hides the recorders and explains the run is not open", () => {
    render(<MassBalanceWorkspace {...openProps} status="finalized" />);
    expect(screen.queryByText("Record a machine pass")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(/finalized/i);
  });
});
