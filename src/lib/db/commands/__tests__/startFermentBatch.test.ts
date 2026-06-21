import { describe, expect, it, vi } from "vitest";

import {
  startFermentBatch,
  validateStartFermentBatch,
  type StartFermentBatchStore,
} from "@/lib/db/commands/startFermentBatch";

/**
 * Pure-domain command test for the P2-S3 start-ferment-batch write (ADR-002). No DB:
 * drives the command against a fake store (the `.rpc('start_ferment_batch', …)`
 * method), proving the friendly-validation seam + the exact snake_case envelope. The
 * DB FK (lot must exist, recipe must exist) is the real enforcement; this validates
 * friendly errors before the round-trip.
 */

function fakeStore(result: {
  data: string | null;
  error: { message: string; code?: string } | null;
}): { store: StartFermentBatchStore; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as StartFermentBatchStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  lotCode: "JC-800",
  recipeId: "rec-geisha-anaerobic-v1",
  method: "Anaerobic",
  occurredAt: "2026-06-20T06:00:00.000Z",
  deviceId: "server-ferment",
  deviceSeq: 1,
  idempotencyKey: "b-1",
});

describe("validateStartFermentBatch", () => {
  it("accepts a complete, well-formed start", () => {
    const r = validateStartFermentBatch(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.lotCode).toBe("JC-800");
      expect(r.data.recipeId).toBe("rec-geisha-anaerobic-v1");
      expect(r.data.method).toBe("Anaerobic");
    }
  });

  it("rejects a missing lot code", () => {
    const r = validateStartFermentBatch({ ...validRaw(), lotCode: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.lotCode).toMatch(/lot/i);
  });

  it("rejects a method that is not a real process_method", () => {
    const r = validateStartFermentBatch({ ...validRaw(), method: "Carbonic" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.method).toMatch(/method/i);
  });

  it("allows a null/empty recipe (a batch may start before a recipe is chosen)", () => {
    const r = validateStartFermentBatch({ ...validRaw(), recipeId: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.recipeId).toBeNull();
  });
});

describe("startFermentBatch", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await startFermentBatch(store, { ...validRaw(), lotCode: "" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls start_ferment_batch EXACTLY ONCE with the snake_case envelope", async () => {
    const { store, rpc } = fakeStore({ data: "batch-uuid", error: null });
    const result = await startFermentBatch(store, validRaw());
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("start_ferment_batch", {
      p_lot_code: "JC-800",
      p_recipe_id: "rec-geisha-anaerobic-v1",
      p_method: "Anaerobic",
      p_occurred_at: "2026-06-20T06:00:00.000Z",
      p_device_id: "server-ferment",
      p_device_seq: 1,
      p_idempotency_key: "b-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.batchId).toBe("batch-uuid");
  });

  it("forwards null recipe id when none is chosen", async () => {
    const { store, rpc } = fakeStore({ data: "batch-uuid", error: null });
    await startFermentBatch(store, { ...validRaw(), recipeId: "" });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_recipe_id).toBeNull();
  });

  it("maps an unknown-lot foreign_key_violation to a FRIENDLY message", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "unknown lot JC-NOPE", code: "23503" },
    });
    const result = await startFermentBatch(store, { ...validRaw(), lotCode: "JC-NOPE" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/lot|exist|found/i);
      expect(result.message).not.toMatch(/foreign key constraint/i);
    }
  });
});
