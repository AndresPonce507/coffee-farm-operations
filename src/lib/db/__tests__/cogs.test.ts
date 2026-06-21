import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CostEntryRow } from "@/lib/db/cogs";

/**
 * Coverage of the `cogs.ts` READ-port (S7 — activity-based COGS, the number the
 * business turns on): the pure `mapCostEntry` mapper (snake_case ledger row →
 * camelCase domain, numeric coercion of the signed amount PostgREST may serialize
 * as a string, null targetCode/reversesId/memo passthrough) and the getters'
 * fetch/rpc + map round-trip:
 *
 *   - `getLotCost(code)`     calls the `cogs_per_lot` RPC  → cost-per-kg-green for one
 *                            green lot (NULL on zero/undeclared green-kg — no /0).
 *   - `getPlotCost(id)`      calls the `cogs_per_plot` RPC → the plot's green lots'
 *                            Σcost / Σgreen-kg (NULL on zero green-kg).
 *   - `getCostBreakdown()`   reads the append-only `cost_entry` provenance ledger,
 *                            optionally scoped to a (targetKind, targetCode), so every
 *                            COGS figure links back to its journal rows.
 *
 * Strategy mirrors `events.test.ts` / `greenlots.test.ts`: mock
 * `@/lib/supabase/server` so `getSupabase()` returns a chainable, thenable
 * query-builder that ALSO stubs `.rpc(name, args)`. The COGS arithmetic itself is
 * the matview/RPC's job (pinned by the migration's PGlite tests, not re-implemented
 * here); this port only proves the row→domain seam + the scalar-verdict (incl. NULL)
 * survive the RPC/`cache()` round-trip and hit the right RPC/table.
 */

// ----- chainable, recording Supabase query-builder + rpc stub ---------------

interface QueryResult<T> {
  data: T;
  error: { message: string } | null;
}

/**
 * Records the calls a getter makes so assertions can inspect them, while
 * resolving every chain (and `.rpc`) to a configured `{ data, error }`.
 */
