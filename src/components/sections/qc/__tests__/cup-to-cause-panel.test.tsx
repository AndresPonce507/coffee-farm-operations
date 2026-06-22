import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { LotGenealogy, MoistureReading, QcStatus } from "@/lib/types";
import type { FermentCurvePoint } from "@/lib/db/ferment";
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

const FERMENT_CURVE: FermentCurvePoint[] = [
  { batchId: "b1", lotCode: "JC-900", readingKind: "ph", value: 5.4, occurredAt: "2026-01-01T06:00:00Z", hoursElapsed: 0 },
  { batchId: "b1", lotCode: "JC-900", readingKind: "ph", value: 4.6, occurredAt: "2026-01-01T18:00:00Z", hoursElapsed: 12 },
  { batchId: "b1", lotCode: "JC-900", readingKind: "ph", value: 4.1, occurredAt: "2026-01-02T06:00:00Z", hoursElapsed: 24 },
];

const MOISTURE_CURVE: MoistureReading[] = [
  { lotCode: "JC-900", moisturePct: 42, occurredAt: "2026-01-03T12:00:00Z" },
  { lotCode: "JC-900", moisturePct: 22, occurredAt: "2026-01-10T12:00:00Z" },
  { lotCode: "JC-900", moisturePct: 11, occurredAt: "2026-01-20T12:00:00Z" },
];

const PLOT = { name: "Las Lagunas", altitudeMasl: 1650 };

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

  // ---- the spec's dogfood moment: ferment curve + drying curve + the masl plot
  // (P2-S6, closing the cup-to-cause loop now that S3/S4 are on main) ----

  it("renders the plot + elevation that produced the lot when supplied", () => {
    render(
      <CupToCausePanel
        lotCode="JC-9001"
        genealogy={GENEALOGY}
        status={STATUS}
        plot={PLOT}
      />,
    );
    expect(screen.getByText(/Las Lagunas/)).toBeInTheDocument();
    // "1,650 masl" — the single most-quoted line of the slice.
    expect(screen.getByText(/1,650\s*masl/i)).toBeInTheDocument();
  });

  it("renders the ferment curve section when a curve is supplied", () => {
    render(
      <CupToCausePanel
        lotCode="JC-9001"
        genealogy={GENEALOGY}
        status={STATUS}
        fermentCurve={FERMENT_CURVE}
      />,
    );
    expect(screen.getByText(/ferment/i)).toBeInTheDocument();
    // The reused FermentCurve SVG renders an accessible <svg role="img">.
    expect(screen.getByRole("img", { name: /ferment/i })).toBeInTheDocument();
  });

  it("renders the drying / moisture curve section when a curve is supplied", () => {
    render(
      <CupToCausePanel
        lotCode="JC-9001"
        genealogy={GENEALOGY}
        status={STATUS}
        moistureCurve={MOISTURE_CURVE}
      />,
    );
    expect(screen.getByText(/drying/i)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /moisture/i })).toBeInTheDocument();
  });

  it("omits — never fabricates — each cause section when its prop is absent", () => {
    // Only lineage + defects; no ferment/drying/plot data supplied.
    render(<CupToCausePanel lotCode="JC-9001" genealogy={GENEALOGY} status={STATUS} />);
    expect(screen.queryByText(/ferment/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /moisture/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/masl/i)).not.toBeInTheDocument();
  });
});
