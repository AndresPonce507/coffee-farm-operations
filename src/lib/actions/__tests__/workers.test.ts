import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Behaviour test for the `workers` Server Actions (createWorker / updateWorker /
 * deleteWorker) — the WRITE seam the owner hits from the roster forms. Server
 * Actions are the driving port (ADR-002 — only ever invoked by an authenticated
 * human submitting a form). Drives each action against a mocked Supabase client
 * + a mocked `revalidatePath`, proving the snake_case row shape, the validation
 * gate (no round-trip on bad input), and the DB-error path.
 *
 * FLAG: Actions return ActionState {status,...}, not the {ok:false,error} shape
 * the issue assumed; validation failures surface as {status:'error', errors},
 * DB errors as {status:'error', message}.
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

import { createWorker, deleteWorker, updateWorker, IDLE } from "@/lib/actions/workers";

/**
 * A chainable Supabase-client stand-in over `from("workers")`:
 *   - `.insert(row)`        resolves to {error}
 *   - `.update(row).eq()`   the eq resolves to {error}
 *   - `.delete().eq()`      the eq resolves to {error}
 * Each spy is captured so a test can assert the exact payload that was written.
 * Every DB result defaults to `{ error: null }` (the happy path) so the
 * round-trip tests don't have to opt in.
 */
function makeClient(opts?: {
  insertError?: { message: string } | null;
  updateError?: { message: string } | null;
  deleteError?: { message: string } | null;
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
    Promise.resolve({ error: opts?.insertError ?? null }),
  );

  const updateEq = vi.fn(() =>
    Promise.resolve({ error: opts?.updateError ?? null }),
  );
  const update = vi.fn(() => ({ eq: updateEq }));

  const deleteEq = vi.fn(() =>
    Promise.resolve({ error: opts?.deleteError ?? null }),
  );
  const del = vi.fn(() => ({ eq: deleteEq }));

  const from = vi.fn(() => ({ insert, update, delete: del }));
  return {
    client: { from },
    from,
    insert,
    update,
    updateEq,
    del,
    deleteEq,
  };
}

/**
 * A FormData carrying a valid worker. `overrides` set/replace a key; a value of
 * `undefined` deletes the key entirely (to exercise the "missing field" paths).
 */
function validForm(overrides?: Record<string, string | undefined>): FormData {
  const base: Record<string, string> = {
    name: "Maria Lopez",
    role: "Picker",
    daily_rate_usd: "18",
    attendance: "present",
    started_year: "2019",
    phone: "+507 6000-0000",
    crew: "Norte",
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries(base)) fd.set(k, v);
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) fd.delete(k);
      else fd.set(k, v);
    }
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

describe("createWorker", () => {
  it("inserts a snake_case worker row (no today_kg), revalidates /workers + /, and returns success", async () => {
    const { client, insert } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await createWorker(IDLE, validForm());

    expect(insert).toHaveBeenCalledTimes(1);
    const insertedRow = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertedRow).toEqual(
      expect.objectContaining({
        name: "Maria Lopez",
        role: "Picker",
        daily_rate_usd: 18,
        attendance: "present",
        started_year: 2019,
        phone: "+507 6000-0000",
        crew: "Norte",
      }),
    );
    expect(typeof insertedRow.id).toBe("string");
    // today_kg is intentionally never written from the form.
    expect(insertedRow).not.toHaveProperty("today_kg");

    expect(revalidatePathMock).toHaveBeenCalledWith("/workers");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    expect(result).toEqual({ status: "success", message: "Worker added." });
  });

  it("rejects a blank name WITHOUT a round-trip (validation gate)", async () => {
    const { client, insert } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await createWorker(IDLE, validForm({ name: "  " }));

    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.errors?.name).toBeDefined();
    expect(insert).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown role enum WITHOUT a round-trip", async () => {
    const { client, insert } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await createWorker(IDLE, validForm({ role: "wizard" }));

    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.errors?.role).toBeDefined();
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects a negative daily_rate_usd WITHOUT a round-trip", async () => {
    const { client, insert } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await createWorker(IDLE, validForm({ daily_rate_usd: "-5" }));

    expect(result.status).toBe("error");
    if (result.status === "error")
      expect(result.errors?.daily_rate_usd).toBeDefined();
    expect(insert).not.toHaveBeenCalled();
  });

  it("surfaces a labelled DB insert error as {status:'error', message} and does NOT revalidate", async () => {
    const { client } = makeClient({ insertError: { message: "worker boom" } });
    getSupabaseMock.mockReturnValue(client);

    const result = await createWorker(IDLE, validForm());

    expect(result).toEqual({ status: "error", message: "worker boom" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("updateWorker", () => {
  it("updates a snake_case row scoped by eq('id', id), revalidates, and returns success", async () => {
    const { client, update, updateEq } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await updateWorker(IDLE, validForm({ id: "w-1" }));

    expect(update).toHaveBeenCalledTimes(1);
    const updatedRow = update.mock.calls[0][0] as Record<string, unknown>;
    expect(updatedRow).toEqual(
      expect.objectContaining({
        name: "Maria Lopez",
        role: "Picker",
        daily_rate_usd: 18,
        attendance: "present",
        started_year: 2019,
        phone: "+507 6000-0000",
        crew: "Norte",
      }),
    );
    // an update never carries id in the SET payload (it scopes via eq) and never
    // touches the computed today_kg column.
    expect(updatedRow).not.toHaveProperty("today_kg");
    expect(updatedRow).not.toHaveProperty("id");
    expect(updateEq).toHaveBeenCalledWith("id", "w-1");

    expect(revalidatePathMock).toHaveBeenCalledWith("/workers");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    expect(result).toEqual({ status: "success", message: "Worker updated." });
  });

  it("rejects a missing id WITHOUT a round-trip", async () => {
    const { client, update } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    // id key absent entirely.
    const result = await updateWorker(IDLE, validForm());

    expect(result).toEqual({ status: "error", message: "Missing worker id." });
    expect(update).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("rejects a validation failure on update (id present, blank phone) WITHOUT a round-trip", async () => {
    const { client, update } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await updateWorker(IDLE, validForm({ id: "w-1", phone: "" }));

    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.errors?.phone).toBeDefined();
    expect(update).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("surfaces a labelled DB update error as {status:'error', message} and does NOT revalidate", async () => {
    const { client } = makeClient({ updateError: { message: "update boom" } });
    getSupabaseMock.mockReturnValue(client);

    const result = await updateWorker(IDLE, validForm({ id: "w-1" }));

    expect(result).toEqual({ status: "error", message: "update boom" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("deleteWorker", () => {
  it("deletes by eq('id', id), revalidates /workers + /, and returns success", async () => {
    const { client, del, deleteEq } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await deleteWorker("w-1");

    expect(del).toHaveBeenCalledTimes(1);
    expect(deleteEq).toHaveBeenCalledWith("id", "w-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/workers");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    expect(result).toEqual({ status: "success", message: "Worker deleted." });
  });

  it("rejects an empty id WITHOUT a round-trip", async () => {
    const { client, del } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await deleteWorker("");

    expect(result).toEqual({ status: "error", message: "Missing worker id." });
    expect(del).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("surfaces a labelled DB delete error as {status:'error', message} and does NOT revalidate", async () => {
    const { client } = makeClient({ deleteError: { message: "delete boom" } });
    getSupabaseMock.mockReturnValue(client);

    const result = await deleteWorker("w-1");

    expect(result).toEqual({ status: "error", message: "delete boom" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
