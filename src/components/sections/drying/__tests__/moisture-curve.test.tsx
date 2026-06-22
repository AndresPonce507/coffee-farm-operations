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

  /* ──────────────────────────────────────────────────────────────────────
   * S4 finding #109 — the reposo band is a TUNABLE SSOT (farm_season_config.
   * reposo_moisture_min/max_pct). The curve must draw + judge against whatever
   * band the caller supplies, NEVER a hardcoded copy of its own — otherwise the
   * gate (which uses the tuned band) and the curve (which would draw the stale
   * literal) silently contradict each other once the family tunes the window.
   * These lock the component to its props: the band is the caller's, not ours.
   * ────────────────────────────────────────────────────────────────────── */
  describe("tracks the tunable reposo band from props (SSOT, finding #109)", () => {
    it("renders an endpoint IN-BAND when a tuned upper edge admits the latest reading", () => {
      // Family raised reposo_moisture_max_pct to 12.0 for a natural-process lot.
      // A latest reading of 11.8% is OUT of the legacy 10.5–11.5 window but well
      // inside the tuned 9.5–12.0 window — the curve must agree with the gate.
      render(
        <MoistureCurve
          curve={[...curve.slice(0, 2), { lotCode: "JC-571", moisturePct: 11.8, occurredAt: "2026-06-19T08:00:00Z" }]}
          bandMin={9.5}
          bandMax={12.0}
        />,
      );
      expect(screen.getByTestId("moisture-endpoint")).toHaveAttribute("data-in-band", "true");
    });

    it("renders an endpoint OUT-OF-BAND when a tuned lower edge excludes the latest reading", () => {
      // A tightened-up window (11.2–11.8) excludes an 11.1% reading the legacy
      // 10.5–11.5 window would have admitted — the curve tracks the tuned edge.
      render(
        <MoistureCurve curve={curve} bandMin={11.2} bandMax={11.8} />,
      );
      expect(screen.getByTestId("moisture-endpoint")).toHaveAttribute("data-in-band", "false");
    });

    it("surfaces the supplied band — not a hardcoded 10.5–11.5 — in the chip and aria summary", () => {
      render(<MoistureCurve curve={curve} bandMin={9.5} bandMax={12} />);
      // The label chip shows the live, tuned window.
      expect(screen.getByText(/target 9\.5–12%/)).toBeInTheDocument();
      // The accessible summary names the same tuned band.
      expect(screen.getByRole("img")).toHaveAttribute(
        "aria-label",
        expect.stringMatching(/target band 9\.5–12%/),
      );
      // And NOT the stale legacy literal anywhere.
      expect(screen.queryByText(/10\.5–11\.5%/)).not.toBeInTheDocument();
    });
  });
});
