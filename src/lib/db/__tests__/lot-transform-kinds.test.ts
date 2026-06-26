import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LotYieldCurveRow } from "@/lib/db/lot-transform-kinds";

/**
 * Coverage of the `lot-transform-kinds.ts` read/domain port (P3-S6 — the
 * dry-milling/roasting lot-graph prereq). S6 introduces NO new table, view, or RPC
 * — it widens the `lot_edges.kind` CHECK to admit the three transform edge-kinds
 * ('mill'/'roast'/'byproduct'), extends/adds the milling+roasting domain enums, and
 * seeds real parchment→green / green→roasted factors into the existing
 * `lot_yield_curve` reference table. So this port has NO command twin (there is no
 * SECURITY DEFINER RPC to wrap); it is the typed VOCABULARY + the one read surface
 * the downstream S7..S10 ports and their forms/UI declare against.
 *
 * The constants here are bound VERBATIM to the on-disk migration
 * (`20260705090000_lot_edges_mill_roast_kinds.sql`) — the same exact label sets the
 * slice's PGlite test (`src/test/db/s6_mill_roast_kinds.db.test.ts`) pins against
 * `pg_enum`. These TS assertions are the second guard: if the DB enum and the TS
 * vocabulary ever drift, this suite goes RED before a downstream form binds to a
 * label Postgres will reject.
 *
 * Read-getter strategy mirrors `pricing.test.ts` / `gradable-lots.test.ts`: mock
 * `@/lib/supabase/server` so `getSupabase()` returns a chainable, thenable
 * query-builder, and prove the snake_case row → camelCase domain seam + numeric
 * coercion (PostgREST may serialize `numeric` as a string) survive `cache()` and
 * hit the right reference table.
 */

// ----- chainable, per-table Supabase query-builder stub ---------------------

interface QueryResult<T> {
  data: T;
  error: { message: string } | null;
}

type TableResults = Record<string, QueryResult<unknown>>;

/**
 * Build a client whose `.from(table)` returns a fresh chainable builder bound to
 * that table's configured result. Each chain method returns the builder and the
 * builder is thenable, so `await client.from(t).select(...).order(...)` resolves to
 * `results[t]`. The `from` calls are recorded so a getter can be pinned to the
 * right reference table.
 */
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

const parchmentToGreen: LotYieldCurveRow = {
  from_stage: "parchment",
  to_stage: "green",
  yield_factor: "0.80", // PostgREST may serialize numeric as a string
};

const greenToRoasted: LotYieldCurveRow = {
  from_stage: "green",
  to_stage: "roasted",
  yield_factor: "0.84", // ~16% roast shrinkage (specialty band)
};

// ────────────────────────────────────────────────────────────────────────────
// (1) lot_edges.kind vocabulary — the widened CHECK
// ────────────────────────────────────────────────────────────────────────────

