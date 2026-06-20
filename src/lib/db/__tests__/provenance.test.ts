import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Coverage for getSeasonProvenance() — the honest-provenance affordance (AD-4).
 *
 * The season headline figures are now computed from the harvests the owner
 * actually logs. A trustworthy "derived from N harvests · HH:MM" readout needs a
 * REAL row count + a REAL recency timestamp, or it is worse than nothing
 * (AD-4: "a real timestamp + row count … or it's worse than nothing").
 *
 * getSeasonProvenance() returns { derivedFromCount, asOf } sourced from
 *   - count: the number of harvest rows the metrics were derived from
 *   - asOf:  max(date) of the harvests (the most-recent picking the views see)
 *
 * Strategy mirrors getters.test.ts: mock `@/lib/supabase/server` so
 * getSupabase() resolves to a client whose .from() returns a chainable, thenable
 * query-builder resolving to the configured { data, error, count }.
 */

// ----- chainable Supabase query-builder stub --------------------------------

interface QueryResult<T> {
  data: T;
  error: { message: string } | null;
  count?: number | null;
}

/**
 * A builder whose chain methods all return `this`, and which is awaitable
 * (thenable) so `await getSupabase().from(...).select(...)...` resolves to the
 * configured result. The terminal `.single()/.maybeSingle()` resolve the same.
 * The stub records the exact `.select()` args so the test can assert the
 * count-head + max(date) query shape.
 */
function makeBuilder<T>(result: QueryResult<T>) {
  const builder = {
    from: vi.fn((..._args: unknown[]) => builder),
    select: vi.fn((..._args: unknown[]) => builder),
    order: vi.fn((..._args: unknown[]) => builder),
    limit: vi.fn((..._args: unknown[]) => builder),
    eq: vi.fn((..._args: unknown[]) => builder),
    single: vi.fn(() => Promise.resolve(result)),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (
      onFulfilled: (value: QueryResult<T>) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return builder;
}

const getSupabaseMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => getSupabaseMock(),
}));

/** Point the mocked client at a builder resolving to these rows / error / count. */
function stubQuery<T>(
  data: T,
  error: { message: string } | null = null,
  count: number | null = null,
) {
  const builder = makeBuilder({ data, error, count });
  getSupabaseMock.mockReturnValue({ from: () => builder });
  return builder;
}

beforeEach(() => {
  getSupabaseMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe("getSeasonProvenance", () => {
  it("returns the harvest row count and the most-recent harvest date", async () => {
    // Three harvest rows; the latest picking date is 2026-06-20.
    stubQuery([{ date: "2026-06-20" }], null, 3);

    const { getSeasonProvenance } = await import("@/lib/db/trends");
    const prov = await getSeasonProvenance();

    expect(prov).toEqual({ derivedFromCount: 3, asOf: "2026-06-20" });
  });

  it("reads the harvests base table with a count head and a descending date order", async () => {
    const fromMock = vi.fn();
    const builder = makeBuilder({ data: [{ date: "2026-06-18" }], error: null, count: 47 });
    getSupabaseMock.mockReturnValue({
      from: (table: string) => {
        fromMock(table);
        return builder;
      },
    });

    const { getSeasonProvenance } = await import("@/lib/db/trends");
    await getSeasonProvenance();

    // It must count harvests over the base table and pull the max date by
    // ordering descending + limit 1 — never a client-side re-derivation.
    expect(fromMock).toHaveBeenCalledWith("harvests");
    const selectArgs = builder.select.mock.calls.map((c) => c[0]);
    expect(selectArgs).toContain("date");
    // The count option object ({ count: "exact" }) is passed to the select.
    const passedCountOption = builder.select.mock.calls.some(
      (c) => c[1] && (c[1] as { count?: string }).count === "exact",
    );
    expect(passedCountOption).toBe(true);
    expect(builder.order).toHaveBeenCalledWith("date", { ascending: false });
    expect(builder.limit).toHaveBeenCalledWith(1);
  });

  it("reports zero with no asOf when there are no harvests yet", async () => {
    // Empty data => no max date; count 0.
    stubQuery([], null, 0);

    const { getSeasonProvenance } = await import("@/lib/db/trends");
    const prov = await getSeasonProvenance();

    expect(prov).toEqual({ derivedFromCount: 0, asOf: "" });
  });

  it("throws a labelled error when the query fails", async () => {
    stubQuery(null, { message: "boom" }, null);
    const { getSeasonProvenance } = await import("@/lib/db/trends");
    await expect(getSeasonProvenance()).rejects.toThrow(
      "getSeasonProvenance: boom",
    );
  });
});
