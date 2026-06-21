import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FermentRecipe } from "@/lib/db/ferment";

vi.mock("@/app/(app)/ferment/actions", () => ({
  startFermentBatchAction: vi.fn(),
  FERMENT_IDLE: { status: "idle" },
}));

import { StartFermentForm } from "@/components/sections/ferment/start-ferment-form";

const recipes: FermentRecipe[] = [
  {
    id: "rec-geisha-anaerobic-v1",
    name: "Volcán Geisha — Anaerobic",
    method: "Anaerobic",
    altitudeBand: "1500-1700",
    targetPh: 4.2,
    targetTempC: 20,
    targetBrixDrop: 4,
    targetHours: 36,
    version: 1,
    supersededBy: null,
  },
];

const lots = ["JC-800", "JC-801"];

describe("StartFermentForm (smoke)", () => {
  it("renders a lot picker, a recipe picker, and a start button", () => {
    render(<StartFermentForm lots={lots} recipes={recipes} />);
    expect(document.querySelector("select[name='lotCode']")).not.toBeNull();
    expect(document.querySelector("select[name='recipeId']")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: /start ferment/i }),
    ).toBeInTheDocument();
  });

  it("lists each lot as an option", () => {
    render(<StartFermentForm lots={lots} recipes={recipes} />);
    const lotSelect = document.querySelector("select[name='lotCode']");
    expect(lotSelect?.textContent ?? "").toContain("JC-800");
    expect(lotSelect?.textContent ?? "").toContain("JC-801");
  });

  it("lists each recipe (with its version) as an option", () => {
    render(<StartFermentForm lots={lots} recipes={recipes} />);
    const recipeSelect = document.querySelector("select[name='recipeId']");
    expect(recipeSelect?.textContent ?? "").toMatch(/Volcán Geisha/);
  });
});
