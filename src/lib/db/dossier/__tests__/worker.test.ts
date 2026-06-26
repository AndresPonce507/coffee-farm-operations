import { describe, expect, it } from "vitest";

import {
  composeWorkerIdentity,
  mapWorkerWeigh,
  type WorkerWeighRow,
} from "@/lib/db/dossier/worker";
import type { CrewRosterMember } from "@/lib/db/people";

/* ====================================================================== */
/* Worker-dossier getter unit tests — the PURE pieces (compose + mapper).   */
/* The cache()'d getters themselves hit Supabase (covered via the page test  */
/* mock); here we pin the snake_case → camelCase + numeric-coercion contract */
/* the dossier sections rely on, db-free.                                    */
/* ====================================================================== */

const member: CrewRosterMember = {
  workerId: "w-001",
  name: "Lupita González",
  role: "Picker",
  crewName: "Cuadrilla Norte",
  crewId: "crew-norte",
  attendance: "present",
  preferredName: "Lupita",
  comarcaOrigin: "Ngäbe-Buglé",
  languages: ["es", "ngäbere"],
  rehireEligible: true,
};

describe("composeWorkerIdentity", () => {
  it("merges roster identity with employment facts, coercing numerics", () => {
    const id = composeWorkerIdentity(member, {
      id: "w-001",
      daily_rate_usd: "18.50",
      started_year: "2019",
    });

    expect(id.workerId).toBe("w-001");
    expect(id.preferredName).toBe("Lupita");
    expect(id.crewId).toBe("crew-norte");
    expect(id.languages).toEqual(["es", "ngäbere"]);
    expect(id.dailyRateUsd).toBe(18.5);
    expect(id.startedYear).toBe(2019);
  });

  it("tolerates a missing employment row (rate/year null, identity intact)", () => {
    const id = composeWorkerIdentity(member, null);
    expect(id.dailyRateUsd).toBeNull();
    expect(id.startedYear).toBeNull();
    expect(id.name).toBe("Lupita González");
  });
});

describe("mapWorkerWeigh", () => {
  it("coerces kg/brix and keeps plot + lot for linking", () => {
    const row: WorkerWeighRow = {
      event_uid: "we-1",
      plot_id: "p-tizingal-alto",
      lot_code: "JC-564",
      kg: "12.30",
      ripeness: "ripe",
      brix: "21",
      geofence_ok: true,
      occurred_at: "2026-06-22T15:00:00Z",
    };
    const w = mapWorkerWeigh(row);
    expect(w.kg).toBe(12.3);
    expect(w.brix).toBe(21);
    expect(w.plotId).toBe("p-tizingal-alto");
    expect(w.lotCode).toBe("JC-564");
  });

  it("passes a null brix through as null", () => {
    const row: WorkerWeighRow = {
      event_uid: "we-2",
      plot_id: "p-x",
      lot_code: "JC-1",
      kg: 9,
      ripeness: "underripe",
      brix: null,
      geofence_ok: null,
      occurred_at: "2026-06-22T14:00:00Z",
    };
    expect(mapWorkerWeigh(row).brix).toBeNull();
  });
});
