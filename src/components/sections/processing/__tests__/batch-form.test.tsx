import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ActionState } from "@/lib/actions/processing";

// BatchForm only needs IDLE from the actions module at runtime; stub it so the
// form renders without importing next/cache or the Supabase client.
vi.mock("@/lib/actions/processing", () => ({ IDLE: { status: "idle" } }));

import { BatchForm } from "@/components/sections/processing/batch-form";

const lots = ["JC-561", "JC-564"];
const noop = async (): Promise<ActionState> => ({ status: "idle" });

describe("BatchForm (smoke)", () => {
  it("renders the batch fields and the submit label", () => {
    render(
      <BatchForm
        lots={lots}
        action={noop}
        submitLabel="Add batch"
        onDone={() => {}}
      />,
    );

    expect(screen.getByLabelText("Lot")).toBeInTheDocument();
    expect(screen.getByLabelText("Variety")).toBeInTheDocument();
    expect(screen.getByLabelText("Method")).toBeInTheDocument();
    expect(screen.getByLabelText("Stage")).toBeInTheDocument();
    expect(screen.getByLabelText("Started")).toBeInTheDocument();
    expect(screen.getByLabelText("Cherry intake (kg)")).toBeInTheDocument();
    expect(screen.getByLabelText("Current weight (kg)")).toBeInTheDocument();
    expect(screen.getByLabelText("Moisture (%)")).toBeInTheDocument();
    expect(screen.getByLabelText("Patio / bed")).toBeInTheDocument();
    expect(screen.getByLabelText("Progress (%)")).toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: "Add batch" }),
    ).toBeInTheDocument();
    // Each lot code is offered as an option in the Lot select.
    expect(
      screen.getByRole("option", { name: "JC-564" }),
    ).toBeInTheDocument();
  });
});
