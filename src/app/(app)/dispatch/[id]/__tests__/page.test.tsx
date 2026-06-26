import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CrewRosterMember } from "@/lib/db/people";
import type { DispatchRunDossier } from "@/lib/db/dossier/dispatch";
import type { DispatchCard } from "@/lib/types";

const run: DispatchCard = {
  id: 42,
  crewId: "crew-norte",
  crewName: "Crew Norte",
  dispatchDate: "2026-06-22",
  season: "2026",
  status: "sent",
  sentChannel: "web-share",
  readinessThreshold: 0.7,
  idempotencyKey: "key-abc",
  plotCount: 2,
  plots: [
    {
      id: 1,
      dispatchRunId: 42,
      plotId: "p-norte-bajo",
      plotName: "Norte Bajo",
      variety: "Catuaí",
      altitudeMasl: 1400,
      taskKind: "picking",
      targetKg: 120,
      ripenessTarget: "high",
      readiness: 0.92,
      ord: 0,
    },
    {
      id: 2,
      dispatchRunId: 42,
      plotId: "p-norte-alto",
      plotName: "Norte Alto",
      variety: "Geisha",
      altitudeMasl: 1650,
      taskKind: "picking",
      targetKg: null,
      ripenessTarget: "medium",
      readiness: 0.81,
      ord: 1,
    },
  ],
};

const members: CrewRosterMember[] = [
  {
    workerId: "w-06",
    name: "Lucía Morales",
    role: "Picker",
    crewName: "Crew Norte",
    crewId: "crew-norte",
    attendance: "present",
    preferredName: "Lucía",
    comarcaOrigin: "Ngäbe-Buglé",
    languages: ["es", "ngäbere"],
    rehireEligible: true,
  },
];

const dossier: DispatchRunDossier = {
  run,
  crewMembers: members,
  crewLanguages: ["es", "ngäbere"],
};

vi.mock("@/lib/db/dossier/dispatch", () => ({
  getDispatchRunDossier: vi.fn(async () => dossier),
}));

const NOT_FOUND = new Error("NEXT_NOT_FOUND");
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw NOT_FOUND;
  }),
}));

import DispatchDossierPage from "@/app/(app)/dispatch/[id]/page";
import { getDispatchRunDossier } from "@/lib/db/dossier/dispatch";
import { notFound } from "next/navigation";

describe("/dispatch/[id] dossier page", () => {
  it("renders the dispatch-run dossier shell for a known run id", async () => {
    const ui = await DispatchDossierPage({
      params: Promise.resolve({ id: "42" }),
    });
    render(ui);

    expect(getDispatchRunDossier).toHaveBeenCalledWith("42");
    expect(screen.getByTestId("dossier-dispatch")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: /Crew Norte/ }),
    ).toBeInTheDocument();
  });

  it("calls notFound() for an unknown run id instead of fabricating a dossier", async () => {
    vi.mocked(notFound).mockClear();
    vi.mocked(getDispatchRunDossier).mockResolvedValueOnce(null);

    await expect(
      DispatchDossierPage({ params: Promise.resolve({ id: "999" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("renders at least four cross-entity links (crew + plots + workers)", async () => {
    const ui = await DispatchDossierPage({
      params: Promise.resolve({ id: "42" }),
    });
    render(ui);

    const hrefs = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"))
      .filter((h): h is string => Boolean(h));

    // crew, both plots, the worker → at least four distinct cross-entity dossiers.
    expect(hrefs).toContain("/crew/crew-norte");
    expect(hrefs).toContain("/plots/p-norte-bajo");
    expect(hrefs).toContain("/plots/p-norte-alto");
    expect(hrefs).toContain("/workers/w-06");

    const crossLinks = hrefs.filter((h) =>
      /^\/(crew|plots|workers)\//.test(h),
    );
    expect(new Set(crossLinks).size).toBeGreaterThanOrEqual(4);
  });
});
