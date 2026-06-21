import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CutpointAlert } from "@/components/sections/ferment/cutpoint-alert";
import type { FermentCutpoint } from "@/lib/db/ferment";

/**
 * Render/smoke test for the cut-point alert chip (P2-S3). Pure presentation: it
 * surfaces the predicted window-close — a calm "resting" state while pH is above the
 * recipe target, and a prominent "CUT NOW" alert (role=alert) once the cut is reached.
 */

const base: FermentCutpoint = {
  batchId: "b1",
  lotCode: "JC-800",
  recipeId: "rec-v1",
  targetPh: 4.2,
  targetHours: 36,
  latestPh: 5.0,
  latestAt: "2026-06-20T10:00:00Z",
  hoursElapsed: 4,
  cutReached: false,
};

describe("CutpointAlert (smoke)", () => {
  it("shows a calm tracking state while pH is above the recipe target", () => {
    render(<CutpointAlert cutpoint={base} />);
    expect(screen.getByText(/tracking|resting|approaching/i)).toBeInTheDocument();
    // no role=alert while not at cut
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("fires a prominent CUT NOW alert (role=alert) once the cut is reached", () => {
    render(<CutpointAlert cutpoint={{ ...base, latestPh: 4.1, cutReached: true }} />);
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert.textContent ?? "").toMatch(/cut/i);
  });

  it("shows a no-recipe state when no recipe target is bound", () => {
    render(
      <CutpointAlert
        cutpoint={{ ...base, recipeId: null, targetPh: null, cutReached: false }}
      />,
    );
    expect(screen.getByText(/no recipe|apply a recipe/i)).toBeInTheDocument();
  });

  it("renders nothing useful but does not throw when there are no readings", () => {
    render(
      <CutpointAlert
        cutpoint={{ ...base, latestPh: null, latestAt: null, hoursElapsed: null, cutReached: false }}
      />,
    );
    expect(screen.getByText(/no readings|waiting/i)).toBeInTheDocument();
  });
});
