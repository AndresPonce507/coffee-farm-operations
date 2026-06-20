import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GreenLotAtpRow, GreenLotRow } from "@/lib/db/greenlots";

/**
 * Coverage of the `greenlots.ts` READ-port (S5 — the money-shaped slice): the
 * pure mappers (snake_case row → camelCase domain, numeric coercion of mass /
 * score / atp columns PostgREST may serialize as strings) and the two
 * `cache()`-wrapped getters' fetch + map round-trip.
 *
 *   - `getGreenLots()`     reads the `green_lots` detail table.
 *   - `getGreenLotAtp()`   reads the DERIVED `green_lots_atp` view
 *                          (atp = current_kg − Σreserved − Σshipped).
 *
 * Strategy mirrors `lots.test.ts` / `getters.test.ts`: mock
 * `@/lib/supabase/server` so `getSupabase()` returns a chainable, thenable
 * query-builder. The per-table client records which table each query targets and
 * resolves it to that table's configured rows, pinning that each getter hits the
 * right table/view and maps correctly. The atp arithmetic itself is the view's
 * job (pinned by the migration's PGlite tests, not re-implemented here); this
 * port only proves the row→domain seam survives `cache()`.
 */

// ----- chainable, per-table Supabase query-builder stub ---------------------

interface QueryResult<T> {
  data: T;
  error: { message: string } | null;
}

type TableResults = Record<string, QueryResult<unknown>>;

/**
 * Build a client whose `.from(table)` returns a fresh chainable builder bound to
 * that table's configured result. Each builder's chain methods return `this` and
 * the builder is thenable, so `await client.from(t).select(...).order(...)`
 * resolves to `results[t]`.
 */
function makeClient(results: TableResults) {
  return {
    from: (table: string) => {
      const result = results[table] ?? { data: [], error: null };
      const builder: Record<string, unknown> = {
        select: vi.fn(() => builder),
        order: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        or: vi.fn(() => builder),
        in: vi.fn(() => builder),
        then: (
          onFulfilled: (value: QueryResult<unknown>) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) => Promise.resolve(result).then(onFulfilled, onRejected),
      };
      return builder;
    },
  };
}

const getSupabaseMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => getSupabaseMock(),
}));

/** Point the mocked client at per-table results. */
function stubTables(results: TableResults) {
  getSupabaseMock.mockReturnValue(makeClient(results));
}

beforeEach(() => {
  getSupabaseMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

// ----- sample rows ----------------------------------------------------------

const greenLotRow: GreenLotRow = {
  lot_code: "JC-701",
  cupping_score: "88.5", // PostgREST may serialize numeric as a string
  sca_grade: "Specialty", // GENERATED band, derived from the score
  location: "Warehouse A · Bin 3",
  graded_at: "2026-06-20T10:00:00Z",
};

const atpRow: GreenLotAtpRow = {
  green_lot_code: "JC-701",
  sca_grade: "Specialty",
  location: "Warehouse A · Bin 3",
  current_kg: "14.2",
  reserved_kg: "4",
  shipped_kg: "2.2",
  atp: "8", // 14.2 − 4 − 2.2, computed by the view
};

// ----- pure mapper: mapGreenLot ---------------------------------------------

describe("mapGreenLot", () => {
  it("maps a snake_case green_lots row to a camelCase GreenLot with numeric coercion of the cupping score", async () => {
    const { mapGreenLot } = await import("@/lib/db/greenlots");
    expect(mapGreenLot(greenLotRow)).toEqual({
      lotCode: "JC-701",
      cuppingScore: 88.5,
      scaGrade: "Specialty",
      location: "Warehouse A · Bin 3",
      gradedAt: "2026-06-20T10:00:00Z",
    });
  });
});

// ----- pure mapper: mapGreenLotAtp ------------------------------------------

describe("mapGreenLotAtp", () => {
  it("maps a snake_case green_lots_atp view row to a camelCase GreenLotAtp, coercing every mass/atp string to a number", async () => {
    const { mapGreenLotAtp } = await import("@/lib/db/greenlots");
    expect(mapGreenLotAtp(atpRow)).toEqual({
      greenLotCode: "JC-701",
      scaGrade: "Specialty",
      location: "Warehouse A · Bin 3",
      currentKg: 14.2,
      reservedKg: 4,
      shippedKg: 2.2,
      atp: 8,
    });
  });

  it("coerces null reserved/shipped sums to 0 (a freshly materialized lot with no commitments yet)", async () => {
    const { mapGreenLotAtp } = await import("@/lib/db/greenlots");
    const atp = mapGreenLotAtp({
      ...atpRow,
      reserved_kg: null,
      shipped_kg: null,
      atp: "14.2",
    });
    expect(atp.reservedKg).toBe(0);
    expect(atp.shippedKg).toBe(0);
    expect(atp.atp).toBe(14.2);
  });
});

// ----- getter: getGreenLots --------------------------------------------------

describe("getGreenLots", () => {
  it("reads the green_lots table and returns camelCase GreenLot[]", async () => {
    stubTables({ green_lots: { data: [greenLotRow], error: null } });

    const { getGreenLots } = await import("@/lib/db/greenlots");
    const lots = await getGreenLots();

    expect(lots).toEqual([
      {
        lotCode: "JC-701",
        cuppingScore: 88.5,
        scaGrade: "Specialty",
        location: "Warehouse A · Bin 3",
        gradedAt: "2026-06-20T10:00:00Z",
      },
    ]);
  });

  it("throws a labelled error when the query fails", async () => {
    stubTables({ green_lots: { data: null, error: { message: "boom" } } });
    const { getGreenLots } = await import("@/lib/db/greenlots");
    await expect(getGreenLots()).rejects.toThrow("getGreenLots: boom");
  });
});

// ----- getter: getGreenLotAtp ------------------------------------------------

describe("getGreenLotAtp", () => {
  it("reads the green_lots_atp view and returns camelCase GreenLotAtp[]", async () => {
    stubTables({ green_lots_atp: { data: [atpRow], error: null } });

    const { getGreenLotAtp } = await import("@/lib/db/greenlots");
    const atp = await getGreenLotAtp();

    expect(atp).toEqual([
      {
        greenLotCode: "JC-701",
        scaGrade: "Specialty",
        location: "Warehouse A · Bin 3",
        currentKg: 14.2,
        reservedKg: 4,
        shippedKg: 2.2,
        atp: 8,
      },
    ]);
  });

  it("throws a labelled error when the query fails", async () => {
    stubTables({ green_lots_atp: { data: null, error: { message: "atp boom" } } });
    const { getGreenLotAtp } = await import("@/lib/db/greenlots");
    await expect(getGreenLotAtp()).rejects.toThrow("getGreenLotAtp: atp boom");
  });
});
