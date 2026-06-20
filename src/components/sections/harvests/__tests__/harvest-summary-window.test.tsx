import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Harvest } from "@/lib/types";

// The component anchors its "today" on 2026-06-20, so the inclusive seven-day
// window is 2026-06-14 .. 2026-06-20 in EVERY timezone. We seed three rows:
//   - today (2026-06-20)         -> inside the window
//   - window start (2026-06-14)  -> inside the window (the boundary day)
//   - day before (2026-06-13)    -> OUTSIDE the window
// The "Last 7 days" total must be 644 + 100 = 744 kg (today + boundary),
// excluding the 50 kg from 2026-06-13.
//
// Regression guard: when the window is built with locale-local Date math, a
// host east of UTC (e.g. Asia/Tokyo) shifts the whole window back one day, which
// DROPS today's 644 kg and (wrongly) PULLS IN the out-of-window 50 kg. This test
// fails under TZ=Asia/Tokyo on that buggy code and passes once the window is
// computed with UTC-anchored arithmetic.
vi.mock("@/lib/db/harvests", () => ({
  getHarvests: vi.fn(
    async (): Promise<Harvest[]> => [
      {
        id: "today", date: "2026-06-20", plotId: "p1", plotName: "Tizingal Alto",
        picker: "Marisol Quintero", cherriesKg: 644, ripenessPct: 96,
        brixAvg: 21.4, lotCode: "JC-564",
      },
      {
        id: "window-start", date: "2026-06-14", plotId: "p2", plotName: "Paso Ancho",
        picker: "Diego Santamaría", cherriesKg: 100, ripenessPct: 90,
        brixAvg: 20.0, lotCode: "JC-565",
      },
      {
        id: "before-window", date: "2026-06-13", plotId: "p3", plotName: "El Salto",
        picker: "Ana Beltrán", cherriesKg: 50, ripenessPct: 88,
        brixAvg: 19.6, lotCode: "JC-566",
      },
    ],
  ),
}));

import { HarvestSummary } from "@/components/sections/harvests/harvest-summary";

/** Find the tile whose label text matches, then return that tile's element. */
function tileByLabel(label: string): HTMLElement {
  const labelEl = screen.getByText(label);
  // In <Tile>, the label <p> and the value <p> are siblings inside the tile's
  // root <div>, so the label's parent element IS that tile (and only that tile).
  const tile = labelEl.parentElement;
  if (!tile) throw new Error(`Could not locate tile for label "${label}"`);
  return tile as HTMLElement;
}

describe("HarvestSummary — Last 7 days window is timezone-stable", () => {
  it("includes today's kg in the trailing-week total regardless of host TZ", async () => {
    const ui = await HarvestSummary();
    render(ui);

    // The window is 2026-06-14..2026-06-20: today (644) + boundary (100) = 744,
    // excluding the 2026-06-13 row (50). In a tz-shifted window today drops out
    // and the total comes out 150 (100 + 50) instead.
    const weekTile = tileByLabel("Last 7 days");
    expect(within(weekTile).getByText("744 kg")).toBeInTheDocument();

    // And today's own tile still reflects today's intake.
    const todayTile = tileByLabel("Today");
    expect(within(todayTile).getByText("644 kg")).toBeInTheDocument();
  });
});
