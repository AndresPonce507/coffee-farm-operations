import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Plot } from "@/lib/types";

// PlotRowActions imports the Server Actions; stub them so the component renders
// without pulling in next/cache or the Supabase client. deletePlot is
// configurable per-test so the error path can be exercised.
const deletePlotMock = vi.fn();
vi.mock("@/lib/actions/plots", () => ({
  createPlot: vi.fn(),
  updatePlot: vi.fn(),
  deletePlot: (id: string) => deletePlotMock(id),
  IDLE: { status: "idle" },
}));

import { PlotRowActions } from "@/components/sections/plots/plot-actions";

const PLOT: Plot = {
  id: "p1", name: "Tizingal Alto", block: "Block A", variety: "Geisha",
  areaHa: 4.2, altitudeMasl: 1690, trees: 14800, shadePct: 55,
  establishedYear: 2014, status: "healthy", lastInspected: "2026-06-18",
  expectedYieldKg: 18600, harvestedKg: 12120,
};

afterEach(() => {
  vi.restoreAllMocks();
  deletePlotMock.mockReset();
});

describe("PlotRowActions", () => {
  // a11y — the icon-only Edit/Delete buttons must carry a visible focus ring
  // (keyboard users have no other affordance). FOCUS_RING tokens:
  // focus-visible:ring-2 / ring-forest/40 / ring-offset-2 / ring-offset-paper.
  it("renders a focus-visible ring on both icon-buttons", () => {
    render(<PlotRowActions plot={PLOT} />);

    for (const label of [/edit tizingal alto/i, /delete tizingal alto/i]) {
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
  it("surfaces an inline alert when deletePlot returns an error", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    deletePlotMock.mockResolvedValue({
      status: "error",
      message: "permission denied for table plots",
    });

    render(<PlotRowActions plot={PLOT} />);
    fireEvent.click(screen.getByRole("button", { name: /delete tizingal alto/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("permission denied for table plots");
    expect(deletePlotMock).toHaveBeenCalledWith("p1");
  });

  it("shows no alert when deletePlot succeeds", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    deletePlotMock.mockResolvedValue({ status: "success", message: "Plot deleted." });

    render(<PlotRowActions plot={PLOT} />);
    fireEvent.click(screen.getByRole("button", { name: /delete tizingal alto/i }));

    await waitFor(() => expect(deletePlotMock).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
