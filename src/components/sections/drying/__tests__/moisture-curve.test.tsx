import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MoistureCurve } from "@/components/sections/drying/moisture-curve";
import type { MoistureReading } from "@/lib/types";

const curve: MoistureReading[] = [
  { lotCode: "JC-571", moisturePct: 22, occurredAt: "2026-06-10T08:00:00Z" },
  { lotCode: "JC-571", moisturePct: 16, occurredAt: "2026-06-13T08:00:00Z" },
  { lotCode: "JC-571", moisturePct: 12.5, occurredAt: "2026-06-16T08:00:00Z" },
  { lotCode: "JC-571", moisturePct: 11.1, occurredAt: "2026-06-19T08:00:00Z" },
];

describe("MoistureCurve (smoke)", () => {
  it("renders an accessible SVG with the reading count + latest in the summary", () => {
    render(<MoistureCurve curve={curve} />);
    const svg = screen.getByRole("img");
    expect(svg).toHaveAttribute("aria-label", expect.stringMatching(/4 readings/));
    expect(svg).toHaveAttribute("aria-label", expect.stringMatching(/latest 11\.1%/));
  });

  it("draws the reposo target band overlay", () => {
    render(<MoistureCurve curve={curve} />);
    expect(screen.getByTestId("moisture-target-band")).toBeInTheDocument();
    // The band label chip surfaces the exact window.
    expect(screen.getByText(/target 10\.5–11\.5%/)).toBeInTheDocument();
  });

  it("marks the endpoint GREEN when the latest reading is in-band", () => {
    render(<MoistureCurve curve={curve} />);
    const end = screen.getByTestId("moisture-endpoint");
    expect(end).toHaveAttribute("data-in-band", "true");
  });

  it("marks the endpoint RED when the latest reading is out of band (still too wet)", () => {
    render(
      <MoistureCurve
        curve={[...curve.slice(0, 2), { lotCode: "JC-571", moisturePct: 13.9, occurredAt: "2026-06-19T08:00:00Z" }]}
      />,
    );
    expect(screen.getByTestId("moisture-endpoint")).toHaveAttribute("data-in-band", "false");
  });

  it("shows a graceful empty state with no readings", () => {
    render(<MoistureCurve curve={[]} />);
    expect(screen.getByText(/No moisture readings yet/i)).toBeInTheDocument();
  });
});
