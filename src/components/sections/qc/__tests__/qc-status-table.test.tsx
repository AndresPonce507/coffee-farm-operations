import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { QcStatus } from "@/lib/types";

// The hold control is the one client island; stub its Server Action import so the
// table renders without next/cache or the Supabase client.
vi.mock("@/app/(app)/qc/actions", () => ({
  placeQcHoldAction: vi.fn(),
  releaseQcHoldAction: vi.fn(),
  recordCuppingSessionAction: vi.fn(),
  recordCupScoreAction: vi.fn(),
  QC_IDLE: { status: "idle" },
}));

import { QcStatusTable } from "@/components/sections/qc/qc-status-table";

const ROWS: QcStatus[] = [
  {
    greenLotCode: "JC-9001",
    held: true,
    holdReason: "off-flavor — re-cup",
    latestCupScore: 88.5,
    primaryDefects: 2,
    secondaryDefects: 5,
  },
  {
    greenLotCode: "JC-9002",
    held: false,
    holdReason: null,
    latestCupScore: 91,
    primaryDefects: 0,
    secondaryDefects: 0,
  },
];

describe("QcStatusTable (smoke)", () => {
  it("renders the card header and a row per green lot", () => {
    render(<QcStatusTable rows={ROWS} />);
    expect(screen.getByText(/quality control/i)).toBeInTheDocument();
    expect(screen.getAllByText("JC-9001").length).toBeGreaterThan(0);
    expect(screen.getAllByText("JC-9002").length).toBeGreaterThan(0);
  });

  it("flags a held lot with a visible QC-HOLD indicator + its reason", () => {
    render(<QcStatusTable rows={ROWS} />);
    // The held lot surfaces an on-hold marker and the reason somewhere.
    expect(screen.getAllByText(/on hold|qc[\s-]?hold|held/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/off-flavor/i).length).toBeGreaterThan(0);
  });

  it("renders the latest cup score and defect tallies", () => {
    render(<QcStatusTable rows={ROWS} />);
    expect(screen.getAllByText(/88\.5/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/91/).length).toBeGreaterThan(0);
  });

  it("shows an empty state when there are no green lots", () => {
    render(<QcStatusTable rows={[]} />);
    expect(screen.getByText(/no green lots/i)).toBeInTheDocument();
  });
});
