import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  CostDecomposition,
  type CostSlice,
} from "@/components/charts/cost-decomposition";

/**
 * S7 cost-decomposition bar — labor | processing | agronomy | overhead as a
 * single stacked bar of pure CSS flex widths (no SVG geometry for the bar
 * itself). Inherits the Donut material contract (AD-5): a content-hashed UID
 * carrying a recessed-groove track and a specular gloss expressed as SVG
 * <defs>, so it shares the exact same wet-glass material as every other chart.
 * AD-3: each percent/value readout sits on an opaque inner chip.
 */

const SLICES: CostSlice[] = [
  { label: "Labor", value: 50, color: "#1A6B4D" },
  { label: "Processing", value: 25, color: "#C8922E" },
  { label: "Agronomy", value: 15, color: "#0d4d37" },
  { label: "Overhead", value: 10, color: "#6c6155" },
];

describe("CostDecomposition", () => {
  it("mounts and exposes an accessible chart image", () => {
    render(<CostDecomposition slices={SLICES} />);
    const img = screen.getByRole("img");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAccessibleName(/labor/i);
  });

  it("renders one flex segment per cost category", () => {
    render(<CostDecomposition slices={SLICES} />);
    for (const slice of SLICES) {
      expect(
        screen.getByTestId(`decomp-segment-${slice.label.toLowerCase()}`),
      ).toBeInTheDocument();
    }
  });

  it("sizes each segment by its SHARE of the total as a CSS flex width", () => {
    render(<CostDecomposition slices={SLICES} />);
    // 50/100 -> flex-basis 50%. Pure CSS flex, no SVG arithmetic.
    const labor = screen.getByTestId("decomp-segment-labor");
    expect(labor.style.flexBasis).toBe("50%");
    const overhead = screen.getByTestId("decomp-segment-overhead");
    expect(overhead.style.flexBasis).toBe("10%");
  });

  it("CHART MATERIAL (AD-5): emits the recessed-groove track defs and the specular gloss defs", () => {
    const { container } = render(<CostDecomposition slices={SLICES} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    const defs = svg!.querySelector("defs");
    expect(defs).not.toBeNull();

    expect(defs!.querySelector('linearGradient[id*="track"]')).not.toBeNull();
    expect(defs!.querySelector('filter[id*="inner"]')).not.toBeNull();
    expect(defs!.querySelector('linearGradient[id*="gloss"]')).not.toBeNull();
  });

  it("CHART MATERIAL: ids are content-hashed so two bars on one page never collide", () => {
    const a = render(<CostDecomposition slices={SLICES} />);
    const idsA = Array.from(a.container.querySelectorAll("defs [id]")).map(
      (n) => n.id,
    );
    a.unmount();

    const b = render(
      <CostDecomposition
        slices={[{ label: "Labor", value: 100, color: "#1A6B4D" }]}
      />,
    );
    const idsB = Array.from(b.container.querySelectorAll("defs [id]")).map(
      (n) => n.id,
    );

    expect(idsA.length).toBeGreaterThan(0);
    expect(idsB.length).toBeGreaterThan(0);
    for (const id of idsA) {
      expect(idsB).not.toContain(id);
    }
  });

  it("AD-3: each readout rides an opaque inner chip, not bare glass", () => {
    render(<CostDecomposition slices={SLICES} />);
    const chip = screen.getByTestId("decomp-readout-labor");
    expect(chip.className).toMatch(
      /\bbg-(card|forest|forest-\d+|honey|honey-\d+|ink)\b/,
    );
  });

  it("exposes a visually-hidden data table mirroring every slice", () => {
    render(<CostDecomposition slices={SLICES} />);
    const table = screen.getByRole("table");
    expect(table.className).toMatch(/sr-only/);
    for (const slice of SLICES) {
      expect(within(table).getByText(slice.label)).toBeInTheDocument();
    }
  });

  it("renders an empty slice set without dividing by zero", () => {
    render(<CostDecomposition slices={[]} />);
    expect(screen.getByRole("img")).toBeInTheDocument();
    // No NaN flex-basis leaks for an empty set.
    expect(screen.queryByText("NaN%")).toBeNull();
  });

  it("collapses a zero-total set to zero-width segments (no divide-by-zero)", () => {
    render(
      <CostDecomposition
        slices={[
          { label: "Labor", value: 0, color: "#1A6B4D" },
          { label: "Overhead", value: 0, color: "#6c6155" },
        ]}
      />,
    );
    expect(screen.getByTestId("decomp-segment-labor").style.flexBasis).toBe(
      "0%",
    );
  });

  it("applies the caller className to the outer wrapper", () => {
    const { container } = render(
      <CostDecomposition slices={SLICES} className="mt-6" />,
    );
    expect(container.firstChild).toHaveClass("mt-6");
  });
});
