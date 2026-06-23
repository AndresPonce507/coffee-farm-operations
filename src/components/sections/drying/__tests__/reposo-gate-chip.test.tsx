import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReposoGateChip } from "@/components/sections/drying/reposo-gate-chip";
import type { ReposoStatus } from "@/lib/types";

const blocked: ReposoStatus = {
  lotCode: "JC-571",
  latestMoisture: 11.8,
  readingCount: 3,
  moistureStable: false,
  dryingStartedAt: "2026-06-14T08:00:00Z",
  restDaysElapsed: 4.2,
  restMet: false,
  ready: false,
  reason: "resting 4/10 days",
};

const open: ReposoStatus = {
  lotCode: "JC-572",
  latestMoisture: 11.0,
  readingCount: 4,
  moistureStable: true,
  dryingStartedAt: "2026-06-08T08:00:00Z",
  restDaysElapsed: 12.4,
  restMet: true,
  ready: true,
  reason: "rest-stable — clear to mill",
};

describe("ReposoGateChip (smoke)", () => {
  it("renders a RED, blocked chip with rest-days + moisture when the gate is closed", () => {
    render(<ReposoGateChip reposo={blocked} />);
    const chip = screen.getByRole("status");
    expect(chip).toHaveAttribute("data-ready", "false");
    expect(chip).toHaveTextContent(/Resting/);
    expect(chip).toHaveTextContent(/4 days/);
    expect(chip).toHaveTextContent(/11\.8%/);
    expect(chip).toHaveTextContent(/blocked/);
    expect(chip.className).toMatch(/cherry/); // red tone
  });

  it("renders a GREEN, clear chip when the gate is open", () => {
    render(<ReposoGateChip reposo={open} />);
    const chip = screen.getByRole("status");
    expect(chip).toHaveAttribute("data-ready", "true");
    expect(chip).toHaveTextContent(/Rest-stable/);
    expect(chip).toHaveTextContent(/clear to mill/);
    expect(chip.className).toMatch(/forest/); // green tone
  });

  it("rides AA-safe red TEXT on the cherry tint (>= 4.5:1) for the most-common blocked state", () => {
    // The blocked chip is the primary status surface this slice introduces; it is
    // shown throughout reposo in bright Volcán daylight. `text-cherry` (#b5482e) on
    // `bg-cherry-100` (#f6ddd4) measures only 4.124:1 — below the WCAG-AA 4.5:1 floor
    // for normal text (the 12px semibold label is NOT "large text"). The fix darkens
    // the TEXT token (#8f3522 -> 6.0:1) while keeping the cherry tint background.
    render(<ReposoGateChip reposo={blocked} />);
    const chip = screen.getByRole("status");

    // Background stays the cherry tint (red tone preserved)...
    expect(chip.className).toMatch(/bg-cherry-100/);
    // ...but the text is the darkened, AA-safe token `text-cherry-700` (#8f3522),
    // NOT a one-off hex and NOT the lighter base accent on its own.
    expect(chip.className).toContain("text-cherry-700");
    const textColor = "#8f3522"; // --color-cherry-700 (globals.css)

    // Independently verify the rendered pair clears AA on the real (opaque) background.
    const lin = (c: number) => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const L = (hex: string) => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const ratio = (a: string, b: string) => {
      const hi = Math.max(L(a), L(b));
      const lo = Math.min(L(a), L(b));
      return (hi + 0.05) / (lo + 0.05);
    };
    const CHERRY_TINT = "#f6ddd4"; // --color-cherry-100
    expect(ratio(textColor!, CHERRY_TINT)).toBeGreaterThanOrEqual(4.5);
  });

  it("carries an accessible label echoing the gate reason", () => {
    render(<ReposoGateChip reposo={blocked} />);
    expect(
      screen.getByLabelText(/Reposo gate closed: resting 4\/10 days/i),
    ).toBeInTheDocument();
  });

  it("shows '—' gracefully when there is no moisture reading yet (no fabricated 0)", () => {
    render(
      <ReposoGateChip
        reposo={{ ...blocked, latestMoisture: null, restDaysElapsed: null, reason: "no drying record yet" }}
      />,
    );
    const chip = screen.getByRole("status");
    // No moisture segment is rendered when latestMoisture is null.
    expect(chip).not.toHaveTextContent(/%/);
  });
});

describe("ReposoGateChip (state icon)", () => {
  // Regression: the blocked branch used to hardcode <Lock>, so the computed
  // Hourglass / Droplets icons were dead code that never rendered. The icon must
  // reflect WHY the gate is closed: hourglass when only rest-time remains (moisture
  // already stable), droplets when the lot still needs to dry.
  it("shows the HOURGLASS icon when blocked but moisture is already stable (waiting on rest days)", () => {
    const { container } = render(
      <ReposoGateChip reposo={{ ...blocked, moistureStable: true }} />,
    );
    expect(container.querySelector("svg.lucide-hourglass")).toBeInTheDocument();
    expect(container.querySelector("svg.lucide-droplets")).not.toBeInTheDocument();
    // Never falls back to the old hardcoded lock.
    expect(container.querySelector("svg.lucide-lock")).not.toBeInTheDocument();
  });

  it("shows the DROPLETS icon when blocked and moisture is not yet stable (still drying)", () => {
    const { container } = render(
      <ReposoGateChip reposo={{ ...blocked, moistureStable: false }} />,
    );
    expect(container.querySelector("svg.lucide-droplets")).toBeInTheDocument();
    expect(container.querySelector("svg.lucide-hourglass")).not.toBeInTheDocument();
    expect(container.querySelector("svg.lucide-lock")).not.toBeInTheDocument();
  });

  it("shows the CHECK icon when the gate is open", () => {
    const { container } = render(<ReposoGateChip reposo={open} />);
    expect(container.querySelector("svg.lucide-circle-check")).toBeInTheDocument();
    expect(container.querySelector("svg.lucide-hourglass")).not.toBeInTheDocument();
    expect(container.querySelector("svg.lucide-droplets")).not.toBeInTheDocument();
  });
});
