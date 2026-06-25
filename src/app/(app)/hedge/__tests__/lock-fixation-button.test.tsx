import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LockFixationButton } from "@/app/(app)/hedge/lock-fixation-button";
import type { FixationExposureRow } from "@/app/(app)/hedge/types";

// Behaviour coverage for the interactive lock island (the cockpit smoke test only
// mounts it). Locking the "C" leg is a money-shaped, IRREVERSIBLE write: it must
// ARM a human confirm before firing, fire `lock_fixation` exactly once with the
// quote id + a client-minted idempotency key, surface raises as clean sentences,
// and — the seam guard — NEVER fire when the quote id is unresolved.
afterEach(cleanup);

const baseRow: FixationExposureRow = {
  priceQuoteId: 101,
  greenLotCode: "JC-COMM-1",
  reservationId: 5001,
  kg: 2000,
  iceCContractMonth: "2026-12",
  currentCPrice: 1.85,
  exposureUsd: 1000,
};

describe("LockFixationButton — the irreversible C-leg lock", () => {
  it("arms a confirm dialog spelling out the irreversibility — no write on the first tap", () => {
    const action = vi.fn(async () => ({ ok: true as const }));
    render(<LockFixationButton row={baseRow} action={action} />);

    expect(action).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Lock fixation/i }));

    expect(screen.getByText(/This is irreversible/i)).toBeInTheDocument();
    // Arming is not firing — the RPC is untouched until the explicit confirm.
    expect(action).not.toHaveBeenCalled();
  });

  it("fires lock_fixation once with the quote id + a minted key, then settles to a locked chip", async () => {
    const action = vi.fn(async () => ({ ok: true as const, fixationId: 7 }));
    render(<LockFixationButton row={baseRow} action={action} />);

    fireEvent.click(screen.getByRole("button", { name: /Lock fixation/i }));
    fireEvent.click(screen.getByRole("button", { name: /Lock the C leg/i }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(action).toHaveBeenCalledWith({
      priceQuoteId: 101,
      idempotencyKey: expect.any(String),
    });
    // floating → locked: the live button is replaced by the settled chip.
    expect(await screen.findByText("C leg locked")).toBeInTheDocument();
  });

  it("surfaces the friendly raise and stays UN-locked when the RPC rejects (e.g. a reserve quote)", async () => {
    const action = vi.fn(async () => ({
      ok: false as const,
      error: "Only commodity quotes carry an ICE \"C\" leg to fix.",
    }));
    render(<LockFixationButton row={baseRow} action={action} />);

    fireEvent.click(screen.getByRole("button", { name: /Lock fixation/i }));
    fireEvent.click(screen.getByRole("button", { name: /Lock the C leg/i }));

    expect(
      await screen.findByText(/Only commodity quotes carry an ICE/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("C leg locked")).not.toBeInTheDocument();
  });

  it("CANNOT fire when the quote-id seam is unresolved (priceQuoteId null) — disabled, never a wrong-id lock", () => {
    const action = vi.fn(async () => ({ ok: true as const }));
    render(
      <LockFixationButton
        row={{ ...baseRow, priceQuoteId: null }}
        action={action}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Lock fixation/i }));
    const confirm = screen.getByRole("button", { name: /Lock the C leg/i });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(action).not.toHaveBeenCalled();
  });
});
