import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityItem } from "@/lib/types";

// ActivityFeedCard is an async Server Component that awaits getActivity.
// Mock the activity module so the smoke test renders against a known feed.
vi.mock("@/lib/db/activity", () => ({
  getActivity: vi.fn(
    async (): Promise<ActivityItem[]> => [
      { id: "a1", at: "2026-06-20", kind: "harvest", text: "Crew Norte delivered 920 kg of Geisha cherries" },
      { id: "a2", at: "2026-06-19", kind: "processing", text: "Lot JC-564 moved to the drying beds" },
      { id: "a3", at: "2026-06-18", kind: "task", text: "Pruning finished on Tizingal Alto" },
    ],
  ),
}));

import { ActivityFeedCard } from "@/components/sections/dashboard/activity-feed-card";

// vitest config has no globals, so RTL's auto afterEach(cleanup) isn't registered;
// register it explicitly so each test renders into a fresh document body.
afterEach(cleanup);

describe("ActivityFeedCard (smoke)", () => {
  it("renders the card title without throwing", async () => {
    const ui = await ActivityFeedCard();
    render(ui);

    expect(screen.getByText("Recent activity")).toBeInTheDocument();
  });

  it("renders an entry per activity item from the data layer", async () => {
    const ui = await ActivityFeedCard();
    render(ui);

    expect(
      screen.getByText("Crew Norte delivered 920 kg of Geisha cherries"),
    ).toBeInTheDocument();
    expect(screen.getByText("Lot JC-564 moved to the drying beds")).toBeInTheDocument();
    expect(screen.getByText("Pruning finished on Tizingal Alto")).toBeInTheDocument();
    // relativeDay("2026-06-20") against the fixed today → "Today".
    expect(screen.getByText("Today")).toBeInTheDocument();
  });
});
