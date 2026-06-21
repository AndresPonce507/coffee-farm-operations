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
