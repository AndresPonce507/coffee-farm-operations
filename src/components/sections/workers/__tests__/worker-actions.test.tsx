import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Worker } from "@/lib/types";

// WorkerRowActions imports the Server Actions; stub them so the component
// renders without pulling in next/cache or the Supabase client. deleteWorker is
// configurable per-test so the error path can be exercised.
const deleteWorkerMock = vi.fn();
vi.mock("@/lib/actions/workers", () => ({
  createWorker: vi.fn(),
  updateWorker: vi.fn(),
  deleteWorker: (id: string) => deleteWorkerMock(id),
  IDLE: { status: "idle" },
}));

import { WorkerRowActions } from "@/components/sections/workers/worker-actions";

const WORKER: Worker = {
  id: "w1", name: "Eduardo Pérez", role: "Picker", dailyRateUsd: 22,
  attendance: "present", startedYear: 2015, phone: "+507 6612-7741",
  todayKg: 78, crew: "Crew Norte",
};

const CREWS = ["Crew Norte", "Field Ops"] as const;

afterEach(() => {
  vi.restoreAllMocks();
  deleteWorkerMock.mockReset();
});

describe("WorkerRowActions", () => {
  // a11y — the icon-only Edit/Delete buttons must carry a visible focus ring
  // (keyboard users have no other affordance). FOCUS_RING tokens:
  // focus-visible:ring-2 / ring-forest/40 / ring-offset-2 / ring-offset-paper.
  it("renders a focus-visible ring on both icon-buttons", () => {
    render(<WorkerRowActions worker={WORKER} crews={CREWS} />);

    for (const label of [/edit eduardo pérez/i, /delete eduardo pérez/i]) {
      const btn = screen.getByRole("button", { name: label });
      expect(btn).toHaveClass(
        "focus-visible:outline-none",
        "focus-visible:ring-2",
        "focus-visible:ring-forest/40",
        "focus-visible:ring-offset-2",
        "focus-visible:ring-offset-paper",
      );
    }
  });

  // A failed delete must NOT be swallowed — surface the DB message inline.
  it("surfaces an inline alert when deleteWorker returns an error", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    deleteWorkerMock.mockResolvedValue({
      status: "error",
      message: "permission denied for table workers",
    });

    render(<WorkerRowActions worker={WORKER} crews={CREWS} />);
    fireEvent.click(screen.getByRole("button", { name: /delete eduardo pérez/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("permission denied for table workers");
    expect(deleteWorkerMock).toHaveBeenCalledWith("w1");
  });

  it("shows no alert when deleteWorker succeeds", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    deleteWorkerMock.mockResolvedValue({ status: "success", message: "Worker deleted." });

    render(<WorkerRowActions worker={WORKER} crews={CREWS} />);
    fireEvent.click(screen.getByRole("button", { name: /delete eduardo pérez/i }));

    await waitFor(() => expect(deleteWorkerMock).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
