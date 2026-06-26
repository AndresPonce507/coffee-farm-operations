import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The write island drives the P3-S16 record_fx_rate Server Action. Stub the action
// so the dialog renders + submits WITHOUT a Supabase round-trip, and stub the router
// so router.refresh() is a no-op. next-intl is mocked globally (real EN copy), so the
// dialog labels come back as the strings the user sees.
const { recordFxRateActionMock } = vi.hoisted(() => ({
  recordFxRateActionMock: vi.fn(),
}));
vi.mock("@/app/(app)/margins/actions", () => ({
  recordFxRateAction: recordFxRateActionMock,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { RecordFxRateButton } from "@/app/(app)/margins/fx-rate-form.client";

beforeEach(() => recordFxRateActionMock.mockReset());
afterEach(cleanup);

describe("RecordFxRateButton (client island)", () => {
  it("opens a dialog with the FX form when the trigger is clicked", () => {
    render(<RecordFxRateButton />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Record FX rate" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Base currency")).toBeInTheDocument();
  });

  it("submits the entered pair + rate to record_fx_rate and confirms success", async () => {
    recordFxRateActionMock.mockResolvedValue({ ok: true, rateId: 5 });
    render(<RecordFxRateButton />);
    fireEvent.click(screen.getByRole("button", { name: "Record FX rate" }));
    fireEvent.change(screen.getByLabelText("Base currency"), {
      target: { value: "GBP" },
    });
    fireEvent.change(screen.getByLabelText("Rate (base to quote)"), {
      target: { value: "1.27" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record rate" }));
    await screen.findByText("Rate recorded.");
    expect(recordFxRateActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ base: "GBP", rate: 1.27 }),
    );
  });

  it("surfaces a server error without claiming success", async () => {
    recordFxRateActionMock.mockResolvedValue({
      ok: false,
      error: "A rate for that day and currency pair is already on the books.",
    });
    render(<RecordFxRateButton />);
    fireEvent.click(screen.getByRole("button", { name: "Record FX rate" }));
    fireEvent.change(screen.getByLabelText("Base currency"), {
      target: { value: "EUR" },
    });
    fireEvent.change(screen.getByLabelText("Rate (base to quote)"), {
      target: { value: "1.08" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record rate" }));
    expect(
      await screen.findByText(
        "A rate for that day and currency pair is already on the books.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Rate recorded.")).not.toBeInTheDocument();
  });
});
