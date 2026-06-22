import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FermentRecipe } from "@/lib/db/ferment";
import type { FermentActionState } from "@/app/(app)/ferment/actions";

vi.mock("@/app/(app)/ferment/actions", () => ({
  startFermentBatchAction: vi.fn(),
  FERMENT_IDLE: { status: "idle" },
}));

// Controllable useActionState so we can render the error branch without
// driving a real form submission. Defaults to the idle state.
let actionState: FermentActionState = { status: "idle" };
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useActionState: () => [actionState, () => {}, false],
  };
});

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
  afterEach(() => {
    actionState = { status: "idle" };
  });

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

  it("requires a recipe — no empty-value 'apply later' option, just a disabled placeholder", () => {
    render(<StartFermentForm lots={lots} recipes={recipes} />);
    const recipeSelect = document.querySelector<HTMLSelectElement>(
      "select[name='recipeId']",
    );
    // The recipe is mandatory at start: the select is `required` so the
    // browser blocks submit, and there is NO selectable empty-value option
    // (the dead 'No recipe (apply later)' affordance that could never be bound
    // afterward — finding #34 — is gone).
    expect(recipeSelect?.required).toBe(true);
    const emptyOptions = Array.from(
      recipeSelect?.querySelectorAll("option[value='']") ?? [],
    ) as HTMLOptionElement[];
    expect(emptyOptions).toHaveLength(1);
    expect(emptyOptions[0].disabled).toBe(true);
    expect(emptyOptions[0].textContent ?? "").not.toMatch(/apply later/i);
  });

  it("surfaces a recipe field error and marks the select aria-invalid", () => {
    actionState = {
      status: "error",
      errors: { recipeId: "Choose a recipe to ferment against." },
    };
    render(<StartFermentForm lots={lots} recipes={recipes} />);
    expect(
      screen.getByText("Choose a recipe to ferment against."),
    ).toBeInTheDocument();
    const recipeSelect = document.querySelector<HTMLSelectElement>(
      "select[name='recipeId']",
    );
    expect(recipeSelect?.getAttribute("aria-invalid")).toBe("true");
  });
});
