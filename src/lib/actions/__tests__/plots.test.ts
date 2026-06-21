import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Behaviour test for the plots Server Actions (createPlot / updatePlot /
 * deletePlot) — the WRITE seam over the `plots` table. Server Actions are the
 * driving port (ADR-002 — only ever invoked by an authenticated human
 * submitting a form). Drives each action against a mocked Supabase client + a
 * mocked `revalidatePath`, asserting the REAL `ActionState` contract.
 *
 * FLAG: Actions return ActionState {status,...}, not the {ok:false,error} shape
 * the issue assumed; validation failures surface as {status:'error', errors},
 * DB errors as {status:'error', message}.
 *
 * Proves:
 *   - createPlot runs the `ord` max-lookup, appends ord = max+1, INSERTs the
 *     right snake_case row shape, then refreshes /plots + /,
 *   - app-side validation (required field / enum / numeric bound) is enforced
 *     BEFORE any round-trip (no insert, no revalidate),
 *   - a labelled DB error on the ord-lookup or the insert surfaces as
 *     {status:'error', message} with no revalidate,
 *   - updatePlot requires an id, validates, then updates by id + refreshes,
 *   - deletePlot requires an id, deletes by id + refreshes,
 *   - DB errors on update/delete surface as {status:'error', message}.
 *
 * Mirrors the supabase-server mock idiom in
 * src/app/(app)/costing/__tests__/actions.test.ts and
 * src/app/(app)/eudr/__tests__/actions.test.ts.
 */

const getSupabaseMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => getSupabaseMock(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

import { createPlot, updatePlot, deletePlot, IDLE } from "@/lib/actions/plots";

type DbResult = { data?: unknown; error: { message: string } | null };

/**
 * A Supabase-client stand-in. `.from("plots")` returns an object exposing the
 * chains each action drives:
 *   - createPlot:  .select("ord").order(...).limit(...) → {data,error} (ord lookup)
 *                  then .insert({...}) → {error}
 *   - updatePlot:  .update({...}).eq("id", id) → {error}
 *   - deletePlot:  .delete().eq("id", id) → {error}
 * The select chain is a thenable so `await sb.from().select().order().limit()`
 * resolves to the ord result. The insert/update/delete/eq spies are captured so
 * tests can assert the payload + the id filter.
 *
 * Defaults: ord lookup → {data:[{ord:4}],error:null} (so a new plot gets ord 5);
 * insert/update/delete all → {error:null}.
 */
function makeClient(opts?: {
  ord?: DbResult;
  insert?: DbResult;
  update?: DbResult;
  delete?: DbResult;
}) {
  const ordResult: DbResult = opts?.ord ?? { data: [{ ord: 4 }], error: null };
  const insertResult: DbResult = opts?.insert ?? { error: null };
  const updateResult: DbResult = opts?.update ?? { error: null };
  const deleteResult: DbResult = opts?.delete ?? { error: null };

  // .select("ord").order(...).limit(...) → a thenable resolving to ordResult.
  const limit = vi.fn(() => Promise.resolve(ordResult));
  const order = vi.fn(() => ({ limit }));
  const select = vi.fn(() => ({ order }));

  const insert = vi.fn(() => Promise.resolve(insertResult));

  const updateEq = vi.fn(() => Promise.resolve(updateResult));
  const update = vi.fn(() => ({ eq: updateEq }));

  const deleteEq = vi.fn(() => Promise.resolve(deleteResult));
  const del = vi.fn(() => ({ eq: deleteEq }));

  const from = vi.fn(() => ({
    select,
    insert,
    update,
    delete: del,
  }));

  return {
    client: { from },
    from,
    select,
    order,
    limit,
    insert,
    update,
    updateEq,
    del,
    deleteEq,
  };
}

/**
 * Build a FormData with every required snake_case key set to a valid value.
 * `overrides` patches/sets keys; set a value to `undefined` to DELETE that key
 * (e.g. for the missing-field tests).
 */
function validForm(overrides?: Record<string, string | undefined>): FormData {
  const base: Record<string, string> = {
    name: "Baru Vista",
    block: "A1",
    variety: "Geisha",
    status: "healthy",
    last_inspected: "2026-06-01",
    area_ha: "2.5",
    altitude_masl: "1650",
    trees: "1200",
    shade_pct: "40",
    established_year: "2015",
    expected_yield_kg: "800",
  };
  const merged: Record<string, string | undefined> = { ...base, ...overrides };
  const fd = new FormData();
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined) fd.set(k, v);
  }
  return fd;
}

const SNAKE_ROW = {
  name: "Baru Vista",
  block: "A1",
  variety: "Geisha",
  area_ha: 2.5,
  altitude_masl: 1650,
  trees: 1200,
  shade_pct: 40,
  established_year: 2015,
  status: "healthy",
  last_inspected: "2026-06-01",
  expected_yield_kg: 800,
};

