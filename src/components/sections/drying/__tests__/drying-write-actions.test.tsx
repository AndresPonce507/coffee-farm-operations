import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StationOccupancy } from "@/lib/types";

/**
 * Render + behaviour test for the drying write triggers — the two primary
 * affordances (record-reading + assign-station) that open the glass dialogs
 * hosting the drying write forms. The form islands are mocked (their own
 * contracts are pinned by their co-located tests); this proves the triggers:
 * both buttons render, and opening each reveals the dialog with the right form.
 */

vi.mock("@/app/(app)/drying/actions", () => ({
  DRYING_IDLE: { status: "idle" },
  recordMoistureAction: vi.fn(),
  assignStationAction: vi.fn(),
}));

vi.mock("@/components/sections/drying/record-moisture-form", () => ({
  RecordMoistureForm: () => <div data-testid="record-moisture-form" />,
}));
vi.mock("@/components/sections/drying/assign-station-form", () => ({
  AssignStationForm: () => <div data-testid="assign-station-form" />,
}));

import { DryingWriteActions } from "@/components/sections/drying/drying-write-actions";

const lots = ["JC-571"];
const stations: StationOccupancy[] = [
  { stationId: "st-bed-1", name: "African Bed 1", kind: "raised-bed", capacityKg: 600, committedKg: 60, availableKg: 540 },
];

describe("DryingWriteActions", () => {
  it("renders both triggers and opens each dialog with the right form", () => {
    render(<DryingWriteActions lots={lots} stations={stations} />);

    const recordTrigger = screen.getByRole("button", { name: /record reading/i });
    const assignTrigger = screen.getByRole("button", { name: /assign station/i });
    expect(recordTrigger).toBeInTheDocument();
    expect(assignTrigger).toBeInTheDocument();

    // closed initially
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(recordTrigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("record-moisture-form")).toBeInTheDocument();
    expect(screen.queryByTestId("assign-station-form")).toBeNull();

    // close (Escape) then open the other
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(assignTrigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("assign-station-form")).toBeInTheDocument();
  });
});
