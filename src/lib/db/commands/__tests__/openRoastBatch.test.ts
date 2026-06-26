import { describe, expect, it, vi } from "vitest";

import {
  openRoastBatch,
  validateOpenRoastBatch,
  friendlyOpenRoastBatchError,
  type OpenRoastBatchStore,
} from "@/lib/db/commands/openRoastBatch";

/**
 * Pure-domain command test for opening a roast batch (P3-S10 — roasting; ADR-002).
 * `open_roast_batch` is the KEYSTONE: it gates on a GOLDEN (approved) profile AND
 * commits the green draw by inserting a lot_shipments row, so the SHIPPED
 * prevent_oversell trigger physically rejects roasting green that is already
 * sold/reserved (or more than exists) — the money guarantee REUSED, never rebuilt.
 * This file (no database) proves the friendly-validation seam, the exact snake_case
 * envelope, and that BOTH keystone rejections (not-golden, oversell) surface as
 * CLEAN, family-readable sentences. The triggers themselves are pinned by the
 * migration's PGlite tests. Mirrors openMillingRun.test.ts.
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: OpenRoastBatchStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as OpenRoastBatchStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  greenLotCode: "JC-742",
  profileId: "7",
  roasterId: "1",
  greenInKg: "12",
  idempotencyKey: "idem-open-batch-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateOpenRoastBatch", () => {
  it("accepts a complete, well-formed open-batch request", () => {
    const r = validateOpenRoastBatch(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.greenLotCode).toBe("JC-742");
      expect(r.data.profileId).toBe(7);
      expect(r.data.roasterId).toBe(1);
      expect(r.data.greenInKg).toBe(12);
      expect(r.data.idempotencyKey).toBe("idem-open-batch-1");
    }
  });

  it("rejects a missing green lot", () => {
    const r = validateOpenRoastBatch({ ...validRaw(), greenLotCode: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.greenLotCode).toBeDefined();
  });

  it("rejects a non-positive / non-integer profile id", () => {
    expect(validateOpenRoastBatch({ ...validRaw(), profileId: "0" }).ok).toBe(false);
    expect(validateOpenRoastBatch({ ...validRaw(), profileId: "7.5" }).ok).toBe(false);
  });

  it("rejects a non-positive / non-integer roaster id", () => {
    expect(validateOpenRoastBatch({ ...validRaw(), roasterId: "0" }).ok).toBe(false);
    expect(validateOpenRoastBatch({ ...validRaw(), roasterId: "1.2" }).ok).toBe(false);
  });

  it("rejects a non-positive green_in_kg (the green_in_kg > 0 CHECK)", () => {
    const zero = validateOpenRoastBatch({ ...validRaw(), greenInKg: "0" });
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.errors.greenInKg).toMatch(/greater than 0/i);
    expect(validateOpenRoastBatch({ ...validRaw(), greenInKg: "-1" }).ok).toBe(false);
  });

  it("rejects a non-numeric green_in_kg", () => {
    const r = validateOpenRoastBatch({ ...validRaw(), greenInKg: "lots" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.greenInKg).toBeDefined();
  });

  it("rejects a missing idempotency key", () => {
    const r = validateOpenRoastBatch({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── friendly-error seam ───────────────────────────

describe("friendlyOpenRoastBatchError", () => {
  it("translates the not-golden gate rejection into a plain sentence", () => {
    const msg = friendlyOpenRoastBatchError({
      code: "23514",
      message:
        "roast profile 7 is draft — only a GOLDEN (approved) profile can be roasted against",
    });
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/golden|lock|profile/i);
    expect(msg).not.toMatch(/23514|roast_profiles|approved\)/);
  });

  it("translates the oversell rejection (already sold/reserved) into a plain sentence", () => {
    const msg = friendlyOpenRoastBatchError({
      code: "23514",
      message:
        "roast oversell: green lot JC-742 has only 8.000 kg available-to-promise; cannot draw 12.000 kg to the roaster (already sold/reserved)",
    });
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/available|sold|reserved|enough/i);
    expect(msg).not.toMatch(/23514|available-to-promise/);
  });

  it("translates a prevent_oversell trigger rejection into a plain sentence", () => {
    const msg = friendlyOpenRoastBatchError({
      message:
        "oversell on green_lot JC-742: committed 20.000 + 12.000 exceeds available 25.000",
    });
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/available|sold|reserved|enough/i);
  });

  it("translates an unknown roaster / green lot into a plain sentence", () => {
    expect(
      friendlyOpenRoastBatchError({ code: "23503", message: "unknown roaster 9" }),
    ).toMatch(/roaster|couldn't be found/i);
    expect(
      friendlyOpenRoastBatchError({ code: "23503", message: "unknown green lot JC-999" }),
    ).toMatch(/green lot|couldn't be found/i);
  });

  it("returns null for an unrecognised error", () => {
    expect(friendlyOpenRoastBatchError({ message: "deadlock detected" })).toBeNull();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("openRoastBatch", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await openRoastBatch(store, { ...validRaw(), greenInKg: "0" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls open_roast_batch once with the exact snake_case envelope and returns the batch id", async () => {
    const { store, rpc } = fakeStore({ data: 5, error: null });
    const result = await openRoastBatch(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("open_roast_batch", {
      p_green_lot_code: "JC-742",
      p_profile_id: 7,
      p_roaster_id: 1,
      p_green_in_kg: 12,
      p_idempotency_key: "idem-open-batch-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.batchId).toBe(5);
  });

  it("coerces a string id from PostgREST to a number", async () => {
    const { store } = fakeStore({ data: "8", error: null });
    const result = await openRoastBatch(store, validRaw());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.batchId).toBe(8);
  });

  it("surfaces the not-golden gate as a friendly message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        code: "23514",
        message:
          "roast profile 7 is draft — only a GOLDEN (approved) profile can be roasted against",
      },
    });
    const result = await openRoastBatch(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/golden|lock|profile/i);
      expect(result.message).not.toMatch(/23514/);
    }
  });

  it("surfaces the oversell rejection as a friendly message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        code: "23514",
        message:
          "roast oversell: green lot JC-742 has only 8.000 kg available-to-promise; cannot draw 12.000 kg to the roaster (already sold/reserved)",
      },
    });
    const result = await openRoastBatch(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/available|sold|reserved|enough/i);
      expect(result.message).not.toMatch(/available-to-promise/);
    }
  });

  it("falls back to a labelled message for an unrecognised RPC failure", async () => {
    const { store } = fakeStore({ data: null, error: { message: "deadlock detected" } });
    const result = await openRoastBatch(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBeTruthy();
      expect(result.message).not.toMatch(/deadlock detected/);
    }
  });
});
