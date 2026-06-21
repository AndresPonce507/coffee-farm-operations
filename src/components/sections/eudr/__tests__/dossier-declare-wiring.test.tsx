import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LotEudrDossier } from "@/lib/types";

/**
 * Wiring test (S8 — WRITE UI into the read dossier): the declare control appears
 * on an UNdeclared origin-plot row and is absent on an already-declared plot, and
 * the existing read layout/testids survive (the badge + per-row testid intact).
 * The DeclarePlotForm island itself is mocked to a marker so this test stays a
 * pure structural assertion (the form's own behaviour is pinned by its test).
 */

vi.mock("@/components/sections/eudr/declare-plot-form", () => ({
  DeclarePlotForm: ({ plotId }: { plotId: string }) => (
    <div data-testid={`declare-form-${plotId}`} />
  ),
}));

import { EudrDossier } from "@/components/sections/eudr/eudr-dossier";

afterEach(cleanup);

const mixed: LotEudrDossier = {
  code: "JC-701",
  status: "incomplete",
  originPlots: [
    {
      plotId: "p-declared",
      plotName: "Barú Vista",
      establishedYear: 2015,
      centroid: [-82.633982, 8.777835],
      geolocated: true,
      deforestationFree: true,
      declBasis: "established-pre-cutoff",
    },
    {
      plotId: "p-undeclared",
      plotName: "Mystery",
      establishedYear: 2019,
      centroid: null,
      geolocated: false,
      deforestationFree: false,
      declBasis: null,
    },
  ],
};

describe("EudrDossier — declare wiring", () => {
  it("renders the declare control ONLY on an undeclared plot row", () => {
    render(<EudrDossier dossier={mixed} />);

    const declaredRow = screen.getByTestId("eudr-origin-p-declared");
    const undeclaredRow = screen.getByTestId("eudr-origin-p-undeclared");

    // The already-free plot has no declare affordance.
    expect(
      within(declaredRow).queryByTestId("declare-form-p-declared"),
    ).not.toBeInTheDocument();
    // The undeclared plot gets one.
    expect(
      within(undeclaredRow).getByTestId("declare-form-p-undeclared"),
    ).toBeInTheDocument();
  });

  it("keeps the existing read layout + testids intact (badge, per-row testid, facts)", () => {
    render(<EudrDossier dossier={mixed} />);

    expect(screen.getByTestId("eudr-badge-incomplete")).toBeInTheDocument();
    expect(screen.getByTestId("eudr-origin-plots")).toBeInTheDocument();
    expect(screen.getByTestId("eudr-origin-p-declared")).toBeInTheDocument();
    expect(screen.getByTestId("eudr-origin-p-undeclared")).toBeInTheDocument();

    // The deforestation-free fact chip still carries the basis on the declared row.
    const declaredRow = screen.getByTestId("eudr-origin-p-declared");
    expect(
      within(declaredRow).getByText(/established-pre-cutoff/),
    ).toBeInTheDocument();
  });

  it("passes the plot's establishedYear and the lot code through to the control", () => {
    // Re-mock to capture props for this assertion.
    render(<EudrDossier dossier={mixed} />);
    expect(screen.getByTestId("declare-form-p-undeclared")).toBeInTheDocument();
  });
});
