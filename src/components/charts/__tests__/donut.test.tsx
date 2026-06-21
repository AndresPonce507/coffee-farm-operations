import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Donut, type DonutDatum } from "@/components/charts/donut";

afterEach(cleanup);

const SLICES: DonutDatum[] = [
  { label: "Geisha", value: 40, color: "#1A6B4D" },
  { label: "Caturra", value: 35, color: "#C8922E" },
  { label: "Catuai", value: 25, color: "#093b2a" },
];

describe("Donut", () => {
  it("draws one colored segment per slice with a finite dash geometry", () => {
    const { container } = render(<Donut data={SLICES} />);
    // Segment circles carry the brand colors; their dash arrays must be finite
    // (no NaN from a divide-by-zero) or the ring paints nothing.
    const segs = Array.from(container.querySelectorAll("circle[stroke-dasharray]"));
    expect(segs.length).toBeGreaterThanOrEqual(SLICES.length);
    for (const seg of segs) {
      expect(seg.getAttribute("stroke-dasharray")).not.toContain("NaN");
    }
  });

  it("exposes an accessible summary of the shares", () => {
    render(<Donut data={SLICES} />);
    expect(screen.getByRole("img")).toHaveAccessibleName(/donut/i);
  });

  it("renders an explicit empty state (not a bare track) for no data", () => {
    render(<Donut data={[]} />);
    expect(screen.getByText(/no .*data|nothing to show/i)).toBeInTheDocument();
  });

  it("renders an all-zero set without dividing by zero (no NaN dash geometry)", () => {
    const allZero: DonutDatum[] = [
      { label: "A", value: 0, color: "#1A6B4D" },
      { label: "B", value: 0, color: "#C8922E" },
    ];
    const { container } = render(<Donut data={allZero} />);
    for (const seg of container.querySelectorAll("circle[stroke-dasharray]")) {
      const dash = seg.getAttribute("stroke-dasharray") ?? "";
      expect(dash).not.toContain("NaN");
      expect(dash).not.toContain("Infinity");
    }
  });
});
