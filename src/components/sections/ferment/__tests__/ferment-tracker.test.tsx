import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  FermentBatch,
  FermentCurvePoint,
  FermentCutpoint,
  WaterPerKg,
} from "@/lib/db/ferment";

vi.mock("@/app/(app)/ferment/actions", () => ({
  recordFermentReadingAction: vi.fn(),
  logMillWaterAction: vi.fn(),
  FERMENT_IDLE: { status: "idle" },
}));

import { FermentTracker } from "@/components/sections/ferment/ferment-tracker";

const batch: FermentBatch = {
  id: "b1",
  lotCode: "JC-800",
  recipeId: "rec-geisha-anaerobic-v1",
  method: "Anaerobic",
  startedAt: "2026-06-20T06:00:00Z",
  endedAt: null,
};

const curve: FermentCurvePoint[] = [
  { batchId: "b1", lotCode: "JC-800", readingKind: "ph", value: 5.6, occurredAt: "2026-06-20T06:00:00Z", hoursElapsed: 0 },
  { batchId: "b1", lotCode: "JC-800", readingKind: "ph", value: 4.4, occurredAt: "2026-06-20T10:00:00Z", hoursElapsed: 4 },
  { batchId: "b1", lotCode: "JC-800", readingKind: "temp", value: 22.0, occurredAt: "2026-06-20T06:00:00Z", hoursElapsed: 0 },
  { batchId: "b1", lotCode: "JC-800", readingKind: "temp", value: 24.6, occurredAt: "2026-06-20T10:00:00Z", hoursElapsed: 4 },
  { batchId: "b1", lotCode: "JC-800", readingKind: "brix", value: 21.3, occurredAt: "2026-06-20T06:00:00Z", hoursElapsed: 0 },
  { batchId: "b1", lotCode: "JC-800", readingKind: "brix", value: 18.2, occurredAt: "2026-06-20T10:00:00Z", hoursElapsed: 4 },
];

const cutpoint: FermentCutpoint = {
  batchId: "b1",
  lotCode: "JC-800",
  recipeId: "rec-geisha-anaerobic-v1",
  targetPh: 4.2,
  targetHours: 36,
  latestPh: 4.4,
  latestAt: "2026-06-20T10:00:00Z",
  hoursElapsed: 4,
  cutReached: false,
};

const water: WaterPerKg = {
  lotCode: "JC-800",
  lotKg: 120,
  totalLiters: 360,
  litersPerKg: 3,
};

describe("FermentTracker (smoke)", () => {
  it("renders the batch header with its lot code and method", () => {
    render(
      <FermentTracker
        batch={batch}
        curve={curve}
        cutpoint={cutpoint}
        water={water}
      />,
    );
    expect(screen.getByText(/JC-800/)).toBeInTheDocument();
    expect(screen.getByText(/Anaerobic/)).toBeInTheDocument();
  });

  it("links the batch's lot code to its lot dossier (cross-entity coherence)", () => {
    const { container } = render(
      <FermentTracker
        batch={batch}
        curve={curve}
        cutpoint={cutpoint}
        water={water}
      />,
    );
    // The batch.lotCode is an <EntityLink> to /lots/<code> — from a ferment
    // batch you hop straight to the lot it belongs to (design §5 link map).
    const lotLink = container.querySelector('a[href="/lots/JC-800"]');
    expect(lotLink).not.toBeNull();
    expect(lotLink).toHaveTextContent("JC-800");
  });

  it("renders the live curve, the cut-point signal, and the water chip", () => {
    render(
      <FermentTracker
        batch={batch}
        curve={curve}
        cutpoint={cutpoint}
        water={water}
      />,
    );
    // the curve SVG
    expect(screen.getAllByRole("img").length).toBeGreaterThan(0);
    // the cut-point tracking chip (pH above target)
    expect(screen.getByTestId("cutpoint-tracking")).toBeInTheDocument();
    // the water-per-kg chip
    expect(screen.getByText(/L\/kg/)).toBeInTheDocument();
  });

  it("hosts the log-reading control bound to the batch", () => {
    render(
      <FermentTracker
        batch={batch}
        curve={curve}
        cutpoint={cutpoint}
        water={water}
      />,
    );
    expect(
      screen.getByRole("button", { name: /log reading/i }),
    ).toBeInTheDocument();
    const batchInput = document.querySelector(
      "input[name='batchId']",
    ) as HTMLInputElement;
    expect(batchInput.value).toBe("b1");
  });

  it("echoes the latest reading value beside each curve title (temp + Brix, not just pH)", () => {
    render(
      <FermentTracker
        batch={batch}
        curve={curve}
        cutpoint={cutpoint}
        water={water}
      />,
    );
    // Each secondary glance chart gets a numeric readout so a sighted user can
    // tell the scale at a glance, not just a bare colored squiggle.
    expect(screen.getByTestId("ferment-latest-temp")).toHaveTextContent(
      /24\.6\s*°C/,
    );
    expect(screen.getByTestId("ferment-latest-brix")).toHaveTextContent(
      /18\.2\s*°Bx/,
    );
    // pH (headline) gets one too, time-sorted to the last reading.
    expect(screen.getByTestId("ferment-latest-ph")).toHaveTextContent(
      /pH\s*4\.4/,
    );
  });

  it("omits the latest-value readout for a kind with no readings", () => {
    render(
      <FermentTracker
        batch={batch}
        curve={curve.filter((p) => p.readingKind === "ph")}
        cutpoint={cutpoint}
        water={water}
      />,
    );
    expect(screen.getByTestId("ferment-latest-ph")).toBeInTheDocument();
    expect(screen.queryByTestId("ferment-latest-temp")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ferment-latest-brix")).not.toBeInTheDocument();
  });

  it("fires a prominent CUT NOW alert when the cut is reached", () => {
    render(
      <FermentTracker
        batch={batch}
        curve={curve}
        cutpoint={{ ...cutpoint, latestPh: 4.1, cutReached: true }}
        water={water}
      />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
