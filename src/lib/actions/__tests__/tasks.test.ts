import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Behaviour test for the Tasks Server Actions (createTask / updateTask /
 * deleteTask / setTaskStatus) — the WRITE seam for the tasks board. Server
 * Actions are the driving port (ADR-002 — only ever invoked by an authenticated
 * human submitting a form). Each action is driven against a mocked Supabase
 * client + a mocked `revalidatePath`.
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

import {
  createTask,
  updateTask,
  deleteTask,
  setTaskStatus,
  IDLE,
} from "@/lib/actions/tasks";

type DbResult = { error: { message: string } | null };

/**
 * A Supabase-client stand-in: `.from("tasks")` returns the chainable write
 * surface the actions use — `.insert()` resolves a {error} result, while
 * `.update()` and `.delete()` each return an object with an `.eq()` spy that
 * resolves a {error} result. Each seam's result defaults to {error:null}
 * (success) so the happy-path tests don't have to opt in; a test passes
 * `insertResult` / `updateResult` / `deleteResult` to drive the error path.
 *
 * The capture-spies (insert / update / updateEq / del / deleteEq) are returned
 * so a test can assert the exact snake_case payload + `.eq("id", …)` args.
 */
function makeClient(opts?: {
  insertResult?: DbResult;
  updateResult?: DbResult;
  deleteResult?: DbResult;
}): {
  client: unknown;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  updateEq: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  deleteEq: ReturnType<typeof vi.fn>;
} {
  const insert = vi.fn(() =>
    Promise.resolve(opts?.insertResult ?? { error: null }),
  );
  const updateEq = vi.fn(() =>
    Promise.resolve(opts?.updateResult ?? { error: null }),
  );
  const update = vi.fn(() => ({ eq: updateEq }));
  const deleteEq = vi.fn(() =>
    Promise.resolve(opts?.deleteResult ?? { error: null }),
  );
  const del = vi.fn(() => ({ eq: deleteEq }));
  const from = vi.fn(() => ({ insert, update, delete: del }));
  return { client: { from }, insert, update, updateEq, del, deleteEq };
}

/** A FormData with valid task keys; `overrides` patches values, or deletes a
 *  key when its value is `undefined`. */
