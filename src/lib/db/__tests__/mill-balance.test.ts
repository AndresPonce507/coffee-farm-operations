import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  MillByproductRow,
  MillOutturnByVarietyRow,
  MillPassRow,
  MillRunBalanceRow,
} from "@/lib/db/mill-balance";

/**
 * Coverage of the `mill-balance.ts` READ-port (P3-S8 — the machine-pass chain +
 * byproducts + THE closed mass balance): the pure mappers (snake_case view/table
 * row → camelCase domain, numeric coercion of kg columns PostgREST may serialize
 * as strings, NULL preservation for an unfinalized green-out / no-pass outturn)
 * and the `cache()`-wrapped getters' fetch + map round-trip:
 *
 *   - getMillPasses(runId)     reads `mill_passes`            (the ordered machine-chain rail).
 *   - getMillByproducts(runId) reads `mill_byproducts`        (the sellable byproduct nodes).
 *   - getMillRunBalance(runId) reads `mill_run_balance`       (the Sankey gauge readout, one run; null when absent).
 *   - listMillRunBalances()    reads `mill_run_balance`       (every run's balance).
 *   - getOutturnByVariety()    reads `mill_outturn_by_variety` (the /mill KPI rollup).
 *
 * Strategy mirrors `pricing.test.ts`: mock `@/lib/supabase/server` so
 * `getSupabase()` returns a chainable, thenable query-builder. The mass-balance
 * math itself is the view's job (pinned by the migration's PGlite tests, not
 * re-implemented here); this port only proves the row→domain seam + NULL handling
 * survive `cache()` and hit the right table/view.
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

const passRow: MillPassRow = {
  id: 1,
  run_id: 7,
  pass_no: 1,
  machine_kind: "huller",
  input_kg: "1000", // PostgREST may serialize numeric as a string
  output_kg: "900",
  reject_kg: "20",
  recorded_at: "2026-06-20T10:00:00Z",
  created_at: "2026-06-20T10:00:01Z",
};

const byproductRow: MillByproductRow = {
  id: 3,
  run_id: 7,
  byproduct_lot_code: "JC-742",
  kind: "husk",
  kg: "50",
  recorded_at: "2026-06-20T10:05:00Z",
  created_at: "2026-06-20T10:05:01Z",
};

const balanceRow: MillRunBalanceRow = {
  run_id: 7,
  parchment_lot_code: "JC-410",
  parchment_in: "1000",
  sum_pass_output: "820",
  sum_reject: "20",
  sum_byproduct: "50",
  green_out: "820",
  accounted_moisture_loss: "5",
  unaccounted_loss: "105",
  loss_ceiling: "200",
  balance_ok: true,
};

// An unfinalized run with no passes yet: green_out is NULL, balance_ok is false.
const pendingBalanceRow: MillRunBalanceRow = {
  ...balanceRow,
  run_id: 8,
  green_out: null,
  sum_pass_output: "0",
  balance_ok: false,
};

const outturnRow: MillOutturnByVarietyRow = {
  variety: "Geisha",
  parchment_kg_in: "1000",
  green_kg_out: "820",
  outturn_pct: "0.82",
};

// ----- pure mapper: mapMillPass ---------------------------------------------

describe("mapMillPass", () => {
  it("maps a mill_passes row to a camelCase pass with numeric coercion", async () => {
    const { mapMillPass } = await import("@/lib/db/mill-balance");
    expect(mapMillPass(passRow)).toEqual({
      id: 1,
      runId: 7,
      passNo: 1,
      machineKind: "huller",
      inputKg: 1000,
      outputKg: 900,
      rejectKg: 20,
      recordedAt: "2026-06-20T10:00:00Z",
      createdAt: "2026-06-20T10:00:01Z",
    });
  });
});

// ----- pure mapper: mapMillByproduct ----------------------------------------

describe("mapMillByproduct", () => {
  it("maps a mill_byproducts row, coercing kg and carrying the minted node code", async () => {
    const { mapMillByproduct } = await import("@/lib/db/mill-balance");
    expect(mapMillByproduct(byproductRow)).toEqual({
      id: 3,
      runId: 7,
      byproductLotCode: "JC-742",
      kind: "husk",
      kg: 50,
      recordedAt: "2026-06-20T10:05:00Z",
      createdAt: "2026-06-20T10:05:01Z",
    });
  });
});

// ----- pure mapper: mapMillRunBalance ---------------------------------------

describe("mapMillRunBalance", () => {
  it("maps a mill_run_balance row with numeric coercion and the boolean balance flag", async () => {
    const { mapMillRunBalance } = await import("@/lib/db/mill-balance");
    expect(mapMillRunBalance(balanceRow)).toEqual({
      runId: 7,
      parchmentLotCode: "JC-410",
      parchmentIn: 1000,
      sumPassOutput: 820,
      sumReject: 20,
      sumByproduct: 50,
      greenOut: 820,
      accountedMoistureLoss: 5,
      unaccountedLoss: 105,
      lossCeiling: 200,
      balanceOk: true,
    });
  });

  it("preserves a NULL green_out (unfinalized run) and a false balance flag", async () => {
    const { mapMillRunBalance } = await import("@/lib/db/mill-balance");
    const b = mapMillRunBalance(pendingBalanceRow);
    expect(b.greenOut).toBeNull();
    expect(b.balanceOk).toBe(false);
  });
});

// ----- pure mapper: mapMillOutturnByVariety ---------------------------------

describe("mapMillOutturnByVariety", () => {
  it("maps a mill_outturn_by_variety row, coercing the outturn fraction", async () => {
    const { mapMillOutturnByVariety } = await import("@/lib/db/mill-balance");
    expect(mapMillOutturnByVariety(outturnRow)).toEqual({
      variety: "Geisha",
      parchmentKgIn: 1000,
      greenKgOut: 820,
      outturnPct: 0.82,
    });
  });

  it("preserves NULL green/outturn (a run with no recorded green out)", async () => {
    const { mapMillOutturnByVariety } = await import("@/lib/db/mill-balance");
    const o = mapMillOutturnByVariety({
      ...outturnRow,
      green_kg_out: null,
      outturn_pct: null,
    });
    expect(o.greenKgOut).toBeNull();
    expect(o.outturnPct).toBeNull();
  });
});

// ----- getter: getMillPasses -------------------------------------------------

describe("getMillPasses", () => {
  it("reads mill_passes for a run and returns ordered camelCase passes", async () => {
    const { client, fromCalls } = makeClient({
      mill_passes: { data: [passRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getMillPasses } = await import("@/lib/db/mill-balance");
    const passes = await getMillPasses(7);

    expect(fromCalls).toContain("mill_passes");
    expect(passes).toHaveLength(1);
    expect(passes[0].machineKind).toBe("huller");
    expect(passes[0].inputKg).toBe(1000);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      mill_passes: { data: null, error: { message: "pass boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getMillPasses } = await import("@/lib/db/mill-balance");
    await expect(getMillPasses(7)).rejects.toThrow("getMillPasses: pass boom");
  });
});

// ----- getter: getMillByproducts ---------------------------------------------

describe("getMillByproducts", () => {
  it("reads mill_byproducts for a run and returns camelCase rows", async () => {
    const { client, fromCalls } = makeClient({
      mill_byproducts: { data: [byproductRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getMillByproducts } = await import("@/lib/db/mill-balance");
    const rows = await getMillByproducts(7);

    expect(fromCalls).toContain("mill_byproducts");
    expect(rows[0].byproductLotCode).toBe("JC-742");
    expect(rows[0].kg).toBe(50);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      mill_byproducts: { data: null, error: { message: "byp boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getMillByproducts } = await import("@/lib/db/mill-balance");
    await expect(getMillByproducts(7)).rejects.toThrow(
      "getMillByproducts: byp boom",
    );
  });
});

// ----- getter: getMillRunBalance ---------------------------------------------

describe("getMillRunBalance", () => {
  it("reads mill_run_balance for one run and returns the single balance", async () => {
    const { client, fromCalls } = makeClient({
      mill_run_balance: { data: [balanceRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getMillRunBalance } = await import("@/lib/db/mill-balance");
    const b = await getMillRunBalance(7);

    expect(fromCalls).toContain("mill_run_balance");
    expect(b).not.toBeNull();
    expect(b?.balanceOk).toBe(true);
    expect(b?.unaccountedLoss).toBe(105);
  });

  it("returns null when the run has no balance row", async () => {
    const { client } = makeClient({
      mill_run_balance: { data: [], error: null },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getMillRunBalance } = await import("@/lib/db/mill-balance");
    expect(await getMillRunBalance(999)).toBeNull();
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      mill_run_balance: { data: null, error: { message: "bal boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getMillRunBalance } = await import("@/lib/db/mill-balance");
    await expect(getMillRunBalance(7)).rejects.toThrow(
      "getMillRunBalance: bal boom",
    );
  });
});

// ----- getter: listMillRunBalances -------------------------------------------

describe("listMillRunBalances", () => {
  it("reads mill_run_balance and returns every run's camelCase balance", async () => {
    const { client, fromCalls } = makeClient({
      mill_run_balance: {
        data: [balanceRow, pendingBalanceRow],
        error: null,
      },
    });
    getSupabaseMock.mockReturnValue(client);

    const { listMillRunBalances } = await import("@/lib/db/mill-balance");
    const rows = await listMillRunBalances();

    expect(fromCalls).toContain("mill_run_balance");
    expect(rows).toHaveLength(2);
    expect(rows[1].greenOut).toBeNull();
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      mill_run_balance: { data: null, error: { message: "list boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { listMillRunBalances } = await import("@/lib/db/mill-balance");
    await expect(listMillRunBalances()).rejects.toThrow(
      "listMillRunBalances: list boom",
    );
  });
});

// ----- getter: getOutturnByVariety -------------------------------------------

describe("getOutturnByVariety", () => {
  it("reads mill_outturn_by_variety and returns camelCase rollups", async () => {
    const { client, fromCalls } = makeClient({
      mill_outturn_by_variety: { data: [outturnRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getOutturnByVariety } = await import("@/lib/db/mill-balance");
    const rows = await getOutturnByVariety();

    expect(fromCalls).toContain("mill_outturn_by_variety");
    expect(rows[0].variety).toBe("Geisha");
    expect(rows[0].outturnPct).toBe(0.82);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      mill_outturn_by_variety: { data: null, error: { message: "out boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getOutturnByVariety } = await import("@/lib/db/mill-balance");
    await expect(getOutturnByVariety()).rejects.toThrow(
      "getOutturnByVariety: out boom",
    );
  });
});
