import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The two client islands drive the P3-S2 Server Actions. Stub the actions so the
// dialogs render + submit WITHOUT a Supabase round-trip, and stub the router so
// router.refresh() is a no-op. next-intl is mocked globally in setup.ts (real EN
// copy), so the dialog labels come back as the strings the user sees.
const { logSampleActionMock, recordVerdictActionMock } = vi.hoisted(() => ({
  logSampleActionMock: vi.fn(),
  recordVerdictActionMock: vi.fn(),
}));
vi.mock("@/app/(app)/sales/samples/actions", () => ({
  logSampleAction: logSampleActionMock,
  recordVerdictAction: recordVerdictActionMock,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import {
  LogSampleButton,
  RecordVerdictButton,
} from "@/app/(app)/sales/samples/sample-actions.client";

const lots = [{ code: "JC-204", scaGrade: "Presidential", cuppingScore: 91 }];
const buyers = [{ id: 7, name: "Tokyo Roasters" }];

beforeEach(() => {
  logSampleActionMock.mockReset();
  recordVerdictActionMock.mockReset();
});
afterEach(cleanup);

describe("LogSampleButton (client island)", () => {
  it("opens a dialog with the log form when the trigger is clicked", () => {
    render(<LogSampleButton lots={lots} buyers={buyers} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Log a sample" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Green lot")).toBeInTheDocument();
  });

  it("submits the picked lot + grams to log_sample", async () => {
    logSampleActionMock.mockResolvedValue({ ok: true, sampleId: 1 });
    render(<LogSampleButton lots={lots} buyers={buyers} />);
    fireEvent.click(screen.getByRole("button", { name: "Log a sample" }));
    fireEvent.change(screen.getByLabelText("Grams"), { target: { value: "200" } });
    fireEvent.click(screen.getByRole("button", { name: "Log sample" }));
    await screen.findByText("Sample logged.");
    expect(logSampleActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ greenLotCode: "JC-204", grams: 200 }),
    );
  });
});

describe("RecordVerdictButton (client island)", () => {
  it("opens the verdict dialog and submits the chosen verdict to the action", async () => {
    recordVerdictActionMock.mockResolvedValue({ ok: true, sampleId: 1 });
    render(
      <RecordVerdictButton
        sampleId={1}
        lot="JC-204"
        buyerName="Tokyo Roasters"
        sampleKind="pre_shipment"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Record verdict" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save verdict" }));
    await screen.findByText("Verdict saved.");
    expect(recordVerdictActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ sampleId: 1, buyerVerdict: "approved" }),
    );
  });

  it("surfaces a server error without claiming success", async () => {
    recordVerdictActionMock.mockResolvedValue({
      ok: false,
      error: "Could not save that. Check the details and try again.",
    });
    render(
      <RecordVerdictButton
        sampleId={2}
        lot="JC-310"
        buyerName={null}
        sampleKind="offer"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Record verdict" }));
    fireEvent.click(screen.getByRole("button", { name: "Save verdict" }));
    expect(
      await screen.findByText(
        "Could not save that. Check the details and try again.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Verdict saved.")).not.toBeInTheDocument();
  });
});
