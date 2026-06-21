import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { LotGenealogy, QcStatus } from "@/lib/types";
import { CupToCausePanel } from "@/components/sections/qc/cup-to-cause-panel";

const GENEALOGY: LotGenealogy = {
  nodes: [
    { code: "JC-900", stage: "cherry", variety: "Geisha", originKg: 100, currentKg: 100, isSingleOrigin: true },
    { code: "JC-9001", stage: "green", variety: "Geisha", originKg: 80, currentKg: 80, isSingleOrigin: true },
  ] as LotGenealogy["nodes"],
  edges: [
    { parentCode: "JC-900", childCode: "JC-9001", kind: "process", kg: 80 },
  ] as LotGenealogy["edges"],
};

const STATUS: QcStatus = {
  greenLotCode: "JC-9001",
  held: false,
  holdReason: null,
  latestCupScore: 88.5,
  primaryDefects: 1,
  secondaryDefects: 3,
};

describe("CupToCausePanel (smoke)", () => {
  it("renders the cup-to-cause title and the lot code", () => {
    render(<CupToCausePanel lotCode="JC-9001" genealogy={GENEALOGY} status={STATUS} />);
    expect(screen.getByText(/cup.?to.?cause/i)).toBeInTheDocument();
    expect(screen.getAllByText(/JC-9001/).length).toBeGreaterThan(0);
  });

  it("surfaces the lineage stages that produced the lot (the 'cause')", () => {
    render(<CupToCausePanel lotCode="JC-9001" genealogy={GENEALOGY} status={STATUS} />);
    expect(screen.getByText(/cherry/i)).toBeInTheDocument();
    expect(screen.getAllByText(/green/i).length).toBeGreaterThan(0);
  });

  it("degrades gracefully when no lineage data exists yet", () => {
    render(
      <CupToCausePanel
        lotCode="JC-9999"
        genealogy={{ nodes: [], edges: [] }}
        status={null}
      />,
    );
    // honest empty state — never a fabricated cause.
    expect(screen.getByText(/no lineage|not yet|unavailable/i)).toBeInTheDocument();
  });

  it("shows the defect tallies as part of the cause context", () => {
    render(<CupToCausePanel lotCode="JC-9001" genealogy={GENEALOGY} status={STATUS} />);
    expect(screen.getByText(/defects/i)).toBeInTheDocument();
  });
});
