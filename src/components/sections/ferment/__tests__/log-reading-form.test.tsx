import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FermentActionState } from "@/app/(app)/ferment/actions";

// useActionState calls the action with (prevState, formData); the mock returns
// whatever `nextState` is set to, so each test scripts the action's outcome and
// the spy can inspect the FormData the island carried (e.g. the idempotency key).
let nextState: FermentActionState = { status: "idle" };
const actionSpy = vi.fn(
  async (
    _prev: FermentActionState,
    _fd: FormData,
  ): Promise<FermentActionState> => nextState,
);

// Stub the Server Action import so the client island renders without next/cache.
vi.mock("@/app/(app)/ferment/actions", () => ({
  recordFermentReadingAction: (
    prev: FermentActionState,
    fd: FormData,
  ): Promise<FermentActionState> => actionSpy(prev, fd),
  FERMENT_IDLE: { status: "idle" },
}));

import { LogReadingForm } from "@/components/sections/ferment/log-reading-form";

describe("LogReadingForm (smoke)", () => {
  it("renders the batch-bound reading form with a kind picker and value input", () => {
    render(<LogReadingForm batchId="b1" />);
    // hidden batch id is carried so the reading binds to the right batch
    const batchInput = document.querySelector("input[name='batchId']") as HTMLInputElement;
    expect(batchInput).not.toBeNull();
    expect(batchInput.value).toBe("b1");

    // a value input + a submit
    expect(screen.getByLabelText(/reading|value|pH/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /log reading/i })).toBeInTheDocument();
  });

  it("offers the three reading kinds (pH / temp / Brix)", () => {
    render(<LogReadingForm batchId="b1" />);
    const kindSelect = document.querySelector("select[name='kind']");
    expect(kindSelect).not.toBeNull();
    expect(kindSelect?.textContent ?? "").toMatch(/ph/i);
    expect(kindSelect?.textContent ?? "").toMatch(/temp/i);
    expect(kindSelect?.textContent ?? "").toMatch(/brix/i);
  });

  it("carries a stable idempotency key so a double-submit dedupes", () => {
    render(<LogReadingForm batchId="b1" />);
    const idem = document.querySelector("input[name='idempotencyKey']") as HTMLInputElement;
    expect(idem).not.toBeNull();
    expect(idem.value.length).toBeGreaterThan(0);
  });

  // HIGH (regression) — the form stays mounted while the user logs many distinct
  // readings (pH, then temp, then another pH an hour later). Each successful write
  // must mint a FRESH exactly-once anchor; otherwise the 2nd+ reading carries the
  // 1st reading's key and `record_ferment_reading` short-circuits on
  // idempotency_key — the row is silently dropped while the UI shows "Reading
  // logged." The live ferment curve (the cut-point asset) loses every reading
  // after the first. A true SAME-render double-submit still re-uses the key.
  it("mints a fresh idempotency key for each DISTINCT reading after a success", async () => {
    nextState = { status: "idle" };
    actionSpy.mockClear();
    const { container } = render(<LogReadingForm batchId="b1" />);
    const form = container.querySelector("form") as HTMLFormElement;
    const hidden = () =>
      container.querySelector(
        "input[name='idempotencyKey']",
      ) as HTMLInputElement;

    const keyA = hidden().value;
    expect(keyA).toBeTruthy();

    // Reading A — lands successfully. After the success the form must mint a fresh
    // key into the hidden field so the NEXT reading is its own exactly-once event.
    nextState = { status: "success", message: "Reading logged." };
    fireEvent.submit(form);
    await waitFor(() => expect(actionSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(hidden().value).not.toBe(keyA));

    // Reading B — same mount, an hour later. It carries the freshly-minted key, so
    // it does NOT dedupe to reading A in record_ferment_reading; both rows persist.
    const keyB = hidden().value;
    fireEvent.submit(form);
    await waitFor(() => expect(actionSpy).toHaveBeenCalledTimes(2));

    expect((actionSpy.mock.calls[0][1] as FormData).get("idempotencyKey")).toBe(
      keyA,
    );
    expect((actionSpy.mock.calls[1][1] as FormData).get("idempotencyKey")).toBe(
      keyB,
    );
    expect(keyB).not.toBe(keyA);
  });
});
