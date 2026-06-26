import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressBar } from "@/components/ui/progress-bar";

/**
 * ProgressBar — pure presentational glass primitive.
 * A fixed-dimension track with a full-width inner fill sized by GPU-only
 * `transform: scaleX()` (no `width` reflow, no JS tween), mirroring AtpMeter.
 * prefers-reduced-motion is honored both by the project's global CSS
 * (transition-duration neutralized) and an explicit motion-reduce utility.
 */
describe("ProgressBar", () => {
  it("mounts and exposes a labeled progressbar with its value", () => {
    render(<ProgressBar value={42} />);

    const bar = screen.getByRole("progressbar");
    expect(bar).toBeInTheDocument();
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("sizes the fill to its share of 100 via scaleX() — not width", () => {
    render(<ProgressBar value={42} />);

    const fill = screen.getByTestId("progress-fill");
    // 42 / 100 = 0.42 — pure GPU transform, no layout-thrashing width.
    expect(fill).toHaveStyle({ transform: "scaleX(0.42)" });
    // No `width` animation: the fill sizes by transform on a full-width slab.
    expect(fill.style.width).toBe("");
    expect(fill.className).toMatch(/\bw-full\b/);
    expect(fill.className).toMatch(/\borigin-left\b/);
  });

  it("clamps values above 100 to a full bar", () => {
    render(<ProgressBar value={150} />);

    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
    expect(screen.getByTestId("progress-fill")).toHaveStyle({
      transform: "scaleX(1)",
    });
  });

  it("clamps negative values to an empty bar", () => {
    render(<ProgressBar value={-20} />);

    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
    expect(screen.getByTestId("progress-fill")).toHaveStyle({
      transform: "scaleX(0)",
    });
  });

  it("declares a GPU transform transition the reduced-motion rule can neutralize", () => {
    render(<ProgressBar value={60} />);

    // The fill animates via transform only (the global @media reduced-motion
    // rule zeroes transition-duration, and an explicit motion-reduce utility
    // drops the transition entirely) — never a JS-driven width tween.
    const fill = screen.getByTestId("progress-fill");
    expect(fill.className).toMatch(/transition-transform/);
    expect(fill.className).toMatch(/will-change-transform/);
    expect(fill.className).toMatch(/motion-reduce:transition-none/);
    // The legacy width-animation class is gone.
    expect(fill.className).not.toMatch(/transition-\[width\]/);
  });

  it("applies the tone fill class", () => {
    render(<ProgressBar value={50} tone="honey" />);
    expect(screen.getByTestId("progress-fill").className).toMatch(/bg-honey/);
  });

  it("defaults to the forest tone", () => {
    render(<ProgressBar value={50} />);
    expect(screen.getByTestId("progress-fill").className).toMatch(
      /bg-forest-500/,
    );
  });

  it("applies caller className to the outer track", () => {
    render(<ProgressBar value={50} className="mt-4" />);
    expect(screen.getByRole("progressbar")).toHaveClass("mt-4");
  });

  it("keeps the track at a fixed full width (no reflow as the fill grows)", () => {
    render(<ProgressBar value={10} />);
    const track = screen.getByRole("progressbar");
    // The track owns the layout box; the fill only transforms within it.
    expect(track.className).toMatch(/\bw-full\b/);
    expect(track.className).toMatch(/\boverflow-hidden\b/);
  });
});
