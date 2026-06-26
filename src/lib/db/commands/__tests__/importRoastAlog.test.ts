import { describe, expect, it, vi } from "vitest";

import {
  importRoastAlog,
  validateImportRoastAlog,
  friendlyImportRoastAlogError,
  type ImportRoastAlogStore,
} from "@/lib/db/commands/importRoastAlog";

/**
 * Pure-domain command test for the $0 Artisan .alog capture path (P3-S10 — roasting;
 * ADR-002). `import_roast_alog` parses a normalized .alog jsonb ({points, events}),
 * inserts the append-only curve points + phase markers, and computes the max BT
 * deviation vs the batch's golden target — RECORDED as evidence (no untrusted inbound
 * drives a downstream write; a human runs finalize). This file (no database) proves
 * the validation seam (a real batch id + an object payload), the exact snake_case
 * envelope (the payload forwarded verbatim as jsonb), and the friendly-error mapping.
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: ImportRoastAlogStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as ImportRoastAlogStore, rpc };
}

const samplePayload = () => ({
  points: [
    { t: 0, bt: 200, et: 210, ror: 0 },
    { t: 60, bt: 150, et: 180, ror: -50 },
  ],
  events: [{ marker: "charge", t: 0, temp: 200 }],
});

const validRaw = (): Record<string, unknown> => ({
  batchId: "5",
  sourceFilename: "janson-2026-06-25.alog",
  alogPayload: samplePayload(),
  idempotencyKey: "idem-alog-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateImportRoastAlog", () => {
  it("accepts a complete, well-formed import", () => {
    const r = validateImportRoastAlog(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.batchId).toBe(5);
      expect(r.data.sourceFilename).toBe("janson-2026-06-25.alog");
      expect(r.data.alogPayload).toEqual(samplePayload());
      expect(r.data.idempotencyKey).toBe("idem-alog-1");
    }
  });

  it("treats a blank source filename as null", () => {
    const r = validateImportRoastAlog({ ...validRaw(), sourceFilename: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.sourceFilename).toBeNull();
  });

  it("accepts an empty-object payload (the RPC coalesces points/events to [])", () => {
    const r = validateImportRoastAlog({ ...validRaw(), alogPayload: {} });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.alogPayload).toEqual({});
  });

  it("rejects a non-positive / non-integer batch id", () => {
    expect(validateImportRoastAlog({ ...validRaw(), batchId: "0" }).ok).toBe(false);
    expect(validateImportRoastAlog({ ...validRaw(), batchId: "5.5" }).ok).toBe(false);
  });

  it("rejects a payload that isn't a plain object (array / primitive / missing)", () => {
    expect(validateImportRoastAlog({ ...validRaw(), alogPayload: [1, 2] }).ok).toBe(false);
    expect(validateImportRoastAlog({ ...validRaw(), alogPayload: "nope" }).ok).toBe(false);
    expect(validateImportRoastAlog({ ...validRaw(), alogPayload: null }).ok).toBe(false);
    const missing = validateImportRoastAlog({
      batchId: "5",
      idempotencyKey: "k",
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors.alogPayload).toBeDefined();
  });

  it("rejects a missing idempotency key", () => {
    const r = validateImportRoastAlog({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── friendly-error seam ───────────────────────────

describe("friendlyImportRoastAlogError", () => {
  it("translates an unknown batch into a plain sentence", () => {
    const msg = friendlyImportRoastAlogError({
      code: "23503",
      message: "unknown roast batch 99",
    });
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/batch|couldn't be found/i);
  });

  it("falls back to a clean generic line (no raw PG text)", () => {
    const msg = friendlyImportRoastAlogError({ message: "deadlock detected" });
    expect(msg).toBeTruthy();
    expect(msg).not.toMatch(/deadlock detected/);
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("importRoastAlog", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await importRoastAlog(store, { ...validRaw(), batchId: "0" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls import_roast_alog once with the exact envelope (payload forwarded verbatim)", async () => {
    const { store, rpc } = fakeStore({ data: 3, error: null });
    const result = await importRoastAlog(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("import_roast_alog", {
      p_batch_id: 5,
      p_source_filename: "janson-2026-06-25.alog",
      p_alog_payload: samplePayload(),
      p_idempotency_key: "idem-alog-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.importId).toBe(3);
  });

  it("forwards a blank source filename as null", async () => {
    const { store, rpc } = fakeStore({ data: 3, error: null });
    await importRoastAlog(store, { ...validRaw(), sourceFilename: "" });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_source_filename).toBeNull();
  });

  it("coerces a string id from PostgREST to a number", async () => {
    const { store } = fakeStore({ data: "4", error: null });
    const result = await importRoastAlog(store, validRaw());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.importId).toBe(4);
  });

  it("surfaces an unknown batch as a friendly message", async () => {
    const { store } = fakeStore({
      data: null,
      error: { code: "23503", message: "unknown roast batch 99" },
    });
    const result = await importRoastAlog(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/batch|couldn't be found/i);
  });

  it("returns a clean message when the RPC yields no id", async () => {
    const { store } = fakeStore({ data: null, error: null });
    const result = await importRoastAlog(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });
});
