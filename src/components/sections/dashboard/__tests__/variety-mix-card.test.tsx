import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VarietyShare } from "@/lib/types";

// VarietyMixCard is an async Server Component that awaits getVarietyShares.
// Mock the trends module so the smoke test renders against a known share table.
vi.mock("@/lib/db/trends", () => ({
  getVarietyShares: vi.fn(
    async (): Promise<VarietyShare[]> => [
      { variety: "Geisha", kg: 5000 },
      { variety: "Caturra", kg: 3000 },
      { variety: "Pacamara", kg: 2000 },
    ],
  ),
}));

import { VarietyMixCard } from "@/components/sections/dashboard/variety-mix-card";

// vitest config has no globals, so RTL's auto afterEach(cleanup) isn't registered;
// register it explicitly so each test renders into a fresh document body.
afterEach(cleanup);

describe("VarietyMixCard (smoke)", () => {
  it("renders the card title and a legend row per variety without throwing", async () => {
    const ui = await VarietyMixCard();
    render(ui);

    expect(screen.getByText("Variety mix")).toBeInTheDocument();
    expect(screen.getByText("Geisha")).toBeInTheDocument();
    expect(screen.getByText("Caturra")).toBeInTheDocument();
    expect(screen.getByText("Pacamara")).toBeInTheDocument();
  });

  it("derives per-variety kilograms and share from the data layer", async () => {
    const ui = await VarietyMixCard();
    render(ui);

    // Geisha leg = kg(5000) = "5,000 kg".
    expect(screen.getByText("5,000 kg")).toBeInTheDocument();
    // total = 10,000 → Geisha share = round(50) = 50%.
    expect(screen.getByText("50%")).toBeInTheDocument();
  });
});
