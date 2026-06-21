import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CostWaterfall, type CostWaterfallStep } from "@/components/charts/cost-waterfall";

/**
 * S7 CostWaterfall — per-lot running cost build-up (labor → processing →
 * agronomy → overhead → total cost-per-kg-green). Pure presentational SVG
 * chart; props-driven, no data deps. Inherits the Donut material contract
 * (AD-5): content-hashed UID on its <defs>, a recessed/grooved track gradient
 * + inner shadow, and a specular gloss gradient. AD-3: every numeric readout
 * rides an opaque inner chip, never bare glass.
 */

const STEPS: CostWaterfallStep[] = [
  { label: "Labor", value: 1.2, color: "#1A6B4D" },
  { label: "Processing", value: 0.6, color: "#C8922E" },
  { label: "Agronomy", value: 0.4, color: "#0d4d37" },
  { label: "Overhead", value: 0.3, color: "#6c6155" },
];

describe("CostWaterfall", () => {
  it("mounts and exposes an accessible chart image", () => {
    render(<CostWaterfall steps={STEPS} unit="$/kg" />);
    const img = screen.getByRole("img");
    expect(img).toBeInTheDocument();
    // The accessible label names the chart and surfaces the total build-up.
    expect(img).toHaveAccessibleName(/cost/i);
  });

  it("renders one running-step bar per cost driver plus a final total bar", () => {
    render(<CostWaterfall steps={STEPS} unit="$/kg" />);
    for (const step of STEPS) {
      expect(
        screen.getByTestId(`waterfall-step-${step.label.toLowerCase()}`),
      ).toBeInTheDocument();
    }
    // The terminal "total" column is the number the business turns on.
    expect(screen.getByTestId("waterfall-step-total")).toBeInTheDocument();
  });

  it("accumulates the running cost so the total equals the sum of the steps", () => {
    render(<CostWaterfall steps={STEPS} unit="$/kg" />);
    // 1.2 + 0.6 + 0.4 + 0.3 = 2.5 — the cost-per-kg-green readout.
    const total = screen.getByTestId("waterfall-readout-total");
    expect(total).toHaveTextContent("2.5");
  });

  it("D-COST: a net-negative (over-reversed) step is SIGNED into the total, not clamped to 0", () => {
    // An over-reversed category nets negative. The total must equal Σ(values)
    // so it agrees with the per-step chips and the authoritative headline —
    // clamping the negative to 0 (the old bug) overstated the total.
    render(
      <CostWaterfall
        steps={[
          { label: "Labor", value: 1.2, color: "#1A6B4D" },
          { label: "Processing", value: -0.4, color: "#C8922E" },
          { label: "Agronomy", value: 0.3, color: "#0d4d37" },
        ]}
        unit="$/kg"
      />,
    );
    // 1.2 - 0.4 + 0.3 = 1.10 (NOT 1.50, which the ≥0 clamp would have produced).
    const total = screen.getByTestId("waterfall-readout-total");
    expect(total).toHaveTextContent("1.10");
    expect(total).not.toHaveTextContent("1.50");
    // The negative step's chip still prints its signed value (chips ⇄ total agree).
    const proc = screen.getByTestId("waterfall-readout-processing");
    expect(proc).toHaveTextContent("-$0.40");
  });

  it("CHART MATERIAL (AD-5): emits the recessed-groove track defs and the specular gloss defs", () => {
    const { container } = render(<CostWaterfall steps={STEPS} unit="$/kg" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    const defs = svg!.querySelector("defs");
    expect(defs).not.toBeNull();

    // Groove: a linearGradient track + an inner-shadow filter (the carved look).
    expect(defs!.querySelector('linearGradient[id*="track"]')).not.toBeNull();
    expect(defs!.querySelector('filter[id*="inner"]')).not.toBeNull();
    // Specular gloss: a top-light linearGradient swept over the bars.
    expect(defs!.querySelector('linearGradient[id*="gloss"]')).not.toBeNull();
  });

  it("CHART MATERIAL: ids are content-hashed so two charts on one page never collide", () => {
    const a = render(<CostWaterfall steps={STEPS} unit="$/kg" />);
    const idsA = Array.from(a.container.querySelectorAll("defs [id]")).map(
      (n) => n.id,
    );
    a.unmount();

    const b = render(
      <CostWaterfall
        steps={[{ label: "Labor", value: 9.9, color: "#1A6B4D" }]}
        unit="$/kg"
      />,
    );
    const idsB = Array.from(b.container.querySelectorAll("defs [id]")).map(
      (n) => n.id,
    );

    expect(idsA.length).toBeGreaterThan(0);
    expect(idsB.length).toBeGreaterThan(0);
    // Different content -> different hash suffix -> no shared <defs> id.
    for (const id of idsA) {
      expect(idsB).not.toContain(id);
    }
  });

  it("AD-3: each numeric readout rides an opaque inner chip, not bare glass", () => {
    render(<CostWaterfall steps={STEPS} unit="$/kg" />);
    const chip = screen.getByTestId("waterfall-readout-total");
    expect(chip.className).toMatch(
      /\bbg-(card|forest|forest-\d+|honey|honey-\d+|ink)\b/,
    );
  });

  it("exposes a visually-hidden data table mirroring every step (SR provenance)", () => {
    render(<CostWaterfall steps={STEPS} unit="$/kg" />);
    const table = screen.getByRole("table");
    // Visually hidden but in the a11y tree.
    expect(table.className).toMatch(/sr-only/);
    for (const step of STEPS) {
      expect(within(table).getByText(step.label)).toBeInTheDocument();
    }
  });

  it("renders an empty step set without dividing by zero", () => {
    render(<CostWaterfall steps={[]} unit="$/kg" />);
    expect(screen.getByRole("img")).toBeInTheDocument();
    expect(screen.getByTestId("waterfall-readout-total")).toHaveTextContent("0");
  });

  it("applies the caller className to the outer wrapper", () => {
    const { container } = render(
      <CostWaterfall steps={STEPS} unit="$/kg" className="mt-6" />,
    );
    expect(container.firstChild).toHaveClass("mt-6");
  });
});
