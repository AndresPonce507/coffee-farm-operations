import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatCard } from "@/components/ui/stat-card";

// Globals are off — register RTL cleanup so each render gets a fresh body.
afterEach(cleanup);

describe("StatCard", () => {
  it("renders the label and value (existing contract, no new props)", () => {
    render(<StatCard label="Season to date" value="60,000 kg" />);
    expect(screen.getByText("Season to date")).toBeInTheDocument();
    expect(screen.getByText("60,000 kg")).toBeInTheDocument();
  });

  it("renders a measured figure at full visual weight (no est. prefix)", () => {
    render(
      <StatCard
        label="Season to date"
        value="60,000 kg"
        provenance={{ derivedFromCount: 47, asOf: "14:03" }}
      />,
    );
    const value = screen.getByText("60,000 kg");
    // Full-weight measured ink: not the lighter "modeled" treatment.
    expect(value).toHaveClass("text-ink");
    expect(value).not.toHaveClass("text-muted-fg");
    // No estimate prefix anywhere for a measured figure.
    expect(screen.queryByText(/est\./i)).toBeNull();
  });

  it("shows the provenance line with a real row count and timestamp", () => {
    render(
      <StatCard
        label="Season to date"
        value="60,000 kg"
        provenance={{ derivedFromCount: 47, asOf: "14:03" }}
      />,
    );
    // AD-4: "derived from N harvests · HH:MM" — count AND time, always visible
    // (no hover dependence — the farm iPad has none).
    const line = screen.getByText(/derived from 47 harvests/i);
    expect(line).toBeInTheDocument();
    expect(line).toHaveTextContent("14:03");
  });

  it("renders a modeled figure with an in-readout est. prefix and lighter ink", () => {
    render(
      <StatCard
        label="YTD revenue"
        value="$486,500"
        modeled
        accent="honey"
      />,
    );
    // The "est." prefix is IN the readout itself (AD-4), never hover-only.
    expect(screen.getByText(/est\./i)).toBeInTheDocument();
    // The modeled value reads lighter than a measured one.
    const value = screen.getByText(/486,500/);
    expect(value).toHaveClass("text-muted-fg");
    expect(value).not.toHaveClass("text-ink");
  });

  it("does not render a provenance line when none is supplied", () => {
    render(<StatCard label="Drying batches" value="3" />);
    expect(screen.queryByText(/derived from/i)).toBeNull();
  });
});
