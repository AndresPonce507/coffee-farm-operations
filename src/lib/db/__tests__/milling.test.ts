import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  MillMachineRow,
  MillReadinessRow,
  MillingRunRow,
} from "@/lib/db/milling";

/**
 * Coverage of the `milling.ts` READ-port (P3-S7 — mill readiness + run skeleton, the
 * no-mill-out-of-spec gate): the pure mappers (snake_case view/table row → camelCase
 * domain, numeric coercion of id/kg/pct/aw/outturn columns PostgREST may serialize as
 * strings, NULL preservation for an un-finalized run's green_kg_out / outturn_pct and a
 * machine's un-set calibration date, boolean pass-through for reposo_ready / passed) and
 * the `cache()`-wrapped getters' fetch + map round-trip:
 *
 *   - `getMillingRuns()`            reads `v_milling_runs` (the /mill board read model).
 *   - `getMillReadiness()`          reads `v_mill_readiness` (latest readiness per parchment lot).
 *   - `getMillReadinessForLot(lot)` reads `v_mill_readiness` filtered to one lot, or null (the gate panel).
 *   - `listMillMachines()`          reads `mill_machines` (the dry-mill chain registry).
 *
 * Strategy mirrors `samples.test.ts` / `pricing.test.ts`: mock `@/lib/supabase/server` so
 * `getSupabase()` returns a chainable, thenable query-builder. The readiness gate / outturn
 * mass-balance is the migration's job (pinned by its PGlite tests, not re-implemented here);
 * this port only proves the row→domain seam + NULL handling survive `cache()` and hit the
 * right table/view. The `passed` flag is GENERATED in the DB — the port never recomputes it,
 * it carries the DB's verdict verbatim.
 */

// ----- chainable, per-table Supabase query-builder stub ---------------------

interface QueryResult<T> {
  data: T;
  error: { message: string } | null;
}

type TableResults = Record<string, QueryResult<unknown>>;

function makeClient(results: TableResults) {
  const fromCalls: string[] = [];
  const client = {
    from: (table: string) => {
      fromCalls.push(table);
      const result = results[table] ?? { data: [], error: null };
      const builder: Record<string, unknown> = {
        select: vi.fn(() => builder),
        order: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        limit: vi.fn(() => builder),
        then: (
          onFulfilled: (value: QueryResult<unknown>) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) => Promise.resolve(result).then(onFulfilled, onRejected),
      };
      return builder;
    },
  };
  return { client, fromCalls };
}

const getSupabaseMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => getSupabaseMock(),
}));

