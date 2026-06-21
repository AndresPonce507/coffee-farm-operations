import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StatRing } from "@/components/charts/stat-ring";

// vitest config has no globals; register RTL cleanup explicitly so each test
// renders into a fresh document body.
afterEach(cleanup);

describe("StatRing", () => {
  it("renders the rounded percentage and captions", () => {
    render(<StatRing value={62.4} label="Season target" sublabel="60,000 of 120,000" />);

    // Percentage rounds to a whole number.
    expect(screen.getByText("62")).toBeInTheDocument();
    expect(screen.getByText("Season target")).toBeInTheDocument();
    expect(screen.getByText("60,000 of 120,000")).toBeInTheDocument();
  });

  it("clamps an above-range value to 100", () => {
    render(<StatRing value={140} />);
    const svg = screen.getByRole("img");
    expect(svg).toHaveAttribute("aria-label", expect.stringContaining("100 percent"));
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("clamps a below-range (negative) value to 0", () => {
    render(<StatRing value={-25} />);
    const svg = screen.getByRole("img");
    expect(svg).toHaveAttribute("aria-label", expect.stringContaining("0 percent"));
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  // FINDING #39 — Math.min/Math.max pass NaN straight through (Math.min(100,
  // Math.max(0, NaN)) === NaN), so a non-finite input painted "NaN%". A
  // non-finite value must coerce to 0 so no caller can ever render NaN.
  it("coerces NaN to 0 percent instead of painting NaN", () => {
    render(<StatRing value={NaN} />);

    const svg = screen.getByRole("img");
    expect(svg).toHaveAttribute("aria-label", expect.stringContaining("0 percent"));
    expect(svg.getAttribute("aria-label")).not.toContain("NaN");

    // The centered readout shows "0", never "NaN".
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.queryByText("NaN")).not.toBeInTheDocument();
  });

  // FINDING #39 — Infinity slipped through as a false "100%": Math.min(100,
  // Math.max(0, Infinity)) === 100. Coercing non-finite to 0 makes an
  // Infinity input read honestly as 0, not a fabricated full ring.
  it("coerces Infinity to 0 percent rather than a false 100%", () => {
    render(<StatRing value={Infinity} />);

    const svg = screen.getByRole("img");
    expect(svg).toHaveAttribute("aria-label", expect.stringContaining("0 percent"));
    expect(svg.getAttribute("aria-label")).not.toContain("Infinity");
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("computes a finite stroke-dashoffset for a non-finite value", () => {
    const { container } = render(<StatRing value={NaN} />);
    // The value arc is the circle carrying strokeDasharray; its offset must be
    // a finite number, never "NaN", or the SVG paints nothing / errors.
    const arcs = container.querySelectorAll("circle[stroke-dashoffset]");
    expect(arcs.length).toBeGreaterThan(0);
    const offset = arcs[arcs.length - 1].getAttribute("stroke-dashoffset");
    expect(offset).not.toBeNull();
    expect(Number.isFinite(Number(offset))).toBe(true);
  });
});
