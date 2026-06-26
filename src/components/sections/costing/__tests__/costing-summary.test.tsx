import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GreenLotAtp, LotCost } from "@/lib/types";

const atp: GreenLotAtp[] = [
  {
    greenLotCode: "JC-101",
    scaGrade: "Specialty",
    location: "A",
    currentKg: 60,
    reservedKg: 0,
    shippedKg: 0,
    atp: 60,
  },
  {
    greenLotCode: "JC-202",
    scaGrade: "Premium",
    location: "A",
    currentKg: 40,
    reservedKg: 0,
    shippedKg: 0,
    atp: 40,
  },
  {
    greenLotCode: "JC-303",
    scaGrade: "Premium",
    location: "A",
    currentKg: 0, // undeclared — excluded from the costed average
    reservedKg: 0,
    shippedKg: 0,
    atp: 0,
  },
];

const costs: Record<string, number | null> = {
  "JC-101": 5,
  "JC-202": 3,
  "JC-303": null,
};

vi.mock("@/lib/db/greenlots", () => ({
  getGreenLotAtp: vi.fn(async (): Promise<GreenLotAtp[]> => atp),
}));

vi.mock("@/lib/db/cogs", () => ({
  getLotCost: vi.fn(
    async (code: string): Promise<LotCost> => ({
      code,
      costPerKgGreen: costs[code] ?? null,
    }),
  ),
}));

import { CostingSummary } from "@/components/sections/costing/costing-summary";

afterEach(cleanup);

describe("CostingSummary (smoke)", () => {
  it("renders the headline tiles", async () => {
    const ui = await CostingSummary();
    render(ui);
    expect(screen.getByText("Lots costed")).toBeInTheDocument();
    expect(screen.getByText("Cheapest lot")).toBeInTheDocument();
  });

  it("counts only lots with a non-null cost verdict", async () => {
    const ui = await CostingSummary();
    render(ui);
    // 2 of 3 lots have a cost-per-kg-green verdict ("2" value, "of 3 green" sub).
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("of 3 green")).toBeInTheDocument();
  });

  it("surfaces the cheapest lot's cost-per-kg-green", async () => {
    const ui = await CostingSummary();
    render(ui);
    // JC-202 @ $3.00 is cheaper than JC-101 @ $5.00.
    expect(screen.getByText("JC-202")).toBeInTheDocument();
    expect(screen.getByText("$3.00/kg")).toBeInTheDocument();
  });

  it("cheapest lot tile is a navigable link to /lots/JC-202", async () => {
    const ui = await CostingSummary();
    render(ui);
    // The cheapest-lot code must be wrapped in an <a> pointing at the lot dossier.
    const link = screen.getByRole("link", { name: /JC-202/ });
    expect(link).toHaveAttribute("href", "/lots/JC-202");
  });

  it("cheapest lot tile stays inert (no link) when there are no costed lots", async () => {
    const { getGreenLotAtp } = await import("@/lib/db/greenlots");
    vi.mocked(getGreenLotAtp).mockResolvedValueOnce([]);
    const ui = await CostingSummary();
    render(ui);
    // No link when cheapest is null — the tile shows "no costed lots" sub-text, no <a>.
    expect(screen.queryByRole("link", { name: /JC-/i })).toBeNull();
    expect(screen.getByText("no costed lots")).toBeInTheDocument();
  });

  it("computes the green-kg-weighted average cost-per-kg", async () => {
    const ui = await CostingSummary();
    render(ui);
    // (5·60 + 3·40) / (60+40) = 420/100 = $4.20.
    expect(screen.getByText("$4.20")).toBeInTheDocument();
  });
});