function makeClient<T>(result: QueryResult<T>) {
  const calls = {
    from: undefined as string | undefined,
    select: undefined as string | undefined,
    eqArgs: [] as Array<[string, unknown]>,
    orderArgs: [] as Array<[string, Record<string, unknown> | undefined]>,
    rpcName: undefined as string | undefined,
    rpcArgs: undefined as Record<string, unknown> | undefined,
  };

  const builder = {
    from: vi.fn((table: string) => {
      calls.from = table;
      return builder;
    }),
    select: vi.fn((cols: string) => {
      calls.select = cols;
      return builder;
    }),
    eq: vi.fn((col: string, val: unknown) => {
      calls.eqArgs.push([col, val]);
      return builder;
    }),
    order: vi.fn((col: string, opts?: Record<string, unknown>) => {
      calls.orderArgs.push([col, opts]);
      return builder;
    }),
    then: (
      onFulfilled: (value: QueryResult<T>) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };

  const client = {
    from: (table: string) => builder.from(table),
    rpc: vi.fn((name: string, args?: Record<string, unknown>) => {
      calls.rpcName = name;
      calls.rpcArgs = args;
      return Promise.resolve(result);
    }),
  };

  return { client, calls };
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

const entryRow: CostEntryRow = {
  id: 1,
  driver: "worker-day",
  allocation_rule: "direct-labor",
  target_kind: "lot",
  target_code: "JC-701",
  amount_usd: "42.50", // PostgREST may serialize numeric as a string
  reverses_id: null,
  memo: "Crew Norte picking day",
  occurred_at: "2026-06-20T10:00:00Z",
  created_at: "2026-06-20T10:00:01Z",
};

const reversalRow: CostEntryRow = {
  id: 2,
  driver: "worker-day",
  allocation_rule: "direct-labor",
  target_kind: "lot",
  target_code: "JC-701",
  amount_usd: "-42.50", // a reversal is a negative-amount row
  reverses_id: 1,
  memo: "miskeyed rate — reversing",
  occurred_at: "2026-06-20T11:00:00Z",
  created_at: "2026-06-20T11:00:01Z",
};

const farmOverheadRow: CostEntryRow = {
  id: 3,
  driver: "task",
  allocation_rule: "overhead",
  target_kind: "farm",
  target_code: null, // farm-wide overhead carries no target code
  amount_usd: "200",
  reverses_id: null,
  memo: null, // memo is optional
  occurred_at: "2026-06-19T08:00:00Z",
  created_at: "2026-06-19T08:00:01Z",
};

// ----- pure mapper: mapCostEntry --------------------------------------------

describe("mapCostEntry", () => {
  it("maps a snake_case cost_entry row to a camelCase CostEntry with numeric coercion of the amount", async () => {
    const { mapCostEntry } = await import("@/lib/db/cogs");
    expect(mapCostEntry(entryRow)).toEqual({
      id: 1,
      driver: "worker-day",
      allocationRule: "direct-labor",
      targetKind: "lot",
      targetCode: "JC-701",
      amountUsd: 42.5,
      reversesId: null,
      memo: "Crew Norte picking day",
      occurredAt: "2026-06-20T10:00:00Z",
      createdAt: "2026-06-20T10:00:01Z",
    });
  });

  it("preserves a reversing entry's negative amount and reversesId self-link", async () => {
    const { mapCostEntry } = await import("@/lib/db/cogs");
    const mapped = mapCostEntry(reversalRow);
    expect(mapped.amountUsd).toBe(-42.5);
    expect(mapped.reversesId).toBe(2 - 1); // reverses_id = 1, the original
    expect(mapped.reversesId).toBe(1);
  });

  it("passes a farm-overhead row's null targetCode and null memo through unchanged", async () => {
    const { mapCostEntry } = await import("@/lib/db/cogs");
    const mapped = mapCostEntry(farmOverheadRow);
    expect(mapped.targetKind).toBe("farm");
    expect(mapped.targetCode).toBeNull();
    expect(mapped.memo).toBeNull();
    expect(mapped.amountUsd).toBe(200);
  });
});

// ----- getter: getLotCost ---------------------------------------------------

describe("getLotCost", () => {
  it("calls the cogs_per_lot RPC with the lot code and returns its cost-per-kg-green", async () => {
    const { client, calls } = makeClient<number>({ data: 12.34, error: null });
    getSupabaseMock.mockReturnValue(client);

    const { getLotCost } = await import("@/lib/db/cogs");
    const cost = await getLotCost("JC-701");

    expect(calls.rpcName).toBe("cogs_per_lot");
    expect(calls.rpcArgs).toEqual({ p_lot_code: "JC-701" });
    expect(cost).toEqual({ code: "JC-701", costPerKgGreen: 12.34 });
  });

  it("coerces a string numeric verdict to a number", async () => {
    const { client } = makeClient<string>({ data: "9.5", error: null });
    getSupabaseMock.mockReturnValue(client);

    const { getLotCost } = await import("@/lib/db/cogs");
    expect((await getLotCost("JC-701")).costPerKgGreen).toBe(9.5);
  });

  it("returns null costPerKgGreen on zero/undeclared green-kg (the RPC returns NULL, never /0)", async () => {
    const { client } = makeClient<null>({ data: null, error: null });
    getSupabaseMock.mockReturnValue(client);

    const { getLotCost } = await import("@/lib/db/cogs");
    expect(await getLotCost("JC-999")).toEqual({
      code: "JC-999",
      costPerKgGreen: null,
    });
  });

  it("throws a labelled error when the RPC fails", async () => {
    const { client } = makeClient<null>({
      data: null,
      error: { message: "lot boom" },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getLotCost } = await import("@/lib/db/cogs");
    await expect(getLotCost("JC-701")).rejects.toThrow("getLotCost: lot boom");
  });
});

// ----- getter: getPlotCost --------------------------------------------------

describe("getPlotCost", () => {
  it("calls the cogs_per_plot RPC with the plot id and returns its cost-per-kg-green", async () => {
    const { client, calls } = makeClient<number>({ data: 7.89, error: null });
    getSupabaseMock.mockReturnValue(client);

    const { getPlotCost } = await import("@/lib/db/cogs");
    const cost = await getPlotCost("plot-A");

    expect(calls.rpcName).toBe("cogs_per_plot");
    expect(calls.rpcArgs).toEqual({ p_plot_id: "plot-A" });
    expect(cost).toEqual({ code: "plot-A", costPerKgGreen: 7.89 });
  });

  it("returns null costPerKgGreen when the plot has no green-kg yet", async () => {
    const { client } = makeClient<null>({ data: null, error: null });
    getSupabaseMock.mockReturnValue(client);

    const { getPlotCost } = await import("@/lib/db/cogs");
    expect(await getPlotCost("plot-Z")).toEqual({
      code: "plot-Z",
      costPerKgGreen: null,
    });
  });

  it("throws a labelled error when the RPC fails", async () => {
    const { client } = makeClient<null>({
      data: null,
      error: { message: "plot boom" },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getPlotCost } = await import("@/lib/db/cogs");
    await expect(getPlotCost("plot-A")).rejects.toThrow(
      "getPlotCost: plot boom",
    );
  });
});

// ----- getter: getCostBreakdown ---------------------------------------------

describe("getCostBreakdown", () => {
  it("reads the cost_entry ledger and returns camelCase CostEntry[] (the provenance behind every figure)", async () => {
    const { client, calls } = makeClient<CostEntryRow[]>({
      data: [entryRow, reversalRow, farmOverheadRow],
      error: null,
    });
    getSupabaseMock.mockReturnValue(client);

    const { getCostBreakdown } = await import("@/lib/db/cogs");
    const entries = await getCostBreakdown();

    expect(calls.from).toBe("cost_entry");
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({
      id: 1,
      driver: "worker-day",
      allocationRule: "direct-labor",
      targetKind: "lot",
      targetCode: "JC-701",
      amountUsd: 42.5,
      reversesId: null,
      memo: "Crew Norte picking day",
      occurredAt: "2026-06-20T10:00:00Z",
      createdAt: "2026-06-20T10:00:01Z",
    });
    // the reversal nets the original to zero — both rows are kept (append-only)
    expect(entries[0].amountUsd + entries[1].amountUsd).toBe(0);
  });

  it("scopes to a (targetKind, targetCode) when given — the provenance for one lot/plot", async () => {
    const { client, calls } = makeClient<CostEntryRow[]>({
      data: [entryRow, reversalRow],
      error: null,
    });
    getSupabaseMock.mockReturnValue(client);

    const { getCostBreakdown } = await import("@/lib/db/cogs");
    await getCostBreakdown({ targetKind: "lot", targetCode: "JC-701" });

    expect(calls.from).toBe("cost_entry");
    expect(calls.eqArgs).toEqual([
      ["target_kind", "lot"],
      ["target_code", "JC-701"],
    ]);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient<null>({
      data: null,
      error: { message: "ledger boom" },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getCostBreakdown } = await import("@/lib/db/cogs");
    await expect(getCostBreakdown()).rejects.toThrow(
      "getCostBreakdown: ledger boom",
    );
  });
});

// ----- getter: getGreenReachableLots (the COGS-safe lot targets) ------------

describe("getGreenReachableLots", () => {
  it("reads the green_reachable_lots view and returns just the codes", async () => {
    const { client, calls } = makeClient<Array<{ code: string }>>({
      data: [{ code: "JC-701" }, { code: "JC-710" }],
      error: null,
    });
    getSupabaseMock.mockReturnValue(client);

    const { getGreenReachableLots } = await import("@/lib/db/cogs");
    const codes = await getGreenReachableLots();

    expect(calls.from).toBe("green_reachable_lots");
    expect(codes).toEqual(["JC-701", "JC-710"]);
  });

  it("returns [] when no lot reaches a green terminal yet", async () => {
    const { client } = makeClient<Array<{ code: string }>>({
      data: [],
      error: null,
    });
    getSupabaseMock.mockReturnValue(client);

    const { getGreenReachableLots } = await import("@/lib/db/cogs");
    expect(await getGreenReachableLots()).toEqual([]);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient<null>({
      data: null,
      error: { message: "lots view boom" },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getGreenReachableLots } = await import("@/lib/db/cogs");
    await expect(getGreenReachableLots()).rejects.toThrow(
      "getGreenReachableLots: lots view boom",
    );
  });
});

// ----- getter: getGreenReachablePlots (the COGS-safe plot targets) ----------

describe("getGreenReachablePlots", () => {
  it("joins green_reachable_plots → plots and returns {id,name} for the label", async () => {
    const { client, calls } = makeClient<
      Array<{ id: string; plots: { name: string } | null }>
    >({
      data: [
        { id: "plot-A", plots: { name: "Tizingal Alto" } },
        { id: "plot-B", plots: { name: "Tizingal Bajo" } },
      ],
      error: null,
    });
    getSupabaseMock.mockReturnValue(client);

    const { getGreenReachablePlots } = await import("@/lib/db/cogs");
    const plots = await getGreenReachablePlots();

    expect(calls.from).toBe("green_reachable_plots");
    expect(plots).toEqual([
      { id: "plot-A", name: "Tizingal Alto" },
      { id: "plot-B", name: "Tizingal Bajo" },
    ]);
  });

  it("returns [] when no plot reaches a green terminal yet", async () => {
    const { client } = makeClient<
      Array<{ id: string; plots: { name: string } | null }>
    >({ data: [], error: null });
    getSupabaseMock.mockReturnValue(client);

    const { getGreenReachablePlots } = await import("@/lib/db/cogs");
    expect(await getGreenReachablePlots()).toEqual([]);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient<null>({
      data: null,
      error: { message: "plots view boom" },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getGreenReachablePlots } = await import("@/lib/db/cogs");
    await expect(getGreenReachablePlots()).rejects.toThrow(
      "getGreenReachablePlots: plots view boom",
    );
  });
});

// ----- getter: getCostBreakdownByRule (the fully-allocated build-up) ---------

describe("getCostBreakdownByRule", () => {
  it("calls cogs_breakdown_per_lot and maps rows to {rule, allocatedUsd} (numeric coercion)", async () => {
    const { client, calls } = makeClient<
      Array<{ allocation_rule: string; allocated_cost: number | string }>
    >({
      data: [
        { allocation_rule: "direct-labor", allocated_cost: "120" },
        { allocation_rule: "overhead", allocated_cost: 30 },
      ],
      error: null,
    });
    getSupabaseMock.mockReturnValue(client);

    const { getCostBreakdownByRule } = await import("@/lib/db/cogs");
    const rows = await getCostBreakdownByRule("JC-701");

    expect(calls.rpcName).toBe("cogs_breakdown_per_lot");
    expect(calls.rpcArgs).toEqual({ p_lot_code: "JC-701" });
    expect(rows).toEqual([
      { rule: "direct-labor", allocatedUsd: 120 },
      { rule: "overhead", allocatedUsd: 30 },
    ]);
  });

  it("returns [] for an uncosted/absent lot (RPC returns no rows)", async () => {
    const { client } = makeClient<null>({ data: null, error: null });
    getSupabaseMock.mockReturnValue(client);

    const { getCostBreakdownByRule } = await import("@/lib/db/cogs");
    expect(await getCostBreakdownByRule("JC-000")).toEqual([]);
  });

  it("throws a labelled error when the RPC fails", async () => {
    const { client } = makeClient<null>({
      data: null,
      error: { message: "breakdown boom" },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getCostBreakdownByRule } = await import("@/lib/db/cogs");
    await expect(getCostBreakdownByRule("JC-701")).rejects.toThrow(
      "getCostBreakdownByRule: breakdown boom",
    );
  });
});
