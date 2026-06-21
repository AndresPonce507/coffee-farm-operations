import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Coverage of the `gradable-lots.ts` read-port: `getGradableLots()` returns only
 * the source lot codes the GRADE form may offer — lots at stage='milled' that
 * have NOT already been graded into a green lot (i.e. are not yet the parent of a
 * 'process' edge leading to a green node). Offering an already-graded milled lot
 * would invite a second materialize call; the RPC is idempotent on the green code
 * but the UI must not even tempt a re-grade of a spent source.
 *
 * Mirrors `harvestable-lots.test.ts` / `getters.test.ts`: mock
 * `@/lib/supabase/server` so `getSupabase()` returns a chainable, thenable
 * query-builder. Two parameter-free queries are issued (milled lots + the green
 * lot_edges), and the "already graded" exclusion is derived in JS — so no raw
 * code text is ever interpolated into a PostgREST filter string.
 */

// ----- chainable Supabase query-builder stub --------------------------------

interface QueryResult<T> {
  data: T;
  error: { message: string } | null;
}

type Row = Record<string, unknown>;

/** A per-table builder whose terminal `.then` resolves to that table's result. */
function makeBuilder<T>(result: QueryResult<T>) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    then: (
      onFulfilled: (value: QueryResult<T>) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return builder;
}

const getSupabaseMock = vi.fn();
const builders: Record<string, ReturnType<typeof makeBuilder>> = {};

vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => getSupabaseMock(),
}));

/**
 * Stub the client so `.from('lots')` and `.from('lot_edges')` each return their
 * own recorded builder, resolving to the supplied rows.
 */
function stubTables(opts: {
  lots?: { data: Row[] | null; error?: { message: string } | null };
  edges?: { data: Row[] | null; error?: { message: string } | null };
}) {
  builders.lots = makeBuilder({
    data: opts.lots?.data ?? [],
    error: opts.lots?.error ?? null,
  });
  builders.lot_edges = makeBuilder({
    data: opts.edges?.data ?? [],
    error: opts.edges?.error ?? null,
  });
  getSupabaseMock.mockReturnValue({
    from: (table: string) => builders[table],
  });
}

beforeEach(() => {
  getSupabaseMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe("getGradableLots", () => {
  it("returns milled lots that have not yet been graded into a green lot", async () => {
    stubTables({
      lots: { data: [{ code: "JC-563" }, { code: "JC-564" }, { code: "JC-565" }] },
      // JC-564 already routed into a green node via a 'process' edge -> excluded.
      edges: {
        data: [
          { parent_code: "JC-564", child_code: "JC-564-G", kind: "process" },
        ],
      },
    });

    const { getGradableLots } = await import("@/lib/db/gradable-lots");
    const codes = await getGradableLots();

    expect(codes).toEqual(["JC-563", "JC-565"]);
  });

  it("narrows the lots query to stage='milled' and orders by code", async () => {
    stubTables({ lots: { data: [{ code: "JC-563" }] } });

    const { getGradableLots } = await import("@/lib/db/gradable-lots");
    await getGradableLots();

    // pulls only the `code` column from lots...
    expect(builders.lots.select).toHaveBeenCalledWith("code");
    // ...narrowed to milled-stage lots...
    expect(builders.lots.eq).toHaveBeenCalledWith("stage", "milled");
    // ...ordered by code for a stable dropdown.
    expect(builders.lots.order).toHaveBeenCalledWith("code");
  });

  it("only excludes via 'process' edges (a non-process edge does not consume a source)", async () => {
    stubTables({
      lots: { data: [{ code: "JC-563" }] },
      edges: {
        data: [
          { parent_code: "JC-563", child_code: "JC-999", kind: "blend" },
        ],
      },
    });

    const { getGradableLots } = await import("@/lib/db/gradable-lots");
    expect(await getGradableLots()).toEqual(["JC-563"]);
  });

  it("returns an empty list when no milled lot is gradable", async () => {
    stubTables({ lots: { data: [] } });
    const { getGradableLots } = await import("@/lib/db/gradable-lots");
    expect(await getGradableLots()).toEqual([]);
  });

  it("throws a labelled error when the lots query fails", async () => {
    stubTables({ lots: { data: null, error: { message: "boom" } } });
    const { getGradableLots } = await import("@/lib/db/gradable-lots");
    await expect(getGradableLots()).rejects.toThrow("getGradableLots: boom");
  });

  it("throws a labelled error when the edges query fails", async () => {
    stubTables({
      lots: { data: [{ code: "JC-563" }] },
      edges: { data: null, error: { message: "edge-boom" } },
    });
    const { getGradableLots } = await import("@/lib/db/gradable-lots");
    await expect(getGradableLots()).rejects.toThrow(
      "getGradableLots: edge-boom",
    );
  });
});
