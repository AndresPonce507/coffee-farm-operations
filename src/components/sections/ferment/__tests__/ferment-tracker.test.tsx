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
