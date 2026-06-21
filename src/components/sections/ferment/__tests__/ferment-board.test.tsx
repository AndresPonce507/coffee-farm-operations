import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FermentBatch } from "@/lib/db/ferment";

// The start button is the one client island; stub the action import.
vi.mock("@/app/(app)/ferment/actions", () => ({
  startFermentBatchAction: vi.fn(),
  FERMENT_IDLE: { status: "idle" },
}));

import { FermentBoard } from "@/components/sections/ferment/ferment-board";

const batches: FermentBatch[] = [
  {
    id: "b1",
    lotCode: "JC-800",
    recipeId: "rec-geisha-anaerobic-v1",
    method: "Anaerobic",
    startedAt: "2026-06-20T06:00:00Z",
    endedAt: null,
  },
  {
    id: "b2",
    lotCode: "JC-801",
    recipeId: null,
    method: "Washed",
    startedAt: "2026-06-19T06:00:00Z",
    endedAt: "2026-06-20T18:00:00Z",
  },
];

describe("FermentBoard (smoke)", () => {
  it("renders a card per ferment batch linking to its tracker", () => {
    render(<FermentBoard batches={batches} lots={["JC-800", "JC-801"]} recipes={[]} />);
    expect(screen.getByTestId("ferment-batch-b1")).toHaveAttribute(
      "href",
      "/ferment/b1",
    );
    expect(screen.getByTestId("ferment-batch-b2")).toHaveAttribute(
      "href",
      "/ferment/b2",
    );
    expect(screen.getAllByText("JC-800").length).toBeGreaterThan(0);
  });

  it("distinguishes a live (active) batch from a finished one", () => {
    render(<FermentBoard batches={batches} lots={[]} recipes={[]} />);
    // b1 has no ended_at → live; b2 has ended_at → finished
    expect(screen.getByTestId("ferment-batch-b1").textContent ?? "").toMatch(/live|active/i);
    expect(screen.getByTestId("ferment-batch-b2").textContent ?? "").toMatch(/finished|done|ended/i);
  });

  it("offers a start-ferment affordance", () => {
    render(<FermentBoard batches={batches} lots={["JC-800"]} recipes={[]} />);
    expect(
      screen.getByRole("button", { name: /start ferment|new ferment/i }),
    ).toBeInTheDocument();
  });

  it("renders a glass empty state when there are no batches", () => {
    render(<FermentBoard batches={[]} lots={["JC-800"]} recipes={[]} />);
    expect(screen.getByText(/no ferment|nothing fermenting/i)).toBeInTheDocument();
  });
});
