import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Coverage of the `harvestable-lots.ts` read-port: `getHarvestableLots()` returns
 * only the lot codes that can legitimately receive fresh cherry intake — lots that
 * are still at the cherry stage (or unstaged), never milled/green/processed lots.
 *
 * Mirrors `getters.test.ts`: mock `@/lib/supabase/server` so `getSupabase()` returns
 * a chainable, thenable query-builder. The builder records the `.select/.or/.order`
 * chain so the test can assert the port issues the right narrowing query, then maps
 * the returned rows to a flat `string[]` of codes.
 */

// ----- chainable Supabase query-builder stub --------------------------------

interface QueryResult<T> {
  data: T;
  error: { message: string } | null;
}

function makeBuilder<T>(result: QueryResult<T>) {
  const builder = {
    from: vi.fn(() => builder),
    select: vi.fn(() => builder),
    or: vi.fn(() => builder),
    order: vi.fn(() => builder),
    then: (
      onFulfilled: (value: QueryResult<T>) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return builder;
}

const getSupabaseMock = vi.fn();
let lastBuilder: ReturnType<typeof makeBuilder>;

vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => getSupabaseMock(),
}));

function stubQuery<T>(data: T, error: { message: string } | null = null) {
  lastBuilder = makeBuilder({ data, error });
  getSupabaseMock.mockReturnValue({ from: () => lastBuilder });
}

beforeEach(() => {
  getSupabaseMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe("getHarvestableLots", () => {
  it("returns the lot codes (flat string[]) returned by the query", async () => {
    stubQuery([{ code: "JC-563" }, { code: "JC-564" }, { code: "JC-565" }]);

    const { getHarvestableLots } = await import("@/lib/db/harvestable-lots");
    const codes = await getHarvestableLots();

    expect(codes).toEqual(["JC-563", "JC-564", "JC-565"]);
  });

  it("narrows to cherry-stage / unstaged lots and orders by code", async () => {
    stubQuery([{ code: "JC-564" }]);

    const { getHarvestableLots } = await import("@/lib/db/harvestable-lots");
    await getHarvestableLots();

    // pulls only the `code` column...
    expect(lastBuilder.select).toHaveBeenCalledWith("code");
    // ...narrowed to lots that can take cherry intake (null OR 'cherry' stage)...
    expect(lastBuilder.or).toHaveBeenCalledWith("stage.is.null,stage.eq.cherry");
    // ...ordered by code for a stable dropdown.
    expect(lastBuilder.order).toHaveBeenCalledWith("code");
  });

  it("returns an empty list when no lot can take intake", async () => {
    stubQuery([]);
    const { getHarvestableLots } = await import("@/lib/db/harvestable-lots");
    expect(await getHarvestableLots()).toEqual([]);
  });

  it("throws a labelled error when the query fails", async () => {
    stubQuery(null, { message: "boom" });
    const { getHarvestableLots } = await import("@/lib/db/harvestable-lots");
    await expect(getHarvestableLots()).rejects.toThrow(
      "getHarvestableLots: boom",
    );
  });
});