describe("lot-edge kind vocabulary (mirrors the widened lot_edges_kind_check)", () => {
  it("LOT_EDGE_KINDS is exactly the post-S6 CHECK set, in CHECK order", async () => {
    const { LOT_EDGE_KINDS } = await import("@/lib/db/lot-transform-kinds");
    // Verbatim from `add constraint lot_edges_kind_check check (kind in (...))`.
    expect([...LOT_EDGE_KINDS]).toEqual([
      "split",
      "merge",
      "blend",
      "process",
      "mill",
      "roast",
      "byproduct",
    ]);
  });

  it("TRANSFORM_EDGE_KINDS is exactly the three kinds S6 adds", async () => {
    const { TRANSFORM_EDGE_KINDS } = await import("@/lib/db/lot-transform-kinds");
    expect([...TRANSFORM_EDGE_KINDS]).toEqual(["mill", "roast", "byproduct"]);
  });

  it("every transform kind is also a valid lot-edge kind (the superset relation)", async () => {
    const { LOT_EDGE_KINDS, TRANSFORM_EDGE_KINDS } = await import(
      "@/lib/db/lot-transform-kinds"
    );
    for (const k of TRANSFORM_EDGE_KINDS) {
      expect(LOT_EDGE_KINDS).toContain(k);
    }
  });

  it("isLotEdgeKind / isTransformEdgeKind accept members and reject unknowns", async () => {
    const { isLotEdgeKind, isTransformEdgeKind } = await import(
      "@/lib/db/lot-transform-kinds"
    );
    expect(isLotEdgeKind("mill")).toBe(true);
    expect(isLotEdgeKind("process")).toBe(true);
    expect(isLotEdgeKind("teleport")).toBe(false);

    expect(isTransformEdgeKind("roast")).toBe(true);
    expect(isTransformEdgeKind("byproduct")).toBe(true);
    // 'process' is a lot-edge kind but NOT a transform kind.
    expect(isTransformEdgeKind("process")).toBe(false);
    expect(isTransformEdgeKind("teleport")).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// (2) Domain enums — bound VERBATIM to the on-disk enum label sets
// ────────────────────────────────────────────────────────────────────────────

describe("milling/roasting domain enums (bound verbatim to the S6 pg_enum labels)", () => {
  it("PASS_TYPES matches the pass_type enum exactly", async () => {
    const { PASS_TYPES } = await import("@/lib/db/lot-transform-kinds");
    expect([...PASS_TYPES]).toEqual([
      "huller",
      "polisher",
      "screen_grader",
      "gravity_table",
      "optical_sorter",
    ]);
  });

  it("ROAST_LEVELS matches the roast_level enum exactly", async () => {
    const { ROAST_LEVELS } = await import("@/lib/db/lot-transform-kinds");
    expect([...ROAST_LEVELS]).toEqual([
      "light",
      "medium-light",
      "medium",
      "medium-dark",
      "dark",
    ]);
  });

  it("ROASTER_TYPES matches the roaster_type enum exactly", async () => {
    const { ROASTER_TYPES } = await import("@/lib/db/lot-transform-kinds");
    expect([...ROASTER_TYPES]).toEqual(["drum", "fluid_bed", "sample"]);
  });

  it("ROAST_PROFILE_STATUSES matches the roast_profile_status enum exactly", async () => {
    const { ROAST_PROFILE_STATUSES } = await import(
      "@/lib/db/lot-transform-kinds"
    );
    expect([...ROAST_PROFILE_STATUSES]).toEqual([
      "draft",
      "approved",
      "retired",
    ]);
  });

  it("BYPRODUCT_KINDS matches the byproduct_kind enum exactly", async () => {
    const { BYPRODUCT_KINDS } = await import("@/lib/db/lot-transform-kinds");
    expect([...BYPRODUCT_KINDS]).toEqual([
      "husk",
      "chaff",
      "screen_rejects",
      "defects",
    ]);
  });

  it("the enum guards accept members and reject unknowns", async () => {
    const {
      isPassType,
      isRoastLevel,
      isRoasterType,
      isRoastProfileStatus,
      isByproductKind,
    } = await import("@/lib/db/lot-transform-kinds");

    expect(isPassType("optical_sorter")).toBe(true);
    expect(isPassType("magic_sorter")).toBe(false);

    expect(isRoastLevel("medium-dark")).toBe(true);
    expect(isRoastLevel("charcoal")).toBe(false);

    expect(isRoasterType("fluid_bed")).toBe(true);
    expect(isRoasterType("microwave")).toBe(false);

    expect(isRoastProfileStatus("approved")).toBe(true);
    // 'golden' is the spec-prose label; the on-disk enum is draft/approved/retired.
    expect(isRoastProfileStatus("golden")).toBe(false);

    expect(isByproductKind("screen_rejects")).toBe(true);
    // 'cascara'/'pasilla' are spec prose; the on-disk enum rejects them.
    expect(isByproductKind("cascara")).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// (3) pure mapper: mapYieldFactor
// ────────────────────────────────────────────────────────────────────────────

describe("mapYieldFactor", () => {
  it("maps a lot_yield_curve row to camelCase, coercing the numeric string", async () => {
    const { mapYieldFactor } = await import("@/lib/db/lot-transform-kinds");
    expect(mapYieldFactor(parchmentToGreen)).toEqual({
      fromStage: "parchment",
      toStage: "green",
      yieldFactor: 0.8,
    });
  });

  it("coerces an already-numeric yield_factor unchanged", async () => {
    const { mapYieldFactor } = await import("@/lib/db/lot-transform-kinds");
    const e = mapYieldFactor({
      from_stage: "green",
      to_stage: "roasted",
      yield_factor: 0.84,
    });
    expect(e.yieldFactor).toBeCloseTo(0.84, 6);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// (4) getter: getLotYieldCurve
// ────────────────────────────────────────────────────────────────────────────

describe("getLotYieldCurve", () => {
  it("reads lot_yield_curve and returns camelCase factors", async () => {
    const { client, fromCalls } = makeClient({
      lot_yield_curve: {
        data: [parchmentToGreen, greenToRoasted],
        error: null,
      },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getLotYieldCurve } = await import("@/lib/db/lot-transform-kinds");
    const rows = await getLotYieldCurve();

    expect(fromCalls).toContain("lot_yield_curve");
    expect(rows).toEqual([
      { fromStage: "parchment", toStage: "green", yieldFactor: 0.8 },
      { fromStage: "green", toStage: "roasted", yieldFactor: 0.84 },
    ]);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      lot_yield_curve: { data: null, error: { message: "curve boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getLotYieldCurve } = await import("@/lib/db/lot-transform-kinds");
    await expect(getLotYieldCurve()).rejects.toThrow(
      "getLotYieldCurve: curve boom",
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// (5) getter: getYieldFactor (the derived single-lookup)
// ────────────────────────────────────────────────────────────────────────────

describe("getYieldFactor", () => {
  it("returns the dry-mill outturn factor for parchment → green", async () => {
    const { client } = makeClient({
      lot_yield_curve: {
        data: [parchmentToGreen, greenToRoasted],
        error: null,
      },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getYieldFactor } = await import("@/lib/db/lot-transform-kinds");
    expect(await getYieldFactor("parchment", "green")).toBeCloseTo(0.8, 6);
  });

  it("returns the roast-shrinkage factor for green → roasted", async () => {
    const { client } = makeClient({
      lot_yield_curve: {
        data: [parchmentToGreen, greenToRoasted],
        error: null,
      },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getYieldFactor } = await import("@/lib/db/lot-transform-kinds");
    expect(await getYieldFactor("green", "roasted")).toBeCloseTo(0.84, 6);
  });

  it("returns null (never a fabricated number) when the stage pair has no row", async () => {
    const { client } = makeClient({
      lot_yield_curve: {
        data: [parchmentToGreen, greenToRoasted],
        error: null,
      },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getYieldFactor } = await import("@/lib/db/lot-transform-kinds");
    expect(await getYieldFactor("green", "cherry")).toBeNull();
  });

  it("propagates a labelled read error from the underlying curve read", async () => {
    const { client } = makeClient({
      lot_yield_curve: { data: null, error: { message: "curve boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getYieldFactor } = await import("@/lib/db/lot-transform-kinds");
    await expect(getYieldFactor("parchment", "green")).rejects.toThrow(
      "getLotYieldCurve: curve boom",
    );
  });
});
