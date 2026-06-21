import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Behaviour test for the processing-batch Server Actions (createBatch /
 * updateBatch / deleteBatch) — the WRITE seam for the `processing_batches`
 * table. Server Actions are the driving port (ADR-002 — only ever invoked by an
 * authenticated human submitting a form). Drives each action against a mocked
 * Supabase client + a mocked `revalidatePath`, proving:
 *   - a valid form INSERTs/UPDATEs the right snake_case row shape and revalidates
 *     /processing + /,
 *   - the DB-CHECK-shape rules (lot-code format, enum membership, mass
 *     conservation currentKg<=cherriesKg, positive cherry intake, 0-100 progress)
 *     are enforced app-side BEFORE the round-trip — no insert/update, no
 *     revalidate,
 *   - a missing id short-circuits update/delete,
 *   - a labelled DB error surfaces as { status:"error", message } with no refresh.
 *
 * Mirrors the supabase-server mock idiom in
 * src/app/(app)/costing/__tests__/actions.test.ts and
 * src/app/(app)/eudr/__tests__/actions.test.ts.
 *
 * FLAG: Actions return ActionState {status,...}, not the {ok:false,error} shape
 * the issue assumed; validation failures surface as {status:'error', errors}, DB
 * errors as {status:'error', message}. These tests assert the REAL {status}
 * contract.
 */

const getSupabaseMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => getSupabaseMock(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

import { createBatch, updateBatch, deleteBatch, IDLE } from "@/lib/actions/processing";

type DbError = { message: string; code?: string } | null;

/**
 * A Supabase-client stand-in: `.from("processing_batches")` returns the trio of
 * write seams the actions use —
 *   - `.insert()` resolves `{ error }` (default null),
 *   - `.update()` returns `{ eq }` where `.eq()` resolves `{ error }`,
 *   - `.delete()` returns `{ eq }` where `.eq()` resolves `{ error }`.
 * The inner `.eq()` spies are surfaced so a test can assert the row payload AND
 * the `eq("id", id)` scoping. The `from` spy is surfaced so a test can assert the
 * table name.
 */
function makeClient(opts?: {
  insert?: DbError;
  update?: DbError;
  delete?: DbError;
}): {
  client: unknown;
  from: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  updateEq: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  deleteEq: ReturnType<typeof vi.fn>;
} {
  const insert = vi.fn(() =>
    Promise.resolve({ error: opts?.insert ?? null }),
  );
  const updateEq = vi.fn(() =>
    Promise.resolve({ error: opts?.update ?? null }),
  );
  const update = vi.fn(() => ({ eq: updateEq }));
  const deleteEq = vi.fn(() =>
    Promise.resolve({ error: opts?.delete ?? null }),
  );
  const del = vi.fn(() => ({ eq: deleteEq }));
  const from = vi.fn(() => ({ insert, update, delete: del }));
  return { client: { from }, from, insert, update, updateEq, del, deleteEq };
}

/** A valid processing-batch form. camelCase keys (the form's own shape). */
function validForm(overrides?: Record<string, string | null>): FormData {
  const base: Record<string, string> = {
    lotCode: "JC-701",
    variety: "Geisha",
    method: "Washed",
    stage: "drying",
    startedDate: "2026-06-01",
    cherriesKg: "1000",
    currentKg: "180",
    moisturePct: "11",
    patio: "Bed 3",
    progressPct: "60",
  };
  const merged = { ...base, ...(overrides ?? {}) };
  const fd = new FormData();
  for (const [k, v] of Object.entries(merged)) {
    if (v === null) continue; // a null override DELETES the key from the form
    fd.set(k, v);
  }
  return fd;
}

beforeEach(() => {
  getSupabaseMock.mockReset();
  revalidatePathMock.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("createBatch", () => {
  it("inserts a snake_case row with a generated id, revalidates /processing + /, and returns success", async () => {
    const { client, from, insert } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await createBatch(IDLE, validForm());

    expect(from).toHaveBeenCalledWith("processing_batches");
    expect(insert).toHaveBeenCalledTimes(1);
    const row = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(row).toEqual(
      expect.objectContaining({
        lot_code: "JC-701",
        variety: "Geisha",
        method: "Washed",
        stage: "drying",
        started_date: "2026-06-01",
        cherries_kg: 1000,
        current_kg: 180,
        moisture_pct: 11,
        patio: "Bed 3",
        progress_pct: 60,
      }),
    );
    expect(typeof row.id).toBe("string");
    expect((row.id as string).length).toBeGreaterThan(0);

    expect(revalidatePathMock).toHaveBeenCalledWith("/processing");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    expect(result).toEqual({ status: "success", message: "Batch added." });
  });

  it("rejects a bad lot-code format WITHOUT a round-trip (errors.lotCode set)", async () => {
    const { client, insert } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await createBatch(IDLE, validForm({ lotCode: "banana" }));

    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.errors?.lotCode).toBeDefined();
    expect(insert).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown method enum value (errors.method set), no insert", async () => {
    const { client, insert } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await createBatch(IDLE, validForm({ method: "Telepathy" }));

    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.errors?.method).toBeDefined();
    expect(insert).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("rejects a mass-conservation violation — currentKg cannot exceed cherriesKg (errors.currentKg), no insert", async () => {
    const { client, insert } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    // 2000 kg of dried/parchment weight from 1000 kg of cherries is physically
    // impossible — a batch can't weigh more than the cherries it started from.
    const result = await createBatch(
      IDLE,
      validForm({ cherriesKg: "1000", currentKg: "2000" }),
    );

    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.errors?.currentKg).toBeDefined();
    expect(insert).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("rejects a zero cherry intake — must be > 0 (errors.cherriesKg), no insert", async () => {
    const { client, insert } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    // currentKg dropped so the <=cherriesKg rule doesn't also fire and mask the
    // intake error we're asserting on.
    const result = await createBatch(
      IDLE,
      validForm({ cherriesKg: "0", currentKg: "0" }),
    );

    expect(result.status).toBe("error");
    if (result.status === "error")
      expect(result.errors?.cherriesKg).toBeDefined();
    expect(insert).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("surfaces a labelled DB error as { status:'error', message } with no refresh", async () => {
    const { client } = makeClient({ insert: { message: "batch boom" } });
    getSupabaseMock.mockReturnValue(client);

    const result = await createBatch(IDLE, validForm());

    expect(result).toEqual({ status: "error", message: "batch boom" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("updateBatch", () => {
  it("updates a snake_case row scoped to eq('id', id), revalidates, and returns success", async () => {
    const { client, from, update, updateEq } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await updateBatch(IDLE, validForm({ id: "b-1" }));

    expect(from).toHaveBeenCalledWith("processing_batches");
    expect(update).toHaveBeenCalledTimes(1);
    const row = update.mock.calls[0][0] as Record<string, unknown>;
    expect(row).toEqual({
      lot_code: "JC-701",
      variety: "Geisha",
      method: "Washed",
      stage: "drying",
      started_date: "2026-06-01",
      cherries_kg: 1000,
      current_kg: 180,
      moisture_pct: 11,
      patio: "Bed 3",
      progress_pct: 60,
    });
    expect(updateEq).toHaveBeenCalledWith("id", "b-1");

    expect(revalidatePathMock).toHaveBeenCalledWith("/processing");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    expect(result).toEqual({ status: "success", message: "Batch updated." });
  });

  it("rejects a missing id with { status:'error', message } and never calls update", async () => {
    const { client, update } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    // no `id` key on the form
    const result = await updateBatch(IDLE, validForm());

    expect(result).toEqual({ status: "error", message: "Missing batch id." });
    expect(update).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("rejects a validation failure on update (id present, bad progressPct) — errors.progressPct, no update", async () => {
    const { client, update } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await updateBatch(
      IDLE,
      validForm({ id: "b-1", progressPct: "150" }),
    );

    expect(result.status).toBe("error");
    if (result.status === "error")
      expect(result.errors?.progressPct).toBeDefined();
    expect(update).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("surfaces a labelled update DB error as { status:'error', message } with no refresh", async () => {
    const { client } = makeClient({ update: { message: "update boom" } });
    getSupabaseMock.mockReturnValue(client);

    const result = await updateBatch(IDLE, validForm({ id: "b-1" }));

    expect(result).toEqual({ status: "error", message: "update boom" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("deleteBatch", () => {
  it("deletes scoped to eq('id', id), revalidates, and returns success", async () => {
    const { client, from, del, deleteEq } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await deleteBatch("b-1");

    expect(from).toHaveBeenCalledWith("processing_batches");
    expect(del).toHaveBeenCalledTimes(1);
    expect(deleteEq).toHaveBeenCalledWith("id", "b-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/processing");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    expect(result).toEqual({ status: "success", message: "Batch deleted." });
  });

  it("rejects an empty id with { status:'error', message } and never calls delete", async () => {
    const { client, del } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await deleteBatch("");

    expect(result).toEqual({ status: "error", message: "Missing batch id." });
    expect(del).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("surfaces a labelled delete DB error as { status:'error', message } with no refresh", async () => {
    const { client } = makeClient({ delete: { message: "delete boom" } });
    getSupabaseMock.mockReturnValue(client);

    const result = await deleteBatch("b-1");

    expect(result).toEqual({ status: "error", message: "delete boom" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
