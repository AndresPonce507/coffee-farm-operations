import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Stub the data ports + the board section so this test asserts the PAGE's job:
// the header + the board, wired in order, with the data it fetched.
vi.mock("@/lib/db/ferment", () => ({
  getFermentBatches: vi.fn(async () => []),
  getActiveRecipes: vi.fn(async () => []),
}));
vi.mock("@/lib/db/lots", () => ({
  getLots: vi.fn(async () => ["JC-800"]),
}));
vi.mock("@/components/sections/ferment/ferment-board", () => ({
  FermentBoard: () => <div data-testid="ferment-board-stub" />,
}));

import FermentPage from "@/app/(app)/ferment/page";

afterEach(cleanup);

describe("/ferment page (smoke)", () => {
  it("renders the header above the ferment board", async () => {
    const ui = await FermentPage();
    render(ui);
    expect(
      screen.getByRole("heading", { level: 1, name: "Fermentación" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("ferment-board-stub")).toBeInTheDocument();
  });
});
