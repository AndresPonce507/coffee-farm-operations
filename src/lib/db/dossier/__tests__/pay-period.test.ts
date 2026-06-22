import { afterEach, describe, expect, it, vi } from "vitest";

import * as payroll from "@/lib/db/payroll";
import * as people from "@/lib/db/people";
import type { WorkerPay } from "@/lib/db/payroll";
import type { CrewRosterMember } from "@/lib/db/people";

/**
 * getPayPeriodPayLines — the dossier-scoped composite that joins the period's
 * per-worker pay rows (v_worker_pay) with the live roster so EACH pay line can
 * link to BOTH a /workers/[id] dossier AND a /crew/[id] dossier (the worker pay
 * row only carries crewName, never crewId — the roster supplies it). Pure
 * composition over already-tested read ports; no new DB surface.
 */

function payLine(over: Partial<WorkerPay> = {}): WorkerPay {
  return {
    id: 1,
    payPeriodId: "pp-1",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-15",
    workerId: "w-06",
    workerName: "Lucía Morales",
    crewName: "Crew Tizingal",
    hoursWorked: 40,
    pieceRateUsd: 120,
    hourlyUsd: 0,
    minWageFloorUsd: 130,
    makeWholeUsd: 0,
    grossUsd: 130,
    cssUsd: 12,
    seguroEducativoUsd: 2,
    decimoAccrualUsd: 11,
    netUsd: 105,
    status: "calculated",
    reversesId: null,
    madeWhole: false,
    ...over,
  };
}

function rosterMember(over: Partial<CrewRosterMember> = {}): CrewRosterMember {
  return {
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
    ...over,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("getPayPeriodPayLines", () => {
  it("attaches the live roster crewId to each pay line so it can link to a crew dossier", async () => {
    vi.spyOn(payroll, "getWorkerPayForPeriod").mockResolvedValue([
      payLine({ id: 1, workerId: "w-06" }),
      payLine({ id: 2, workerId: "w-03", workerName: "Eduardo Pérez", crewName: "Crew Norte" }),
    ]);
    vi.spyOn(people, "getCrewRoster").mockResolvedValue([
      rosterMember({ workerId: "w-06", crewId: "crew-tizingal" }),
      rosterMember({ workerId: "w-03", crewId: "crew-norte", crewName: "Crew Norte" }),
    ]);

    const { getPayPeriodPayLines } = await import("@/lib/db/dossier/pay-period");
    const lines = await getPayPeriodPayLines("pp-1");

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ workerId: "w-06", crewId: "crew-tizingal" });
    expect(lines[1]).toMatchObject({ workerId: "w-03", crewId: "crew-norte" });
    // the original pay figures survive the join untouched.
    expect(lines[0].netUsd).toBe(105);
  });

  it("leaves crewId null when the worker is not on the current roster (no fabricated crew link)", async () => {
    vi.spyOn(payroll, "getWorkerPayForPeriod").mockResolvedValue([
      payLine({ id: 9, workerId: "w-ghost", crewName: "Crew Gone" }),
    ]);
    vi.spyOn(people, "getCrewRoster").mockResolvedValue([
      rosterMember({ workerId: "w-06", crewId: "crew-tizingal" }),
    ]);

    const { getPayPeriodPayLines } = await import("@/lib/db/dossier/pay-period");
    const lines = await getPayPeriodPayLines("pp-1");

    expect(lines[0].crewId).toBeNull();
  });

  it("scopes the read to the requested period id", async () => {
    const spy = vi
      .spyOn(payroll, "getWorkerPayForPeriod")
      .mockResolvedValue([]);
    vi.spyOn(people, "getCrewRoster").mockResolvedValue([]);

    const { getPayPeriodPayLines } = await import("@/lib/db/dossier/pay-period");
    await getPayPeriodPayLines("pp-42");

    expect(spy).toHaveBeenCalledWith("pp-42");
  });
});
