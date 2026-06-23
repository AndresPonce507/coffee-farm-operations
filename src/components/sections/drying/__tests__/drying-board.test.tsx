import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DryingBoard } from "@/components/sections/drying/drying-board";
import type { DryingLot } from "@/lib/types";

const restingLot: DryingLot = {
  lotCode: "JC-571",
  variety: "Geisha",
  currentKg: 60,
  stationId: "st-bed-1",
  stationName: "African Bed 1",
  reposo: {
    lotCode: "JC-571",
    latestMoisture: 11.9,
    readingCount: 3,
    moistureStable: false,
    dryingStartedAt: "2026-06-14T08:00:00Z",
    restDaysElapsed: 6.2,
    restMet: true,
    ready: false,
    reason: "moisture 11.9% not yet stable in 10.5–11.5% band",
  },
  curve: [
    { lotCode: "JC-571", moisturePct: 14, occurredAt: "2026-06-15T08:00:00Z" },
    { lotCode: "JC-571", moisturePct: 11.9, occurredAt: "2026-06-19T08:00:00Z" },
  ],
};

const readyLot: DryingLot = {
  ...restingLot,
  lotCode: "JC-572",
  stationName: "Parabolic Tunnel 1",
  reposo: {
    ...restingLot.reposo,
    lotCode: "JC-572",
    latestMoisture: 11.0,
    moistureStable: true,
    ready: true,
    reason: "rest-stable — clear to mill",
  },
  curve: [
    { lotCode: "JC-572", moisturePct: 11.3, occurredAt: "2026-06-17T08:00:00Z" },
    { lotCode: "JC-572", moisturePct: 11.0, occurredAt: "2026-06-19T08:00:00Z" },
  ],
};

describe("DryingBoard (smoke)", () => {
  it("renders a card per resting lot with its code, station, and reposo chip", () => {
    render(<DryingBoard lots={[restingLot, readyLot]} />);
    expect(screen.getByText("Resting lots · the reposo gate")).toBeInTheDocument();
    const cards = screen.getAllByTestId("drying-lot-card");
    expect(cards).toHaveLength(2);
    expect(screen.getByText("JC-571")).toBeInTheDocument();
    expect(screen.getByText("African Bed 1")).toBeInTheDocument();
  });

  it("links each lot's code to its /lots/[code] dossier (entity-bearing row → dossier)", () => {
    render(<DryingBoard lots={[restingLot, readyLot]} />);
    // The visible lot-code text IS the accessible name (WCAG 2.5.3 Label-in-Name):
    // no `name` prop is passed, so the link's accessible name is its visible "JC-571"
    // text, not an "Abrir lote …" slug-label that would mask it. Match by href to
    // disambiguate from the "Advance lot … to milling" links that also name the code.
    const link = screen.getByRole("link", { name: "JC-571" });
    expect(link).toHaveAttribute("href", "/lots/JC-571");
    expect(link).toHaveTextContent("JC-571");
    // The other lot's code is also a dossier link.
    expect(
      screen.getByRole("link", { name: "JC-572" }),
    ).toHaveAttribute("href", "/lots/JC-572");
  });

  it("does NOT override the EntityLink focus ring (MED-10: no rounded-sm / per-call focus-visible:ring on the lot link)", () => {
    render(<DryingBoard lots={[restingLot]} />);
    const link = screen.getByRole("link", { name: "JC-571" });
    // The centralized FOCUS_RING (rounded-xl + ring) is the SOLE radius/ring source.
    // The call site must NOT re-declare its own rounded-sm — which would fight the
    // primitive's rounded-xl and produce two conflicting radius utilities.
    expect(link.className).not.toMatch(/rounded-sm/);
    // Exactly one radius utility remains — the primitive's rounded-xl.
    expect(link.className.match(/rounded-\S+/g)).toEqual(["rounded-xl"]);
    // The primitive's ring is present and is the only focus-visible:ring source.
    expect(link.className).toMatch(/focus-visible:ring-2/);
    expect(link.className.match(/focus-visible:ring-forest\/40/g)).toHaveLength(1);
  });

  it("DISABLES the advance-to-mill button on a blocked lot with the gate reason in the title", () => {
    render(<DryingBoard lots={[restingLot]} />);
    const card = screen.getByTestId("drying-lot-card");
    const btn = within(card).getByRole("button", { name: /Mill — locked/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", expect.stringMatching(/Blocked by the reposo gate/i));
  });

  it("renders the rest-stable advance affordance as a real link to /processing (not a dead button)", () => {
    render(<DryingBoard lots={[readyLot]} />);
    const card = screen.getByTestId("drying-lot-card");
    // The ready affordance must be an honest, navigable control — a link to the
    // Processing surface where AdvanceStageControl performs the real advance —
    // never an enabled primary CTA with no handler. It carries a per-lot
    // accessible name so multiple advance links on the board are distinguishable.
    // WCAG 2.5.3 Label in Name: the accessible name contains the visible "Advance to mill".
    const advance = within(card).getByRole("link", {
      name: /Advance to mill — lot JC-572/i,
    });
    expect(advance).toHaveAttribute("href", "/processing");
    expect(advance).toHaveTextContent(/Advance to mill/i);
    // And there must be NO inert advance button on the ready card.
    expect(
      within(card).queryByRole("button", { name: /Advance to mill/i }),
    ).not.toBeInTheDocument();
  });

  it("threads the config-derived reposo band down into each lot's MoistureCurve (not the hardcoded 10.5–11.5 default)", () => {
    // CRIT-5: the band edges MUST flow from farm_season_config (via getReposoBand),
    // through DryingBoard's bandMin/bandMax, into the curve — never the literal
    // default. Use a window the family TUNED to (9.8–12.2) so a hardcoded default
    // would visibly fail.
    render(<DryingBoard lots={[restingLot]} bandMin={9.8} bandMax={12.2} />);
    // The curve renders the band edges in its target-band chip and SVG aria-summary.
    expect(screen.getByText(/target 9\.8–12\.2%/)).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /target band 9\.8–12\.2%/ }),
    ).toBeInTheDocument();
    // And the hardcoded default window must NOT appear.
    expect(screen.queryByText(/target 10\.5–11\.5%/)).not.toBeInTheDocument();
  });

  it("summarizes how many lots are clear vs resting in the header", () => {
    render(<DryingBoard lots={[restingLot, readyLot]} />);
    expect(screen.getByText(/1 clear to mill/)).toBeInTheDocument();
    expect(screen.getByText(/1 resting/)).toBeInTheDocument();
  });

  it("renders an empty state with no resting lots", () => {
    render(<DryingBoard lots={[]} />);
    expect(screen.getByText(/No lots resting yet/i)).toBeInTheDocument();
  });
});
