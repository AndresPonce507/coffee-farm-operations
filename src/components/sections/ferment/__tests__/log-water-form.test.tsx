import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FermentActionState } from "@/app/(app)/ferment/actions";

// useActionState calls the action with (prevState, formData); the mock returns
// whatever `nextState` is set to, so each test scripts the action's outcome and
// the spy can inspect the FormData the island carried (e.g. the liters value).
let nextState: FermentActionState = { status: "idle" };
const actionSpy = vi.fn(
  async (
    _prev: FermentActionState,
    _fd: FormData,
  ): Promise<FermentActionState> => nextState,
);

// Stub the Server Action import so the client island renders without next/cache.
vi.mock("@/app/(app)/ferment/actions", () => ({
  logMillWaterAction: (
    prev: FermentActionState,
    fd: FormData,
  ): Promise<FermentActionState> => actionSpy(prev, fd),
  FERMENT_IDLE: { status: "idle" },
}));

import { LogWaterForm } from "@/components/sections/ferment/log-water-form";

describe("LogWaterForm (smoke)", () => {
  it("renders the batch-bound water form with a liters input and a submit", () => {
    render(<LogWaterForm batchId="b1" />);
    // hidden batch id is carried so the water draw binds to the right batch
    const batchInput = document.querySelector(
      "input[name='batchId']",
    ) as HTMLInputElement;
    expect(batchInput).not.toBeNull();
    expect(batchInput.value).toBe("b1");

    // a liters input + a submit affordance
    const liters = document.querySelector(
      "input[name='liters']",
    ) as HTMLInputElement;
    expect(liters).not.toBeNull();
    expect(liters.type).toBe("number");
    expect(
      screen.getByRole("button", { name: /record mill water/i }),
    ).toBeInTheDocument();
  });

  it("carries a stable idempotency key so a double-submit dedupes", () => {
    render(<LogWaterForm batchId="b1" />);
    const idem = document.querySelector(
      "input[name='idempotencyKey']",
    ) as HTMLInputElement;
    expect(idem).not.toBeNull();
    expect(idem.value.length).toBeGreaterThan(0);
  });

  it("invokes logMillWaterAction carrying the liters the worker entered", async () => {
    nextState = { status: "idle" };
    actionSpy.mockClear();
    const { container } = render(<LogWaterForm batchId="b1" />);
    const form = container.querySelector("form") as HTMLFormElement;
    const liters = container.querySelector(
      "input[name='liters']",
    ) as HTMLInputElement;

    fireEvent.change(liters, { target: { value: "45" } });
    fireEvent.submit(form);

    await waitFor(() => expect(actionSpy).toHaveBeenCalledTimes(1));
    const fd = actionSpy.mock.calls[0][1] as FormData;
    expect(fd.get("liters")).toBe("45");
    expect(fd.get("batchId")).toBe("b1");
  });

  it("labels the liters input and guards against negatives", () => {
    nextState = { status: "idle" };
    render(<LogWaterForm batchId="b1" />);
    // the field names "Liters of water" so the worker reads it.
    expect(screen.getByLabelText(/liters of water/i)).toBeInTheDocument();
    const liters = document.querySelector(
      "input[name='liters']",
    ) as HTMLInputElement;
    // the SQL CHECK is liters > 0; the input echoes that as a client-side floor.
    expect(liters.getAttribute("min")).toBe("0");
  });
});
