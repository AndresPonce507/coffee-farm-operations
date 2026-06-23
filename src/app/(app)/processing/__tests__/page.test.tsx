import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DryingLot } from "@/lib/types";

/**
 * Smoke + deep-link test for the /processing overview (P2-S4, review finding #107).
 *
 * The page is an async Server Component that awaits the lot codes and the
 * composed per-lot drying read. We mock both so it renders against a known shape
 * with no Supabase. The child sections (summary / pipeline / batch table) make
 * their own reads, so we stub them to inert markers — this test owns only the
 * page's own composition and the per-lot drying deep-link affordance.
 */

const lots = ["JC-432", "JC-571"];

const dryingLots: DryingLot[] = [
  {
    lotCode: "JC-571",
    variety: "Geisha",
    currentKg: 60,
    stationId: "st-bed-1",
    stationName: "African Bed 1",
    reposo: {
      lotCode: "JC-571",
      latestMoisture: 11.9,
      readingCount: 3,
      moistureStable: false,
      dryingStartedAt: "2026-06-14T08:00:00Z",
      restDaysElapsed: 6.2,
      restMet: true,
      ready: false,
      reason: "moisture 11.9% not yet stable in 10.5–11.5% band",
    },
    curve: [
      { lotCode: "JC-571", moisturePct: 11.9, occurredAt: "2026-06-19T08:00:00Z" },
    ],
  },
];

vi.mock("@/lib/db/lots", () => ({
  getLots: vi.fn(async (): Promise<string[]> => lots),
}));
vi.mock("@/lib/db/drying", () => ({
  getDryingLots: vi.fn(async (): Promise<DryingLot[]> => dryingLots),
}));

// The page composes three data-fetching child sections; stub them to inert
// markers so this test isolates the page's own header + deep-link composition.
vi.mock("@/components/sections/processing/processing-summary", () => ({
  ProcessingSummary: () => <div data-testid="processing-summary" />,
}));
vi.mock("@/components/sections/processing/stage-pipeline", () => ({
  StagePipeline: () => <div data-testid="stage-pipeline" />,
}));
vi.mock("@/components/sections/processing/batch-table", () => ({
  BatchTable: () => <div data-testid="batch-table" />,
}));
vi.mock("@/components/sections/processing/batch-actions", () => ({
  AddBatchButton: () => <button type="button">New batch</button>,
}));

import ProcessingPage from "@/app/(app)/processing/page";

describe("/processing page (smoke + per-lot drying deep-link)", () => {
  it("renders the header and the board link", async () => {
    const ui = await ProcessingPage();
    render(ui);

    expect(
      screen.getByRole("heading", { level: 1, name: /Beneficio/i }),
    ).toBeInTheDocument();
    // The /drying stations board link still works.
    expect(
      screen.getByRole("link", { name: /Drying & reposo/i }),
    ).toHaveAttribute("href", "/drying");
  });

  // Review finding #107 — the design promised a per-lot drying surface a manager
  // can drill into from /processing; the board was consolidated, so the missing
  // piece is a per-lot DEEP LINK (parity with /ferment, which deep-links each
  // batch). A resting lot must be reachable as a link into its lot-detail page.
  it("deep-links each resting lot into its lot-detail surface", async () => {
    const ui = await ProcessingPage();
    render(ui);

    const region = screen.getByRole("region", { name: /resting lots/i });
    const link = within(region).getByRole("link", { name: /JC-571/i });
    expect(link).toHaveAttribute("href", "/lots/JC-571");
  });
});
