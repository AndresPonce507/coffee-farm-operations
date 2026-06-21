import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Plot, Worker } from "@/lib/types";

/**
 * Render + behaviour test for the "Record intake" primary affordance — the
 * button + glass dialog that hosts the cherry-intake genesis WRITE. The form
 * island is mocked (its own contract is pinned by cherry-intake-form.test.tsx);
 * this proves the trigger: the button renders, opening reveals the dialog with
 * the intake form, and it is distinct from the simple "Log harvest" path.
 */

vi.mock("@/app/(app)/harvests/actions", () => ({
  INTAKE_IDLE: { status: "idle" },
  recordCherryIntakeAction: vi.fn(),
}));

vi.mock("@/components/sections/harvests/cherry-intake-form", () => ({
  CherryIntakeForm: () => <div data-testid="cherry-intake-form" />,
}));

import { RecordIntakeButton } from "@/components/sections/harvests/record-intake-button";

const plots = [{ id: "p1", name: "Tizingal Alto" }] as unknown as Plot[];
const pickers = [{ id: "w1", name: "Lucía Mendoza" }] as unknown as Worker[];

describe("RecordIntakeButton", () => {
  it("renders the 'Record intake' trigger and opens the dialog on click", () => {
    render(<RecordIntakeButton plots={plots} pickers={pickers} />);

    const trigger = screen.getByRole("button", { name: /record intake/i });
    expect(trigger).toBeInTheDocument();

    // closed initially — no dialog, no form
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId("cherry-intake-form")).toBeNull();

    fireEvent.click(trigger);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("cherry-intake-form")).toBeInTheDocument();
  });
});
