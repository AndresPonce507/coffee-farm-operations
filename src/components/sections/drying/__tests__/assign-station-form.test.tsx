import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DryingActionState } from "@/app/(app)/drying/actions";
import type { StationOccupancy } from "@/lib/types";

/**
 * Render + behaviour test for the assign-station client island — the write that
 * commits a drying lot to a station bed (consuming its capacity, fail-closed
 * against `prevent_overcapacity`). The Server Action is mocked; this proves the
 * island's contract:
 *   - the lot + station fields render, the station select offers the passed
 *     stations (with their available headroom),
 *   - submitting drives the bound Server Action once,
 *   - a SUCCESS state confirms the assignment, a capacity error renders inline.
 *
 * Mirrors the action-mock + useActionState idiom in cherry-intake-form.test.tsx.
 */

let nextState: DryingActionState = { status: "idle" };
const actionSpy = vi.fn(
  async (
    _prev: DryingActionState,
    _fd: FormData,
  ): Promise<DryingActionState> => nextState,
);

vi.mock("@/app/(app)/drying/actions", () => ({
  DRYING_IDLE: { status: "idle" },
  assignStationAction: (
    prev: DryingActionState,
    fd: FormData,
  ): Promise<DryingActionState> => actionSpy(prev, fd),
}));

import { AssignStationForm } from "@/components/sections/drying/assign-station-form";

const lots = ["JC-571", "JC-572"];
const stations: StationOccupancy[] = [
  { stationId: "st-bed-1", name: "African Bed 1", kind: "raised-bed", capacityKg: 600, committedKg: 60, availableKg: 540 },
  { stationId: "st-patio", name: "Patio", kind: "patio", capacityKg: 400, committedKg: 400, availableKg: 0 },
];

function renderForm() {
  return render(
    <AssignStationForm lots={lots} stations={stations} onDone={() => {}} />,
  );
}

describe("AssignStationForm", () => {
  it("renders the lot + station fields with the passed options", () => {
    renderForm();

    expect(screen.getByLabelText(/lot/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/station/i)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "JC-571" })).toBeInTheDocument();
    // station options carry the station name (and may annotate headroom)
    expect(
      screen.getByRole("option", { name: /African Bed 1/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /assign/i }),
    ).toBeInTheDocument();
  });

  it("marks the mandatory fields (lot, station) as required", () => {
    const { container } = renderForm();
    expect(container.querySelector('[name="lotCode"]')).toHaveAttribute("required");
    expect(container.querySelector('[name="stationId"]')).toHaveAttribute("required");
  });

  it("submitting drives the bound Server Action once", async () => {
    nextState = { status: "idle" };
    actionSpy.mockClear();
    const { container } = renderForm();
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    await waitFor(() => expect(actionSpy).toHaveBeenCalledTimes(1));
  });

  it("on success confirms the assignment", async () => {
    nextState = {
      status: "success",
      message: "Lot JC-571 assigned to its station.",
      lotCode: "JC-571",
    };
    actionSpy.mockClear();
    const { container } = renderForm();
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    expect(await screen.findByText(/assigned to its station/i)).toBeInTheDocument();
  });

  it("renders a friendly capacity error inline (no raw SQL)", async () => {
    nextState = {
      status: "error",
      message: "Station st-patio is full — committing this lot would exceed its capacity. Move some beds first.",
    };
    actionSpy.mockClear();
    const { container } = renderForm();
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    expect(await screen.findByText(/is full/i)).toBeInTheDocument();
    expect(screen.queryByText(/capacity guard:|check constraint|violates/i)).toBeNull();
  });
});
