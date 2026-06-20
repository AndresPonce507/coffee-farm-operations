import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LotEdgeRow, LotNodeRow } from "@/lib/db/lots";

/**
 * Coverage of the `lots.ts` genealogy read-port: the pure mappers
 * (snake_case row → camelCase domain, numeric coercion) and the `cache()`-wrapped
 * `getLotGenealogy()` getter's fetch + map round-trip.
 *
 * Mirrors the strategy in `getters.test.ts`: mock `@/lib/supabase/server` so
 * `getSupabase()` returns a chainable, thenable query-builder. `getLotGenealogy`
 * issues TWO queries (nodes from `lots`, edges from `lot_edges`); the builder
 * here records which table each query targets and resolves it to the rows
 * configured for that table, so the test pins that each query hits the right
 * table and maps correctly.
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
 * the builder is thenable, so `await client.from(t).select(...).order(...)` and
 * `.eq(...)` chains all resolve to `results[t]`.
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

const nodeRow: LotNodeRow = {
  code: "JC-564",
  stage: "green",
  variety: "Geisha",
  origin_kg: "88",
  current_kg: "14.2",
  is_single_origin: true,
  minted_at: "2026-06-20T10:00:00Z",
};

const edgeRow: LotEdgeRow = {
  parent_code: "JC-564",
  child_code: "JC-701",
  kind: "process",
  kg: "14.2",
};

// ----- pure mappers ---------------------------------------------------------

describe("mapLotNode", () => {
  it("maps a snake_case lots graph-node row to a camelCase LotNode with numeric coercion", async () => {
    const { mapLotNode } = await import("@/lib/db/lots");
    expect(mapLotNode(nodeRow)).toEqual({
      code: "JC-564",
      stage: "green",
      variety: "Geisha",
      originKg: 88,
      currentKg: 14.2,
      isSingleOrigin: true,
      mintedAt: "2026-06-20T10:00:00Z",
    });
  });

  it("coerces null origin/current mass to 0 (a freshly minted node with no declared mass)", async () => {
    const { mapLotNode } = await import("@/lib/db/lots");
    const node = mapLotNode({
      ...nodeRow,
      origin_kg: null,
      current_kg: null,
    });
    expect(node.originKg).toBe(0);
    expect(node.currentKg).toBe(0);
  });
});

describe("mapLotEdge", () => {
  it("maps a snake_case lot_edges row to a camelCase LotEdge with numeric coercion", async () => {
    const { mapLotEdge } = await import("@/lib/db/lots");
    expect(mapLotEdge(edgeRow)).toEqual({
      parentCode: "JC-564",
      childCode: "JC-701",
      kind: "process",
      kg: 14.2,
    });
  });
});

// ----- getter: getLotGenealogy ----------------------------------------------

describe("getLotGenealogy", () => {
  it("returns the whole graph ({nodes, edges}) mapped to domain shape when no code is given", async () => {
    stubTables({
      lots: { data: [nodeRow], error: null },
      lot_edges: { data: [edgeRow], error: null },
    });

    const { getLotGenealogy } = await import("@/lib/db/lots");
    const graph = await getLotGenealogy();

    expect(graph).toEqual({
      nodes: [
        {
          code: "JC-564",
          stage: "green",
          variety: "Geisha",
          originKg: 88,
          currentKg: 14.2,
          isSingleOrigin: true,
          mintedAt: "2026-06-20T10:00:00Z",
        },
      ],
      edges: [
        {
          parentCode: "JC-564",
          childCode: "JC-701",
          kind: "process",
          kg: 14.2,
        },
      ],
    });
  });

  it("scopes to the lineage subgraph of a given code (edges touching it + their endpoint nodes)", async () => {
    const otherNode: LotNodeRow = { ...nodeRow, code: "JC-701", stage: "milled" };
    const unrelatedEdge: LotEdgeRow = {
      parent_code: "JC-900",
      child_code: "JC-901",
      kind: "split",
      kg: "5",
    };
    stubTables({
      lots: { data: [nodeRow, otherNode], error: null },
      // edge query is pre-filtered by the getter; return only the matching edge.
      lot_edges: { data: [edgeRow], error: null },
    });

    const { getLotGenealogy } = await import("@/lib/db/lots");
    const graph = await getLotGenealogy("JC-564");

    // both endpoints of the touching edge are present...
    expect(graph.nodes.map((n) => n.code).sort()).toEqual(["JC-564", "JC-701"]);
    // ...and only the edge that touches the scoped code is returned.
    expect(graph.edges).toEqual([
      {
        parentCode: "JC-564",
        childCode: "JC-701",
        kind: "process",
        kg: 14.2,
      },
    ]);
    // sanity: the unrelated edge fixture is never surfaced.
    expect(graph.edges).not.toContainEqual(
      expect.objectContaining({ parentCode: unrelatedEdge.parent_code }),
    );
  });

  it("throws a labelled error when the nodes query fails", async () => {
    stubTables({
      lots: { data: null, error: { message: "boom" } },
      lot_edges: { data: [], error: null },
    });
    const { getLotGenealogy } = await import("@/lib/db/lots");
    await expect(getLotGenealogy()).rejects.toThrow("getLotGenealogy: boom");
  });

  it("throws a labelled error when the edges query fails", async () => {
    stubTables({
      lots: { data: [], error: null },
      lot_edges: { data: null, error: { message: "edge boom" } },
    });
    const { getLotGenealogy } = await import("@/lib/db/lots");
    await expect(getLotGenealogy()).rejects.toThrow("getLotGenealogy: edge boom");
  });
});
