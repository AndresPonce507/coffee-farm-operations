import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ActionState } from "@/lib/actions/plots";

// PlotForm only needs IDLE from the actions module at runtime; stub it so the
// form renders without importing next/cache or the Supabase client.
vi.mock("@/lib/actions/plots", () => ({ IDLE: { status: "idle" } }));

import { PlotForm } from "@/components/sections/plots/plot-form";

const noop = async (): Promise<ActionState> => ({ status: "idle" });

describe("PlotForm (smoke)", () => {
  it("renders the plot fields and the submit label", () => {
    render(
      <PlotForm action={noop} submitLabel="Add plot" onDone={() => {}} />,
    );

    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Block")).toBeInTheDocument();
    expect(screen.getByLabelText("Variety")).toBeInTheDocument();
    expect(screen.getByLabelText("Area (ha)")).toBeInTheDocument();
    expect(screen.getByLabelText("Altitude (masl)")).toBeInTheDocument();
    expect(screen.getByLabelText("Trees")).toBeInTheDocument();
    expect(screen.getByLabelText("Shade (%)")).toBeInTheDocument();
    expect(screen.getByLabelText("Established")).toBeInTheDocument();
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
    expect(screen.getByLabelText("Last inspected")).toBeInTheDocument();
    expect(screen.getByLabelText("Expected yield (kg)")).toBeInTheDocument();

    // harvested_kg is intentionally NOT a form field.
    expect(screen.queryByLabelText(/harvested/i)).not.toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: "Add plot" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Geisha" }),
    ).toBeInTheDocument();
  });
});
