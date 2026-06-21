import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WaterChip } from "@/components/sections/ferment/water-chip";
import type { WaterPerKg } from "@/lib/db/ferment";

/**
 * Render/smoke test for the eco-mill water-per-kg sustainability chip (P2-S3).
 */

const water: WaterPerKg = {
  lotCode: "JC-800",
  lotKg: 120,
  totalLiters: 360,
  litersPerKg: 3,
};

describe("WaterChip (smoke)", () => {
  it("shows the L/kg figure and the total liters", () => {
    render(<WaterChip water={water} />);
    expect(screen.getByText(/3(\.0)? L\/kg/)).toBeInTheDocument();
    expect(screen.getByText(/360/)).toBeInTheDocument();
  });

  it("renders a no-data state when there is no water log", () => {
    render(<WaterChip water={null} />);
    expect(screen.getByText(/no water logged yet/i)).toBeInTheDocument();
  });

  it("renders a no-data state when L/kg cannot be derived (zero-mass lot)", () => {
    render(
      <WaterChip water={{ ...water, litersPerKg: null, lotKg: 0 }} />,
    );
    expect(screen.getByText(/no water logged yet/i)).toBeInTheDocument();
  });
});
