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
    // The JC-564 event now splits its lot code into a link, so the prose around
    // it renders as fragments rather than one text node.
    expect(screen.getByText("JC-564")).toBeInTheDocument();
    expect(screen.getByText(/moved to the drying beds/)).toBeInTheDocument();
    expect(screen.getByText("Pruning finished on Tizingal Alto")).toBeInTheDocument();
    // relativeDay("2026-06-20") against the fixed today → "Today".
    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  it("wires the lot code in an event to its lot dossier (no dead UI)", async () => {
    const ui = await ActivityFeedCard();
    render(ui);

    // The JC-564 token inside the free-text event becomes a real <a href>,
    // while the surrounding prose renders verbatim around it.
    const lotLink = screen.getByText("JC-564").closest("a");
    expect(lotLink).not.toBeNull();
    expect(lotLink).toHaveAttribute("href", "/lots/JC-564");
    // Surrounding prose preserved (split into fragments around the link).
    expect(screen.getByText(/Lot/)).toBeInTheDocument();
    expect(screen.getByText(/moved to the drying beds/)).toBeInTheDocument();
  });

  it("leaves events that name no entity as plain (non-link) text", async () => {
    const ui = await ActivityFeedCard();
    render(ui);

    // No lot code in this text → no fabricated link.
    const plain = screen
      .getByText("Crew Norte delivered 920 kg of Geisha cherries")
      .closest("a");
    expect(plain).toBeNull();
  });
});
