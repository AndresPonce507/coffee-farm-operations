import { describe, expect, it, vi } from "vitest";

import {
  logMillWater,
  validateMillWater,
  type LogMillWaterStore,
} from "@/lib/db/commands/logMillWater";

/**
 * Pure-domain command test for the P2-S3 eco-mill water write (ADR-002). No DB:
 * drives the command against a fake store (the `.rpc('log_mill_water', …)` method),
 * proving the friendly-validation seam + the exact snake_case envelope. The DB
 * CHECK (liters > 0) + FK (batch must exist) is the real enforcement.
 */

function fakeStore(result: {
  data: number | null;
  error: { message: string; code?: string } | null;
}): { store: LogMillWaterStore; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as LogMillWaterStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  batchId: "00000000-0000-0000-0000-0000000000b1",
  liters: "240",
  occurredAt: "2026-06-20T13:00:00.000Z",
  deviceId: "server-ferment",
  deviceSeq: 30,
  idempotencyKey: "w-1",
});

describe("validateMillWater", () => {
  it("accepts a complete, well-formed water log", () => {
    const r = validateMillWater(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.batchId).toBe("00000000-0000-0000-0000-0000000000b1");
      expect(r.data.liters).toBe(240);
    }
  });

  it("rejects a missing batch id", () => {
    const r = validateMillWater({ ...validRaw(), batchId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.batchId).toMatch(/batch/i);
  });

  it("rejects non-positive liters", () => {
    const zero = validateMillWater({ ...validRaw(), liters: "0" });
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.errors.liters).toMatch(/greater than 0/i);
    const neg = validateMillWater({ ...validRaw(), liters: "-5" });
    expect(neg.ok).toBe(false);
  });

  it("rejects non-numeric liters", () => {
    const r = validateMillWater({ ...validRaw(), liters: "lots" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.liters).toBeDefined();
  });
});

describe("logMillWater", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await logMillWater(store, { ...validRaw(), liters: "0" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls log_mill_water EXACTLY ONCE with the snake_case envelope", async () => {
    const { store, rpc } = fakeStore({ data: 3, error: null });
    const result = await logMillWater(store, validRaw());
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("log_mill_water", {
      p_batch_id: "00000000-0000-0000-0000-0000000000b1",
      p_liters: 240,
      p_occurred_at: "2026-06-20T13:00:00.000Z",
      p_device_id: "server-ferment",
      p_device_seq: 30,
      p_idempotency_key: "w-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.logId).toBe(3);
  });

  it("maps an unknown-batch foreign_key_violation to a FRIENDLY message", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "unknown ferment batch …", code: "23503" },
    });
    const result = await logMillWater(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/batch|exist|found/i);
      expect(result.message).not.toMatch(/foreign key constraint/i);
    }
  });
});
