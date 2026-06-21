import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Worker } from "@/lib/types";

vi.mock("@/app/(app)/qc/actions", () => ({
  recordCuppingSessionAction: vi.fn(),
  recordCupScoreAction: vi.fn(),
  QC_IDLE: { status: "idle" },
}));

import { CuppingScoresheet } from "@/components/sections/qc/cupping-scoresheet";

const CUPPERS: Pick<Worker, "id" | "name">[] = [
  { id: "w-cup-1", name: "Marisol" },
  { id: "w-cup-2", name: "Diego" },
];

describe("CuppingScoresheet (smoke + live total)", () => {
  it("renders the scoresheet for a green lot with a protocol toggle", () => {
    render(<CuppingScoresheet lotCode="JC-9001" cuppers={CUPPERS} />);
    expect(screen.getByText("JC-9001")).toBeInTheDocument();
    // both protocols are offered.
    expect(screen.getByRole("button", { name: /sca cva/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /legacy/i })).toBeInTheDocument();
  });

  it("defaults to the 8 SCA CVA attributes", () => {
    render(<CuppingScoresheet lotCode="JC-9001" cuppers={CUPPERS} />);
    // CVA-specific attribute that legacy lacks.
    expect(screen.getByText(/mouthfeel/i)).toBeInTheDocument();
  });

  it("shows a live running total that updates as a score changes", () => {
    render(<CuppingScoresheet lotCode="JC-9001" cuppers={CUPPERS} />);
    const total = screen.getByTestId("cup-live-total");
    expect(total).toHaveTextContent("0");

    const sliders = screen.getAllByRole("slider");
    // set the first attribute to 8 → the live total reflects it.
    fireEvent.change(sliders[0], { target: { value: "8" } });
    expect(total).toHaveTextContent("8");
  });

  it("switches to the 10 legacy attributes when the toggle is pressed", () => {
    render(<CuppingScoresheet lotCode="JC-9001" cuppers={CUPPERS} />);
    fireEvent.click(screen.getByRole("button", { name: /legacy/i }));
    // legacy-specific attribute that CVA lacks.
    expect(screen.getByText(/clean.?cup/i)).toBeInTheDocument();
  });

  it("lists the cuppers to attribute the session to", () => {
    render(<CuppingScoresheet lotCode="JC-9001" cuppers={CUPPERS} />);
    expect(screen.getByText("Marisol")).toBeInTheDocument();
    expect(screen.getByText("Diego")).toBeInTheDocument();
  });
});
