import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GreenGradeRow, MillGradeRow } from "@/lib/db/millGrade";

/**
 * Coverage of the `millGrade.ts` READ-port (P3-S9 — finalize milling + green grade
 * + COGS flow): the pure mappers (snake_case view/table row → camelCase domain,
 * numeric coercion of the defect / screen-size columns PostgREST may serialize as
 * strings, NULL preservation for an undeclared screen size) and the
 * `cache()`-wrapped getters' fetch + map round-trip:
 *
 *   - `getGreenGrade(lot)`   reads `v_green_grade` filtered to one lot (the LATEST
 *                            grade per green lot, or null when ungraded).
 *   - `listGreenGrades()`    reads `v_green_grade` (every lot's latest grade — the
 *                            /mill finalize board's grade histogram source).
 *   - `listMillGrades(lot)`  reads the append-only `mill_grade` ledger for one lot,
 *                            newest first (the full re-grade history / provenance).
 *
 * Strategy mirrors `pricing.test.ts` / `cogs.test.ts`: mock `@/lib/supabase/server`
 * so `getSupabase()` returns a chainable, thenable query-builder. The SCA prep band
 * itself is a GENERATED column (the migration's PGlite test pins it, not this port);
 * this port only proves the row→domain seam + NULL handling survive `cache()` and
 * hit the right table/view.
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

// ----- sample rows ----------------------------------------------------------

const greenGradeRow: GreenGradeRow = {
  green_lot_code: "JC-701",
  cat1_defects: "0", // PostgREST may serialize an int as a string
  cat2_defects: "3",
  screen_size: "17",
  sca_prep: "EP-Specialty",
  graded_at: "2026-06-20T10:00:00Z",
};

const undeclaredScreenRow: GreenGradeRow = {
  green_lot_code: "JC-820",
  cat1_defects: 4,
  cat2_defects: 6,
  screen_size: null, // screen size not declared ⇒ preserved as null, never 0
  sca_prep: "Premium",
  graded_at: "2026-06-21T09:00:00Z",
};

const millGradeRow: MillGradeRow = {
  id: 5,
  green_lot_code: "JC-701",
  cat1_defects: 0,
  cat2_defects: 3,
  screen_size: 17,
  sca_prep: "EP-Specialty",
  graded_at: "2026-06-20T10:00:00Z",
  created_at: "2026-06-20T10:00:01Z",
};

// ----- pure mapper: mapGreenGrade -------------------------------------------

describe("mapGreenGrade", () => {
  it("maps a v_green_grade row to a camelCase grade with numeric coercion", async () => {
    const { mapGreenGrade } = await import("@/lib/db/millGrade");
    expect(mapGreenGrade(greenGradeRow)).toEqual({
      greenLotCode: "JC-701",
      cat1Defects: 0,
      cat2Defects: 3,
      screenSize: 17,
      scaPrep: "EP-Specialty",
      gradedAt: "2026-06-20T10:00:00Z",
    });
  });

  it("preserves a NULL screen size (never a fabricated 0)", async () => {
    const { mapGreenGrade } = await import("@/lib/db/millGrade");
    const g = mapGreenGrade(undeclaredScreenRow);
    expect(g.screenSize).toBeNull();
    expect(g.cat1Defects).toBe(4);
    expect(g.scaPrep).toBe("Premium");
  });
});

// ----- pure mapper: mapMillGrade --------------------------------------------

describe("mapMillGrade", () => {
  it("maps a mill_grade ledger row, carrying id + createdAt provenance", async () => {
    const { mapMillGrade } = await import("@/lib/db/millGrade");
    expect(mapMillGrade(millGradeRow)).toEqual({
      id: 5,
      greenLotCode: "JC-701",
      cat1Defects: 0,
      cat2Defects: 3,
      screenSize: 17,
      scaPrep: "EP-Specialty",
      gradedAt: "2026-06-20T10:00:00Z",
      createdAt: "2026-06-20T10:00:01Z",
    });
  });
});

// ----- getter: getGreenGrade -------------------------------------------------

describe("getGreenGrade", () => {
  it("reads v_green_grade for one lot and returns the latest grade", async () => {
    const { client, fromCalls } = makeClient({
      v_green_grade: { data: [greenGradeRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getGreenGrade } = await import("@/lib/db/millGrade");
    const grade = await getGreenGrade("JC-701");

    expect(fromCalls).toContain("v_green_grade");
    expect(grade).not.toBeNull();
    expect(grade?.greenLotCode).toBe("JC-701");
    expect(grade?.scaPrep).toBe("EP-Specialty");
  });

  it("returns null when the lot has no grade row yet", async () => {
    const { client } = makeClient({
      v_green_grade: { data: [], error: null },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getGreenGrade } = await import("@/lib/db/millGrade");
    expect(await getGreenGrade("JC-000")).toBeNull();
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      v_green_grade: { data: null, error: { message: "grade boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getGreenGrade } = await import("@/lib/db/millGrade");
    await expect(getGreenGrade("JC-701")).rejects.toThrow(
      "getGreenGrade: grade boom",
    );
  });
});

// ----- getter: listGreenGrades -----------------------------------------------

describe("listGreenGrades", () => {
  it("reads v_green_grade and returns every lot's latest grade", async () => {
    const { client, fromCalls } = makeClient({
      v_green_grade: { data: [greenGradeRow, undeclaredScreenRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { listGreenGrades } = await import("@/lib/db/millGrade");
    const grades = await listGreenGrades();

    expect(fromCalls).toContain("v_green_grade");
    expect(grades).toHaveLength(2);
    expect(grades[0].greenLotCode).toBe("JC-701");
    expect(grades[1].screenSize).toBeNull();
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      v_green_grade: { data: null, error: { message: "list boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { listGreenGrades } = await import("@/lib/db/millGrade");
    await expect(listGreenGrades()).rejects.toThrow(
      "listGreenGrades: list boom",
    );
  });
});

// ----- getter: listMillGrades ------------------------------------------------

describe("listMillGrades", () => {
  it("reads the mill_grade ledger for one lot (the append-only re-grade history)", async () => {
    const { client, fromCalls } = makeClient({
      mill_grade: { data: [millGradeRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { listMillGrades } = await import("@/lib/db/millGrade");
    const history = await listMillGrades("JC-701");

    expect(fromCalls).toContain("mill_grade");
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe(5);
    expect(history[0].createdAt).toBe("2026-06-20T10:00:01Z");
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      mill_grade: { data: null, error: { message: "history boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { listMillGrades } = await import("@/lib/db/millGrade");
    await expect(listMillGrades("JC-701")).rejects.toThrow(
      "listMillGrades: history boom",
    );
  });
});
