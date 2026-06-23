import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 5 L2 dossier getter — `getPayPeriodById(id)` (facet-02 §7/§11).
 *
 * The /pay-period/[id] dossier's anchor: one pay-period summary by its id, the
 * existence gate before the per-worker lines + disbursements fan out. Reads the
 * SAME `v_pay_period_summary` view `getPayPeriods()` reads, narrowed to a single
 * id, and maps it via `mapPayPeriodSummary` (pinned in payroll.test.ts). Returns
 * null for an unknown id so the dossier calls notFound() (no fabricated period).
 *
 * Strategy mirrors getters.test.ts: a chainable, thenable builder whose terminal
 * `.maybeSingle()` resolves to the configured `{ data, error }`.
 */

interface QueryResult<T> {
  data: T;
  error: { message: string } | null;
}

function makeBuilder<T>(result: QueryResult<T>) {
  const calls = {
    from: undefined as string | undefined,
    eqArgs: [] as Array<[string, unknown]>,
  };
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((col: string, val: unknown) => {
      calls.eqArgs.push([col, val]);
      return builder;
    }),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (
      onFulfilled: (value: QueryResult<T>) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  const client = {
    from: (table: string) => {
      calls.from = table;
      return builder;
    },
  };
  return { client, calls };
}

const getSupabaseMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => getSupabaseMock(),
}));

beforeEach(() => getSupabaseMock.mockReset());
afterEach(() => vi.resetModules());

const row = {
  id: "pp-2026-06-w3",
  period_start: "2026-06-15",
  period_end: "2026-06-21",
  season: "2026",
  status: "calculated",
  calculated_at: "2026-06-21T18:00:00Z",
  worker_count: "12",
  total_gross_usd: "1840.50",
  total_net_usd: "1638.05",
  total_make_whole_usd: "42.00",
  made_whole_count: "3",
};

describe("getPayPeriodById", () => {
  it("reads v_pay_period_summary filtered by id and maps the row", async () => {
    const { client, calls } = makeBuilder({ data: row, error: null });
    getSupabaseMock.mockReturnValue(client);

    const { getPayPeriodById } = await import("@/lib/db/payroll");
    const period = await getPayPeriodById("pp-2026-06-w3");

    expect(calls.from).toBe("v_pay_period_summary");
    expect(calls.eqArgs).toContainEqual(["id", "pp-2026-06-w3"]);

    // The id handle matches what getPayPeriods() exposes (entityHref["pay-period"]).
    expect(period).toEqual({
      id: "pp-2026-06-w3",
      periodStart: "2026-06-15",
      periodEnd: "2026-06-21",
      season: "2026",
      status: "calculated",
      calculatedAt: "2026-06-21T18:00:00Z",
      workerCount: 12,
      totalGrossUsd: 1840.5,
      totalNetUsd: 1638.05,
      totalMakeWholeUsd: 42,
      madeWholeCount: 3,
    });
  });

  it("returns null for an unknown id (dossier → notFound, no fabricated period)", async () => {
    const { client } = makeBuilder({ data: null, error: null });
    getSupabaseMock.mockReturnValue(client);

    const { getPayPeriodById } = await import("@/lib/db/payroll");
    expect(await getPayPeriodById("pp-nope")).toBeNull();
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeBuilder({ data: null, error: { message: "boom" } });
    getSupabaseMock.mockReturnValue(client);

    const { getPayPeriodById } = await import("@/lib/db/payroll");
    await expect(getPayPeriodById("pp-1")).rejects.toThrow(
      "getPayPeriodById: boom",
    );
  });
});
