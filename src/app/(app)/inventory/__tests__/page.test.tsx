import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { GreenLotAtp } from "@/lib/types";

// The page is an async Server Component that awaits the derived-ATP read port.
// Mock the port so the page composes against a known shape with no Supabase.
const atp: GreenLotAtp[] = [
  {
    greenLotCode: "JC-552-G",
    scaGrade: "Presidential",
    location: "Warehouse A · Bay 3",
    currentKg: 240,
    reservedKg: 60,
    shippedKg: 30,
    atp: 150,
  },
];

vi.mock("@/lib/db/greenlots", () => ({
  getGreenLotAtp: vi.fn(async (): Promise<GreenLotAtp[]> => atp),
}));

// The header carries the GRADE affordance, fed by the gradable-source read port.
vi.mock("@/lib/db/gradable-lots", () => ({
  getGradableLots: vi.fn(async (): Promise<string[]> => ["JC-564", "JC-565"]),
}));

// The reserve + grade client islands import the Server Actions; stub them.
vi.mock("@/app/(app)/inventory/actions", () => ({
  reserveGreenLotAction: vi.fn(),
  gradeGreenLotAction: vi.fn(),
  INVENTORY_IDLE: { status: "idle" },
}));

import InventoryPage from "@/app/(app)/inventory/page";

describe("/inventory page (smoke)", () => {
  it("renders the header and the green-inventory ATP table", async () => {
    const ui = await InventoryPage();
    render(ui);

    expect(
      screen.getByRole("heading", { level: 1, name: "Inventario" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Green inventory")).toBeInTheDocument();
    expect(screen.getAllByText("JC-552-G").length).toBeGreaterThan(0);
    // The derived ATP figure flows through to a meter readout.
    expect(screen.getAllByRole("meter").length).toBeGreaterThan(0);
  });

  it("renders the primary GRADE affordance (the wired-up green-lot writer)", async () => {
    const ui = await InventoryPage();
    render(ui);

    // The grade front door is present and enabled (there are gradable sources).
    const grade = screen.getByRole("button", { name: /grade green lot/i });
    expect(grade).toBeInTheDocument();
    expect(grade).toBeEnabled();
  });
});