beforeEach(() => {
  getSupabaseMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

// ----- fixture rows ---------------------------------------------------------

// An OPEN run: green_kg_out + outturn_pct NULL until finalize lands (S7 is a skeleton).
const openRunRow: MillingRunRow = {
  run_id: "5",
  parchment_lot_code: "JC-204",
  parchment_kg_in: "1200", // numeric PostgREST may serialize as a string
  green_kg_out: null,
  outturn_pct: null,
  status: "open",
  opened_at: "2026-06-24T10:00:00Z",
};

// A finalized run: green_kg_out + outturn_pct populated.
const finalizedRunRow: MillingRunRow = {
  run_id: 6,
  parchment_lot_code: "JC-301",
  parchment_kg_in: 1000,
  green_kg_out: 800,
  outturn_pct: "0.8",
  status: "finalized",
  opened_at: "2026-06-20T09:00:00Z",
};

// A PASSING readiness row: in-spec moisture + aw + reposo cleared.
const passingReadinessRow: MillReadinessRow = {
  parchment_lot_code: "JC-204",
  moisture_pct: "11", // numeric as a string
  water_activity_aw: "0.55",
  reposo_ready: true,
  passed: true,
  measured_at: "2026-06-24T08:00:00Z",
};

// A FAILING readiness row: too wet AND reposo not cleared — passed=false from the DB.
const failingReadinessRow: MillReadinessRow = {
  parchment_lot_code: "JC-301",
  moisture_pct: 12.4,
  water_activity_aw: 0.62,
  reposo_ready: false,
  passed: false,
  measured_at: "2026-06-23T08:00:00Z",
};

const machineRow: MillMachineRow = {
  id: "1",
  kind: "huller",
  name: "Pinhalense huller",
  hours_run: "120.5", // numeric as a string
  calibration_due: "2026-09-01",
  created_at: "2026-06-01T00:00:00Z",
};

// A machine with no calibration date set — NULL preserved, never fabricated.
const uncalibratedMachineRow: MillMachineRow = {
  id: 2,
  kind: "optical_sorter",
  name: "Optical colour sorter",
  hours_run: 0,
  calibration_due: null,
  created_at: "2026-06-01T00:00:00Z",
};

// ----- pure mapper: mapMillingRun -------------------------------------------

describe("mapMillingRun", () => {
  it("maps a v_milling_runs row to a camelCase entry with numeric coercion", async () => {
    const { mapMillingRun } = await import("@/lib/db/milling");
    expect(mapMillingRun(finalizedRunRow)).toEqual({
      runId: 6,
      parchmentLotCode: "JC-301",
      parchmentKgIn: 1000,
      greenKgOut: 800,
      outturnPct: 0.8,
      status: "finalized",
      openedAt: "2026-06-20T09:00:00Z",
    });
  });

  it("preserves NULL green_kg_out / outturn_pct for an open (un-finalized) run", async () => {
    const { mapMillingRun } = await import("@/lib/db/milling");
    const e = mapMillingRun(openRunRow);
    expect(e.runId).toBe(5);
    expect(e.parchmentKgIn).toBe(1200);
    expect(e.greenKgOut).toBeNull();
    expect(e.outturnPct).toBeNull();
    expect(e.status).toBe("open");
  });
});

// ----- pure mapper: mapMillReadiness ----------------------------------------

describe("mapMillReadiness", () => {
  it("maps a v_mill_readiness row to a camelCase entry (numeric coercion, boolean pass-through)", async () => {
    const { mapMillReadiness } = await import("@/lib/db/milling");
    expect(mapMillReadiness(passingReadinessRow)).toEqual({
      parchmentLotCode: "JC-204",
      moisturePct: 11,
      waterActivityAw: 0.55,
      reposoReady: true,
      passed: true,
      measuredAt: "2026-06-24T08:00:00Z",
    });
  });

  it("carries the DB's `passed=false` verdict verbatim (never recomputed in the port)", async () => {
    const { mapMillReadiness } = await import("@/lib/db/milling");
    const e = mapMillReadiness(failingReadinessRow);
    expect(e.passed).toBe(false);
    expect(e.reposoReady).toBe(false);
    expect(e.moisturePct).toBe(12.4);
    expect(e.waterActivityAw).toBe(0.62);
  });
});

// ----- pure mapper: mapMillMachine ------------------------------------------

describe("mapMillMachine", () => {
  it("maps a mill_machines row to a camelCase machine with numeric coercion", async () => {
    const { mapMillMachine } = await import("@/lib/db/milling");
    expect(mapMillMachine(machineRow)).toEqual({
      id: 1,
      kind: "huller",
      name: "Pinhalense huller",
      hoursRun: 120.5,
      calibrationDue: "2026-09-01",
      createdAt: "2026-06-01T00:00:00Z",
    });
  });

  it("preserves a NULL calibration date (never fabricated)", async () => {
    const { mapMillMachine } = await import("@/lib/db/milling");
    const m = mapMillMachine(uncalibratedMachineRow);
    expect(m.calibrationDue).toBeNull();
    expect(m.hoursRun).toBe(0);
    expect(m.kind).toBe("optical_sorter");
  });
});

// ----- getter: getMillingRuns -----------------------------------------------

describe("getMillingRuns", () => {
  it("reads v_milling_runs and returns camelCase entries", async () => {
    const { client, fromCalls } = makeClient({
      v_milling_runs: { data: [openRunRow, finalizedRunRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getMillingRuns } = await import("@/lib/db/milling");
    const runs = await getMillingRuns();

    expect(fromCalls).toContain("v_milling_runs");
    expect(runs).toHaveLength(2);
    expect(runs[0].runId).toBe(5);
    expect(runs[0].greenKgOut).toBeNull();
    expect(runs[1].outturnPct).toBe(0.8);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      v_milling_runs: { data: null, error: { message: "runs boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getMillingRuns } = await import("@/lib/db/milling");
    await expect(getMillingRuns()).rejects.toThrow("getMillingRuns: runs boom");
  });
});

// ----- getter: getMillReadiness ---------------------------------------------

describe("getMillReadiness", () => {
  it("reads v_mill_readiness and returns the latest readiness per lot", async () => {
    const { client, fromCalls } = makeClient({
      v_mill_readiness: {
        data: [passingReadinessRow, failingReadinessRow],
        error: null,
      },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getMillReadiness } = await import("@/lib/db/milling");
    const readiness = await getMillReadiness();

    expect(fromCalls).toContain("v_mill_readiness");
    expect(readiness).toHaveLength(2);
    expect(readiness[0].passed).toBe(true);
    expect(readiness[1].passed).toBe(false);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      v_mill_readiness: { data: null, error: { message: "readiness boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getMillReadiness } = await import("@/lib/db/milling");
    await expect(getMillReadiness()).rejects.toThrow(
      "getMillReadiness: readiness boom",
    );
  });
});

// ----- getter: getMillReadinessForLot ---------------------------------------

describe("getMillReadinessForLot", () => {
  it("reads v_mill_readiness for one lot and returns its latest readiness entry", async () => {
    const { client, fromCalls } = makeClient({
      v_mill_readiness: { data: [passingReadinessRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getMillReadinessForLot } = await import("@/lib/db/milling");
    const r = await getMillReadinessForLot("JC-204");

    expect(fromCalls).toContain("v_mill_readiness");
    expect(r).not.toBeNull();
    expect(r?.parchmentLotCode).toBe("JC-204");
    expect(r?.passed).toBe(true);
  });

  it("returns null when the lot has no readiness row yet (gate not satisfied)", async () => {
    const { client } = makeClient({
      v_mill_readiness: { data: [], error: null },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getMillReadinessForLot } = await import("@/lib/db/milling");
    expect(await getMillReadinessForLot("JC-999")).toBeNull();
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      v_mill_readiness: { data: null, error: { message: "lot boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getMillReadinessForLot } = await import("@/lib/db/milling");
    await expect(getMillReadinessForLot("JC-204")).rejects.toThrow(
      "getMillReadinessForLot: lot boom",
    );
  });
});

// ----- getter: listMillMachines ---------------------------------------------

describe("listMillMachines", () => {
  it("reads mill_machines and returns camelCase machines", async () => {
    const { client, fromCalls } = makeClient({
      mill_machines: { data: [machineRow, uncalibratedMachineRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { listMillMachines } = await import("@/lib/db/milling");
    const machines = await listMillMachines();

    expect(fromCalls).toContain("mill_machines");
    expect(machines).toHaveLength(2);
    expect(machines[0].name).toBe("Pinhalense huller");
    expect(machines[1].calibrationDue).toBeNull();
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      mill_machines: { data: null, error: { message: "machines boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { listMillMachines } = await import("@/lib/db/milling");
    await expect(listMillMachines()).rejects.toThrow(
      "listMillMachines: machines boom",
    );
  });
});
