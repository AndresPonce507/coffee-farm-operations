import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AtpMeter } from "@/components/ui/atp-meter";

/**
 * S5 dual-bar ATP meter — pure presentational glass primitive.
 * Renders a single stacked bar: a committed segment (reserved + shipped)
 * butted against an available-to-promise (ATP) segment. Both segments scale
 * with GPU-only `transform: scaleX()`; numeric readouts sit on opaque inner
 * chips (AD-3 AA-on-glass), and prefers-reduced-motion is honored by the
 * project's global CSS (transition-duration neutralized) — the component just
 * declares a transform transition the global rule kills.
 */
describe("AtpMeter", () => {
  it("mounts and exposes a labeled meter with both segments", () => {
    render(<AtpMeter committedKg={300} availableKg={700} />);

    // One accessible meter region for the whole bar.
    const meter = screen.getByRole("meter");
    expect(meter).toBeInTheDocument();

    // Both segments are present and addressable.
    expect(screen.getByTestId("atp-segment-committed")).toBeInTheDocument();
    expect(screen.getByTestId("atp-segment-available")).toBeInTheDocument();
  });

  it("renders numeric readouts for committed and available kg", () => {
    render(<AtpMeter committedKg={300} availableKg={700} />);

    // Readouts use the project kg formatter (thousands separators + unit).
    expect(screen.getByTestId("atp-readout-committed")).toHaveTextContent(
      "300 kg",
    );
    expect(screen.getByTestId("atp-readout-available")).toHaveTextContent(
      "700 kg",
    );
    // The 4-figure total is comma-grouped.
    expect(screen.getByTestId("atp-readout-total")).toHaveTextContent(
      "1,000 kg",
    );
  });

  it("scales the available segment to its share of the total via scaleX()", () => {
    render(<AtpMeter committedKg={300} availableKg={700} />);

    const available = screen.getByTestId("atp-segment-available");
    const committed = screen.getByTestId("atp-segment-committed");

    // 700 / 1000 = 0.7 available, 0.3 committed — pure GPU transform, no width.
    expect(available).toHaveStyle({ transform: "scaleX(0.7)" });
    expect(committed).toHaveStyle({ transform: "scaleX(0.3)" });
    // No layout-thrashing width animation: the segments size by transform.
    expect(available.style.width).toBe("");
  });

  it("reports the available share through ARIA meter values", () => {
    render(<AtpMeter committedKg={250} availableKg={750} />);

    const meter = screen.getByRole("meter");
    // The meter communicates available-to-promise as a fraction of the total.
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "1000");
    expect(meter).toHaveAttribute("aria-valuenow", "750");
  });

  it("puts each readout on an opaque inner chip (AD-3: no text on bare glass)", () => {
    render(<AtpMeter committedKg={300} availableKg={700} />);

    // AD-3: AA-contrast labels ride opaque chips, never directly on the glass
    // track. Each readout's chip carries a solid (non-translucent) background.
    for (const id of ["atp-readout-committed", "atp-readout-available"]) {
      const chip = screen.getByTestId(id);
      const cls = chip.className;
      // Opaque surface token — not a translucent white/xx glass wash.
      expect(cls).toMatch(/\bbg-(card|forest|forest-\d+|honey|honey-\d+)\b/);
    }
  });

  it("clamps a degenerate all-committed lot to a full committed bar", () => {
    render(<AtpMeter committedKg={1000} availableKg={0} />);

    expect(screen.getByTestId("atp-segment-committed")).toHaveStyle({
      transform: "scaleX(1)",
    });
    expect(screen.getByTestId("atp-segment-available")).toHaveStyle({
      transform: "scaleX(0)",
    });
  });

  it("renders an empty (zero-total) lot without dividing by zero", () => {
    render(<AtpMeter committedKg={0} availableKg={0} />);

    // No NaN leaks into the transform — both segments collapse to scaleX(0).
    expect(screen.getByTestId("atp-segment-committed")).toHaveStyle({
      transform: "scaleX(0)",
    });
    expect(screen.getByTestId("atp-segment-available")).toHaveStyle({
      transform: "scaleX(0)",
    });
    expect(screen.getByTestId("atp-readout-total")).toHaveTextContent("0 kg");
  });

  it("declares a GPU transform transition the reduced-motion rule can neutralize", () => {
    render(<AtpMeter committedKg={300} availableKg={700} />);

    // The fill animates via transform only (the global @media reduced-motion
    // rule zeroes transition-duration; the component must use a transition the
    // rule targets, not a JS-driven width tween).
    const available = screen.getByTestId("atp-segment-available");
    expect(available.className).toMatch(/transition-transform/);
    expect(available.className).toMatch(/will-change-transform/);
  });

  it("applies caller className to the outer wrapper", () => {
    const { container } = render(
      <AtpMeter committedKg={300} availableKg={700} className="mt-4" />,
    );
    expect(container.firstChild).toHaveClass("mt-4");
  });

  it("labels each readout chip so the legend is screen-reader legible", () => {
    render(<AtpMeter committedKg={300} availableKg={700} />);

    const committed = screen.getByTestId("atp-readout-committed");
    const available = screen.getByTestId("atp-readout-available");
    expect(within(committed).getByText(/committed/i)).toBeInTheDocument();
    expect(within(available).getByText(/available/i)).toBeInTheDocument();
  });
});
