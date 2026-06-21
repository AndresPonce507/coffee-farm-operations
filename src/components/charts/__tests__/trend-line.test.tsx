import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TrendLine } from "@/components/charts/trend-line";

afterEach(cleanup);

const SERIES = [
  { label: "Jun 14", value: 180 },
  { label: "Jun 15", value: 410 },
  { label: "Jun 16", value: 95 },
  { label: "Jun 17", value: 508 },
  { label: "Jun 18", value: 644 },
];

describe("TrendLine", () => {
  it("draws a non-empty line path for a real series", () => {
    const { container } = render(<TrendLine data={SERIES} />);
    // The crisp line stroke must carry a real, non-empty `d` — the actual
    // series geometry, not an empty path that paints nothing.
    const paths = Array.from(container.querySelectorAll("path[d]"));
    const drawn = paths.filter((p) => {
      const d = p.getAttribute("d") ?? "";
      return d.trim().length > 0 && /[ML]/.test(d);
    });
    expect(drawn.length).toBeGreaterThan(0);
  });

  it("exposes an accessible chart summary", () => {
    render(<TrendLine data={SERIES} />);
    expect(screen.getByRole("img")).toHaveAccessibleName(/trend line/i);
  });

  it("renders an explicit empty state (not a silently-empty plot) for no data", () => {
    render(<TrendLine data={[]} />);
    // No fabricated line, and a human-readable empty state.
    expect(screen.getByText(/no .*data|nothing to show/i)).toBeInTheDocument();
  });

  it("renders an all-zero series with a finite, flat line (no NaN in the path)", () => {
    const flat = [
      { label: "Mon", value: 0 },
      { label: "Tue", value: 0 },
      { label: "Wed", value: 0 },
    ];
    const { container } = render(<TrendLine data={flat} />);
    // The span guard (max-min || 1) must keep every coordinate finite — a NaN
    // anywhere in `d` makes the SVG paint nothing.
    for (const p of container.querySelectorAll("path[d]")) {
      expect(p.getAttribute("d")).not.toContain("NaN");
    }
  });

  it("renders a single datum without throwing and without NaN coordinates", () => {
    const { container } = render(<TrendLine data={[{ label: "Jun 20", value: 644 }]} />);
    for (const p of container.querySelectorAll("path[d]")) {
      expect(p.getAttribute("d")).not.toContain("NaN");
    }
  });
});
