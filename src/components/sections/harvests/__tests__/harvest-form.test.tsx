import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Plot, Worker } from "@/lib/types";
import type { ActionState } from "@/lib/actions/harvests";

// HarvestForm only needs IDLE from the actions module at runtime; stub it so the
// form renders without importing next/cache or the Supabase client.
vi.mock("@/lib/actions/harvests", () => ({ IDLE: { status: "idle" } }));

import { HarvestForm } from "@/components/sections/harvests/harvest-form";

const plots = [{ id: "p1", name: "Tizingal Alto" }] as unknown as Plot[];
const pickers = [
  { id: "w-02", name: "Marisol Quintero" },
] as unknown as Worker[];
const lots = ["JC-564", "JC-565"];
const noop = async (): Promise<ActionState> => ({ status: "idle" });

describe("HarvestForm (smoke)", () => {
  it("renders the harvest fields, the lot/picker options, and the submit label", () => {
    render(
      <HarvestForm
        plots={plots}
        pickers={pickers}
        lots={lots}
        action={noop}
        submitLabel="Add harvest"
        onDone={() => {}}
      />,
    );

    expect(screen.getByLabelText("Date")).toBeInTheDocument();
    expect(screen.getByLabelText("Plot")).toBeInTheDocument();
    expect(screen.getByLabelText("Picker")).toBeInTheDocument();
    expect(screen.getByLabelText("Lot")).toBeInTheDocument();
    expect(screen.getByLabelText("Cherries (kg)")).toBeInTheDocument();
    expect(screen.getByLabelText("Ripeness %")).toBeInTheDocument();
    expect(screen.getByLabelText("Brix")).toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: "Add harvest" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Marisol Quintero" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "JC-564" })).toBeInTheDocument();
  });
});