beforeEach(() => {
  getSupabaseMock.mockReset();
  revalidatePathMock.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("createPlot", () => {
  it("runs the ord max-lookup, inserts the snake_case row at ord = max+1, and refreshes /plots + /", async () => {
    const m = makeClient(); // ord default [{ord:4}] → new ord 5
    getSupabaseMock.mockReturnValue(m.client);

    const result = await createPlot(IDLE, validForm());

    expect(result).toEqual({ status: "success", message: "Plot added." });

    // the ord lookup ran: select("ord").order("ord",{ascending:false}).limit(1)
    expect(m.select).toHaveBeenCalledWith("ord");
    expect(m.order).toHaveBeenCalledWith("ord", { ascending: false });
    expect(m.limit).toHaveBeenCalledWith(1);

    // exactly one insert, with the snake_case mapping, ord 5, and a string id
    expect(m.insert).toHaveBeenCalledTimes(1);
    const row = (m.insert.mock.calls as unknown[][])[0][0] as Record<string, unknown>;
    expect(row).toEqual(expect.objectContaining({ ...SNAKE_ROW, ord: 5 }));
    expect(typeof row.id).toBe("string");
    expect((row.id as string).length).toBeGreaterThan(0);
    // the mapper never writes harvested_kg
    expect(row).not.toHaveProperty("harvested_kg");

    expect(revalidatePathMock).toHaveBeenCalledWith("/plots");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
  });

  it("rejects a blank name app-side (errors.name) without an insert or revalidate", async () => {
    const m = makeClient();
    getSupabaseMock.mockReturnValue(m.client);

    const result = await createPlot(IDLE, validForm({ name: "" }));

    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.errors?.name).toBeDefined();
    expect(m.insert).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown variety enum (errors.variety) without an insert", async () => {
    const m = makeClient();
    getSupabaseMock.mockReturnValue(m.client);

    const result = await createPlot(IDLE, validForm({ variety: "telepathy" }));

    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.errors?.variety).toBeDefined();
    expect(m.insert).not.toHaveBeenCalled();
  });

  it("rejects a non-positive area_ha (errors.area_ha) without an insert", async () => {
    const m = makeClient();
    getSupabaseMock.mockReturnValue(m.client);

    const result = await createPlot(IDLE, validForm({ area_ha: "0" }));

    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.errors?.area_ha).toBeDefined();
    expect(m.insert).not.toHaveBeenCalled();
  });

  it("surfaces a labelled ord-lookup DB error as {status:'error', message} — no insert, no revalidate", async () => {
    const m = makeClient({ ord: { data: null, error: { message: "ord boom" } } });
    getSupabaseMock.mockReturnValue(m.client);

    const result = await createPlot(IDLE, validForm());

    expect(result).toEqual({ status: "error", message: "ord boom" });
    expect(m.insert).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("surfaces a labelled insert DB error as {status:'error', message} — no revalidate", async () => {
    const m = makeClient({ insert: { error: { message: "insert boom" } } });
    getSupabaseMock.mockReturnValue(m.client);

    const result = await createPlot(IDLE, validForm());

    expect(result).toEqual({ status: "error", message: "insert boom" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("updatePlot", () => {
  it("updates by id with the snake_case toRow, then refreshes /plots + /", async () => {
    const m = makeClient();
    getSupabaseMock.mockReturnValue(m.client);

    const result = await updatePlot(IDLE, validForm({ id: "plot-1" }));

    expect(result).toEqual({ status: "success", message: "Plot updated." });

    expect(m.update).toHaveBeenCalledTimes(1);
    const row = (m.update.mock.calls as unknown[][])[0][0] as Record<string, unknown>;
    expect(row).toEqual(SNAKE_ROW);
    // the update is scoped to the id (and never sends ord/id in the payload)
    expect(m.updateEq).toHaveBeenCalledWith("id", "plot-1");
    expect(row).not.toHaveProperty("id");

    expect(revalidatePathMock).toHaveBeenCalledWith("/plots");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
  });

  it("rejects a missing id with {status:'error', message:'Missing plot id.'} — no update", async () => {
    const m = makeClient();
    getSupabaseMock.mockReturnValue(m.client);

    // id key omitted entirely
    const result = await updatePlot(IDLE, validForm());

    expect(result).toEqual({ status: "error", message: "Missing plot id." });
    expect(m.update).not.toHaveBeenCalled();
  });

  it("rejects a validation failure (blank block → errors.block) without an update", async () => {
    const m = makeClient();
    getSupabaseMock.mockReturnValue(m.client);

    const result = await updatePlot(IDLE, validForm({ id: "plot-1", block: "" }));

    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.errors?.block).toBeDefined();
    expect(m.update).not.toHaveBeenCalled();
  });

  it("surfaces a labelled update DB error as {status:'error', message} — no revalidate", async () => {
    const m = makeClient({ update: { error: { message: "upd boom" } } });
    getSupabaseMock.mockReturnValue(m.client);

    const result = await updatePlot(IDLE, validForm({ id: "plot-1" }));

    expect(result).toEqual({ status: "error", message: "upd boom" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("deletePlot", () => {
  it("deletes by id, then refreshes /plots + /", async () => {
    const m = makeClient();
    getSupabaseMock.mockReturnValue(m.client);

    const result = await deletePlot("plot-1");

    expect(result).toEqual({ status: "success", message: "Plot deleted." });
    expect(m.del).toHaveBeenCalledTimes(1);
    expect(m.deleteEq).toHaveBeenCalledWith("id", "plot-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/plots");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
  });

  it("rejects an empty id with {status:'error', message:'Missing plot id.'} — no delete", async () => {
    const m = makeClient();
    getSupabaseMock.mockReturnValue(m.client);

    const result = await deletePlot("");

    expect(result).toEqual({ status: "error", message: "Missing plot id." });
    expect(m.del).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("surfaces a labelled delete DB error as {status:'error', message} — no revalidate", async () => {
    const m = makeClient({ delete: { error: { message: "del boom" } } });
    getSupabaseMock.mockReturnValue(m.client);

    const result = await deletePlot("plot-1");

    expect(result).toEqual({ status: "error", message: "del boom" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
