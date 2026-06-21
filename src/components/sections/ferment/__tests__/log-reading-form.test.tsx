import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Stub the Server Action import so the client island renders without next/cache.
vi.mock("@/app/(app)/ferment/actions", () => ({
  recordFermentReadingAction: vi.fn(),
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
});
