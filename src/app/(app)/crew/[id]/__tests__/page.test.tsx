import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  CrewAssignedPlot,
  CrewProductivity,
} from "@/lib/db/dossier/crew";
import type { CrewDossier } from "@/lib/db/people";
import type { DispatchCard } from "@/lib/types";

/**
 * /crew/[id] dossier page behavior test (mirrors lots/[code] exemplar).
 *
 * The page is an async Server Component that resolves the crew anchor with ONE
 * getter (getCrewById) → notFound() if absent, BEFORE any section fetch (P2),
 * then Promise.all's the deeper section reads (P3) and renders through
 * <DossierShell> + the Members / Plots / Dispatch / Productivity sections (P4).
 * We mock the read ports (no Supabase) and assert: known id renders the identity
 * header + all four sections; unknown id → 404; and the dossier surfaces ≥4
 * cross-entity links across ≥3 distinct dossier kinds (worker · plot · dispatch).
 */

const crew: CrewDossier = {
  crewId: "crew-tizingal",
  crewName: "Crew Tizingal",
  memberCount: 2,
  presentCount: 1,
  members: [
    {
      workerId: "w-06",
      name: "Lucía Morales",
      role: "Picker",
      crewName: "Crew Tizingal",
      crewId: "crew-tizingal",
      attendance: "present",
      preferredName: "Lucía",
      comarcaOrigin: "Ngäbe-Buglé",
      languages: ["es", "ngäbere"],
      rehireEligible: true,
    },
    {
      workerId: "w-07",
      name: "Carlos Beker",
      role: "Picker",
      crewName: "Crew Tizingal",
      crewId: "crew-tizingal",
      attendance: "rest-day",
      preferredName: null,
      comarcaOrigin: null,
      languages: ["es"],
      rehireEligible: false,
    },
  ],
};

const history: DispatchCard[] = [
  {
    id: 42,
    crewId: "crew-tizingal",
    crewName: "Crew Tizingal",
    dispatchDate: "2026-06-20",
    season: "2026",
    status: "sent",
    sentChannel: "web-share",
    readinessThreshold: 0.6,
    idempotencyKey: null,
    plotCount: 1,
    plots: [
      {
        id: 1,
        dispatchRunId: 42,
        plotId: "p-norte-bajo",
        plotName: "Norte Bajo",
        variety: "Catuaí",
        altitudeMasl: 1400,
        taskKind: "picking",
        targetKg: null,
        ripenessTarget: "high",
        readiness: 0.7,
        ord: 1,
      },
    ],
  },
];

const assignedPlots: CrewAssignedPlot[] = [
  {
    plotId: "p-norte-bajo",
    plotName: "Norte Bajo",
    variety: "Catuaí",
    altitudeMasl: 1400,
    runCount: 2,
    lastDispatchDate: "2026-06-20",
  },
];

const productivity: CrewProductivity = {
  pickers: [
    {
      workerId: "w-06",
      name: "Lucía Morales",
      crewId: "crew-tizingal",
      lataCount: 7,
      kgToday: 70,
      lastWeighAt: "2026-06-22T11:00:00Z",
    },
  ],
  totalKg: 70,
  totalLatas: 7,
  pickerCount: 1,
};

vi.mock("@/lib/db/people", () => ({
  getCrewById: vi.fn(async (id: string): Promise<CrewDossier | null> =>
    id === "crew-tizingal" ? crew : null,
  ),
}));

vi.mock("@/lib/db/dossier/crew", () => ({
  getCrewAssignedPlots: vi.fn(
    async (): Promise<CrewAssignedPlot[]> => assignedPlots,
  ),
  getCrewDispatchHistory: vi.fn(async (): Promise<DispatchCard[]> => history),
  getCrewProductivity: vi.fn(
    async (): Promise<CrewProductivity> => productivity,
  ),
}));

const NOT_FOUND = new Error("NEXT_NOT_FOUND");
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw NOT_FOUND;
  }),
}));

import CrewDossierPage from "@/app/(app)/crew/[id]/page";
import { getCrewById } from "@/lib/db/people";
import { notFound } from "next/navigation";

afterEach(cleanup);

describe("/crew/[id] dossier page (smoke)", () => {
  it("resolves the crew anchor and renders the identity header + all four sections", async () => {
    const ui = await CrewDossierPage({
      params: Promise.resolve({ id: "crew-tizingal" }),
    });
    render(ui);

    // Anchor resolved via the ONE existence-gate getter.
    expect(getCrewById).toHaveBeenCalledWith("crew-tizingal");

    // Identity: the shell names the crew and tags it as a crew dossier.
    expect(
      screen.getByRole("heading", { level: 1, name: /Crew Tizingal/ }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("dossier-crew")).toBeInTheDocument();

    // The four sections render (roster · plots · dispatch · productivity).
    expect(screen.getByTestId("section-roster")).toBeInTheDocument();
    expect(screen.getByTestId("section-plots")).toBeInTheDocument();
    expect(screen.getByTestId("section-dispatch")).toBeInTheDocument();
    expect(screen.getByTestId("section-productivity")).toBeInTheDocument();
  });

  it("surfaces >=4 cross-entity links across >=3 dossier kinds (worker · plot · dispatch)", async () => {
    const ui = await CrewDossierPage({
      params: Promise.resolve({ id: "crew-tizingal" }),
    });
    render(ui);

    // worker (roster + productivity), plot (plots section + dispatch line), dispatch-run.
    // The dispatch-run line links to /dispatch/42 — its accessible name is now the visible
    // "Despacho del <date>" text (WCAG 2.5.3), not the raw run id, so match by href.
    const dispatchLink = screen
      .getAllByRole("link")
      .find((a) => a.getAttribute("href") === "/dispatch/42");
    expect(dispatchLink).toBeDefined();

    const hrefs = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href") ?? "");
    const kinds = new Set(hrefs.map((h) => h.split("/")[1]));
    for (const k of ["workers", "plots", "dispatch"]) {
      expect(kinds.has(k)).toBe(true);
    }
    // ≥4 total cross-entity links (outcome-kpis avg ≥4 links/dossier).
    expect(hrefs.length).toBeGreaterThanOrEqual(4);
    expect(kinds.size).toBeGreaterThanOrEqual(3);
  });

  it("calls notFound() for an unknown crew id instead of fabricating a dossier", async () => {
    vi.mocked(notFound).mockClear();

    await expect(
      CrewDossierPage({ params: Promise.resolve({ id: "crew-nope" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFound).toHaveBeenCalledTimes(1);
  });
});
