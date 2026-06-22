import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FermentCurve } from "@/components/sections/ferment/ferment-curve";
import type { FermentCurvePoint } from "@/lib/db/ferment";

/**
 * Render/smoke test for the live ferment curve — a pure-presentation server SVG
 * (the Phase-1 zero-JS chart idiom) plotting the pH series against the recipe's
 * target band, with the cut-point marker. No DB, no client JS.
 */

const phSeries: FermentCurvePoint[] = [
  { batchId: "b1", lotCode: "JC-800", readingKind: "ph", value: 5.6, occurredAt: "2026-06-20T06:00:00Z", hoursElapsed: 0 },
  { batchId: "b1", lotCode: "JC-800", readingKind: "ph", value: 5.0, occurredAt: "2026-06-20T08:00:00Z", hoursElapsed: 2 },
  { batchId: "b1", lotCode: "JC-800", readingKind: "ph", value: 4.4, occurredAt: "2026-06-20T10:00:00Z", hoursElapsed: 4 },
];

describe("FermentCurve (smoke)", () => {
  it("renders an accessible SVG curve labelled for screen readers", () => {
    render(<FermentCurve points={phSeries} targetPh={4.2} kind="ph" />);
    const img = screen.getByRole("img");
    expect(img).toBeInTheDocument();
    expect(img.getAttribute("aria-label") ?? "").toMatch(/pH/i);
  });

  it("draws the recipe target band when a target is provided", () => {
    const { container } = render(
      <FermentCurve points={phSeries} targetPh={4.2} kind="ph" />,
    );
    expect(container.querySelector("[data-testid='ferment-target-band']")).not.toBeNull();
  });

  it("renders a glass empty state when there are no readings of this kind", () => {
    render(<FermentCurve points={[]} targetPh={4.2} kind="ph" />);
    expect(screen.getByText(/no .* readings yet/i)).toBeInTheDocument();
  });

  it("plots one path with a vertex per reading (a 3-point series)", () => {
    const { container } = render(
      <FermentCurve points={phSeries} targetPh={4.2} kind="ph" />,
    );
    const line = container.querySelector("[data-testid='ferment-curve-line']");
    expect(line).not.toBeNull();
    // the path 'd' has 3 vertices (M + 2× L)
    const d = line?.getAttribute("d") ?? "";
    expect((d.match(/[ML]/g) ?? []).length).toBe(3);
  });

  it("renders a visible point marker for a single-reading series (first-use)", () => {
    // With exactly ONE reading, the curve <path> is a bare moveto ("M x y")
    // that SVG does not stroke, so the only thing that can make the reading
    // visible is an explicit point marker. The first reading of every batch
    // hits this state — it must not render an invisible chart.
    const oneReading: FermentCurvePoint[] = [
      {
        batchId: "b1",
        lotCode: "JC-800",
        readingKind: "ph",
        value: 5.6,
        occurredAt: "2026-06-20T06:00:00Z",
        hoursElapsed: 0,
      },
    ];
    const { container } = render(
      <FermentCurve points={oneReading} targetPh={4.2} kind="ph" />,
    );
    // not the empty state
    expect(
      container.querySelector("[data-testid='ferment-curve-empty']"),
    ).toBeNull();
    // a visible dot marker exists for the reading
    const dots = container.querySelectorAll(
      "[data-testid='ferment-curve-point']",
    );
    expect(dots.length).toBeGreaterThanOrEqual(1);
  });

  it("renders a point marker for every reading on a multi-point curve", () => {
    const { container } = render(
      <FermentCurve points={phSeries} targetPh={4.2} kind="ph" />,
    );
    const dots = container.querySelectorAll(
      "[data-testid='ferment-curve-point']",
    );
    expect(dots.length).toBe(phSeries.length);
  });
});