function validForm(overrides?: Record<string, string | undefined>): FormData {
  const base: Record<string, string> = {
    title: "Prune block A1",
    category: "Pruning",
    workerId: "w-1",
    due: "2026-07-01",
    status: "todo",
    priority: "high",
    plotId: "plot-1",
  };
  const merged: Record<string, string> = { ...base };
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete merged[key];
      else merged[key] = value;
    }
  }
  const fd = new FormData();
  for (const [key, value] of Object.entries(merged)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  getSupabaseMock.mockReset();
  revalidatePathMock.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("createTask", () => {
  it("inserts a snake_case row with a generated id, revalidates, and returns success", async () => {
    const { client, insert } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await createTask(IDLE, validForm());

    expect(insert).toHaveBeenCalledTimes(1);
    const insertedRow = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertedRow).toEqual(
      expect.objectContaining({
        title: "Prune block A1",
        category: "Pruning",
        plot_id: "plot-1",
        worker_id: "w-1",
        due: "2026-07-01",
        status: "todo",
        priority: "high",
      }),
    );
    expect(typeof insertedRow.id).toBe("string");
    expect((insertedRow.id as string).length).toBeGreaterThan(0);

    expect(revalidatePathMock).toHaveBeenCalledWith("/tasks");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    expect(result).toEqual({ status: "success", message: "Task added." });
  });

  it("maps a blank plotId to a null plot_id and still succeeds", async () => {
    const { client, insert } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await createTask(IDLE, validForm({ plotId: "" }));

    const insertedRow = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertedRow.plot_id).toBeNull();
    expect(result).toEqual({ status: "success", message: "Task added." });
  });

  it("rejects a missing title WITHOUT an insert or revalidate", async () => {
    const { client, insert } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await createTask(IDLE, validForm({ title: "" }));

    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.errors?.title).toBeDefined();
    expect(insert).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown category enum WITHOUT an insert", async () => {
    const { client, insert } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await createTask(IDLE, validForm({ category: "Dancing" }));

    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.errors?.category).toBeDefined();
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects a missing assignee (workerId) WITHOUT an insert", async () => {
    const { client, insert } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await createTask(IDLE, validForm({ workerId: "" }));

    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.errors?.workerId).toBeDefined();
    expect(insert).not.toHaveBeenCalled();
  });

  it("surfaces a DB insert error as {status:'error', message} with no revalidate", async () => {
    const { client } = makeClient({
      insertResult: { error: { message: "task boom" } },
    });
    getSupabaseMock.mockReturnValue(client);

    const result = await createTask(IDLE, validForm());

    expect(result).toEqual({ status: "error", message: "task boom" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("updateTask", () => {
  it("updates the snake_case row by id, revalidates, and returns success", async () => {
    const { client, update, updateEq } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await updateTask(IDLE, validForm({ id: "t-1" }));

    expect(update).toHaveBeenCalledTimes(1);
    const updatedRow = update.mock.calls[0][0] as Record<string, unknown>;
    expect(updatedRow).toEqual({
      title: "Prune block A1",
      category: "Pruning",
      plot_id: "plot-1",
      worker_id: "w-1",
      due: "2026-07-01",
      status: "todo",
      priority: "high",
    });
    expect(updateEq).toHaveBeenCalledWith("id", "t-1");

    expect(revalidatePathMock).toHaveBeenCalledWith("/tasks");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    expect(result).toEqual({ status: "success", message: "Task updated." });
  });

  it("rejects a missing id WITHOUT an update", async () => {
    const { client, update } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await updateTask(IDLE, validForm({ id: undefined }));

    expect(result).toEqual({ status: "error", message: "Missing task id." });
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects an invalid due date WITHOUT an update", async () => {
    const { client, update } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await updateTask(
      IDLE,
      validForm({ id: "t-1", due: "not-a-date" }),
    );

    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.errors?.due).toBeDefined();
    expect(update).not.toHaveBeenCalled();
  });

  it("surfaces a DB update error as {status:'error', message} with no revalidate", async () => {
    const { client } = makeClient({
      updateResult: { error: { message: "update boom" } },
    });
    getSupabaseMock.mockReturnValue(client);

    const result = await updateTask(IDLE, validForm({ id: "t-1" }));

    expect(result).toEqual({ status: "error", message: "update boom" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("deleteTask", () => {
  it("deletes by id, revalidates, and returns success", async () => {
    const { client, del, deleteEq } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await deleteTask("t-1");

    expect(del).toHaveBeenCalledTimes(1);
    expect(deleteEq).toHaveBeenCalledWith("id", "t-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/tasks");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    expect(result).toEqual({ status: "success", message: "Task deleted." });
  });

  it("rejects an empty id WITHOUT a delete", async () => {
    const { client, del } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await deleteTask("");

    expect(result).toEqual({ status: "error", message: "Missing task id." });
    expect(del).not.toHaveBeenCalled();
  });

  it("surfaces a DB delete error as {status:'error', message} with no revalidate", async () => {
    const { client } = makeClient({
      deleteResult: { error: { message: "delete boom" } },
    });
    getSupabaseMock.mockReturnValue(client);

    const result = await deleteTask("t-1");

    expect(result).toEqual({ status: "error", message: "delete boom" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("setTaskStatus", () => {
  it("updates only the status by id, revalidates, and returns success", async () => {
    const { client, update, updateEq } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await setTaskStatus("t-1", "done");

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ status: "done" });
    expect(updateEq).toHaveBeenCalledWith("id", "t-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/tasks");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    expect(result).toEqual({ status: "success", message: "Status updated." });
  });

  it("rejects an unknown status WITHOUT an update", async () => {
    const { client, update } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await setTaskStatus("t-1", "galaxy" as never);

    expect(result).toEqual({ status: "error", message: "Invalid status." });
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a missing id WITHOUT an update", async () => {
    const { client, update } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await setTaskStatus("", "done");

    expect(result).toEqual({ status: "error", message: "Missing task id." });
    expect(update).not.toHaveBeenCalled();
  });

  it("surfaces a DB update error as {status:'error', message} with no revalidate", async () => {
    const { client } = makeClient({
      updateResult: { error: { message: "status boom" } },
    });
    getSupabaseMock.mockReturnValue(client);

    const result = await setTaskStatus("t-1", "done");

    expect(result).toEqual({ status: "error", message: "status boom" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
