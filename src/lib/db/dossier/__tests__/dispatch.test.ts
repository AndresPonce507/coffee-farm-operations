import { afterEach, describe, expect, it, vi } from "vitest";

import type { CrewDossier, CrewRosterMember } from "@/lib/db/people";
import type { DispatchCard } from "@/lib/types";

/* The dossier getter is a PURE COMPOSITION of two live getters — mock both so the
 * test proves the composition logic (enrichment + crew-absent fallback + null
 * passthrough) with no Supabase. */

vi.mock("@/lib/db/dispatch", () => ({
  getDispatchRunById: vi.fn(),
}));
vi.mock("@/lib/db/people", () => ({
  getCrewById: vi.fn(),
}));

import { getDispatchRunDossier } from "@/lib/db/dossier/dispatch";
import { getDispatchRunById } from "@/lib/db/dispatch";
import { getCrewById } from "@/lib/db/people";

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
  {
    workerId: "w-07",
    name: "Carlos Beker",
    role: "Picker",
    crewName: "Crew Norte",
    crewId: "crew-norte",
    attendance: "present",
    preferredName: null,
    comarcaOrigin: null,
    languages: ["es"],
    rehireEligible: true,
  },
];

const crew: CrewDossier = {
  crewId: "crew-norte",
  crewName: "Crew Norte",
  memberCount: 2,
  presentCount: 2,
  members,
};

afterEach(() => vi.clearAllMocks());

describe("getDispatchRunDossier", () => {
  it("returns null (no fabricated run) for an unknown id without ever hitting the crew getter", async () => {
    vi.mocked(getDispatchRunById).mockResolvedValueOnce(null);

    const result = await getDispatchRunDossier("999");

    expect(result).toBeNull();
    expect(getCrewById).not.toHaveBeenCalled();
  });

  it("enriches a found run with its crew roster members and de-duplicated languages", async () => {
    vi.mocked(getDispatchRunById).mockResolvedValueOnce(run);
    vi.mocked(getCrewById).mockResolvedValueOnce(crew);

    const result = await getDispatchRunDossier("42");

    expect(getDispatchRunById).toHaveBeenCalledWith("42");
    expect(getCrewById).toHaveBeenCalledWith("crew-norte");
    expect(result?.run).toBe(run);
    expect(result?.crewMembers.map((m) => m.workerId)).toEqual(["w-06", "w-07"]);
    // languages are unioned + de-duped (es appears on both members → once).
    expect(result?.crewLanguages).toEqual(["es", "ngäbere"]);
  });

  it("renders the run even when the crew has left the roster (crew-absent fallback)", async () => {
    vi.mocked(getDispatchRunById).mockResolvedValueOnce(run);
    vi.mocked(getCrewById).mockResolvedValueOnce(null);

    const result = await getDispatchRunDossier("42");

    expect(result?.run).toBe(run);
    expect(result?.crewMembers).toEqual([]);
    expect(result?.crewLanguages).toEqual([]);
  });
});
