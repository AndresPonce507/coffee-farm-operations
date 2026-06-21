import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GreenLotAtp, LotCost, LotRuleCost } from "@/lib/types";

const atp: GreenLotAtp[] = [
  {
    greenLotCode: "JC-101",
    scaGrade: "Specialty",
    location: "Warehouse A",
    currentKg: 60,
    reservedKg: 0,
    shippedKg: 0,
    atp: 60,
  },
  {
    greenLotCode: "JC-202",
    scaGrade: "Premium",
    location: "Warehouse A",
    currentKg: 0,
    reservedKg: 0,
    shippedKg: 0,
    atp: 0,
  },
];

function breakdownFor(): LotRuleCost[] {
  return [
    { rule: "direct-labor", allocatedUsd: 120 },
    { rule: "overhead", allocatedUsd: 30 },
  ];
}

vi.mock("@/lib/db/greenlots", () => ({
  getGreenLotAtp: vi.fn(async (): Promise<GreenLotAtp[]> => atp),
}));

vi.mock("@/lib/db/cogs", () => ({
  getLotCost: vi.fn(
    async (code: string): Promise<LotCost> => ({
      code,
      costPerKgGreen: code === "JC-101" ? 4.25 : null,
    }),
  ),
  getCostBreakdownByRule: vi.fn(
    async (_code: string): Promise<LotRuleCost[]> => breakdownFor(),
  ),
}));

import { CostLotList } from "@/components/sections/costing/cost-lot-list";

afterEach(cleanup);

describe("CostLotList (smoke)", () => {
  it("renders one CostLotCard per green lot with its headline figure", async () => {
    const ui = await CostLotList();
    render(ui);

    expect(screen.getByText("JC-101")).toBeInTheDocument();
    expect(screen.getByText("JC-202")).toBeInTheDocument();
    expect(screen.getByTestId("cost-headline-JC-101")).toHaveTextContent("$4.25");
    // Undeclared green-kg lot shows the em-dash, never a fabricated 0.
    expect(screen.getByTestId("cost-headline-JC-202")).toHaveTextContent("—");
  });

  it("lays the cards out under a stagger reveal", async () => {
    const ui = await CostLotList();
    const { container } = render(ui);
    expect(container.querySelector(".stagger")).not.toBeNull();
  });

  it("renders an empty state when there are no green lots", async () => {
    const { getGreenLotAtp } = await import("@/lib/db/greenlots");
    vi.mocked(getGreenLotAtp).mockResolvedValueOnce([]);

    const ui = await CostLotList();
    render(ui);
    expect(screen.getByTestId("costing-empty")).toBeInTheDocument();
  });
});
