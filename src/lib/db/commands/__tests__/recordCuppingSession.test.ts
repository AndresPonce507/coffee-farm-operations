import { describe, expect, it, vi } from "vitest";

import {
  recordCuppingSession,
  validateCuppingSession,
  type CuppingSessionStore,
} from "@/lib/db/commands/recordCuppingSession";

/**
 * Pure-domain command test for opening a cupping session (P2-S6 — the
 * `record_cupping_session` SECURITY DEFINER RPC). No DB: a fake store stubs the
 * one `.rpc()`. Proves the validation seam (protocol must be sca-cva|legacy-100)
 * and the snake_case envelope. The SQL CHECK is the real enforcement.
 */

interface RpcResult {
  data: number | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: CuppingSessionStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as CuppingSessionStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  greenLotCode: "JC-9001",
  cupperId: "w-cup-1",
  protocol: "sca-cva",
  isCalibration: "false",
  deviceId: "srv",
  deviceSeq: "1",
  idempotencyKey: "sess-1",
});

describe("validateCuppingSession", () => {
  it("accepts a complete request", () => {
    const r = validateCuppingSession(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.protocol).toBe("sca-cva");
      expect(r.data.isCalibration).toBe(false);
    }
  });

  it("rejects an unknown protocol", () => {
    const r = validateCuppingSession({ ...validRaw(), protocol: "made-up" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.protocol).toBeTruthy();
  });

  it("coerces an isCalibration checkbox value to a boolean", () => {
    const on = validateCuppingSession({ ...validRaw(), isCalibration: "on" });
    expect(on.ok).toBe(true);
    if (on.ok) expect(on.data.isCalibration).toBe(true);
  });

  it("rejects a missing cupper", () => {
    const r = validateCuppingSession({ ...validRaw(), cupperId: "" });
    expect(r.ok).toBe(false);
  });
});

describe("recordCuppingSession", () => {
  it("calls record_cupping_session with the snake_case envelope", async () => {
    const { store, rpc } = fakeStore({ data: 9, error: null });
    const out = await recordCuppingSession(store, {
      ...validRaw(),
      occurredAt: "2026-06-21T09:00:00.000Z",
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.sessionId).toBe(9);
    expect(rpc).toHaveBeenCalledWith("record_cupping_session", {
      p_green_lot_code: "JC-9001",
      p_cupper_id: "w-cup-1",
      p_protocol: "sca-cva",
      p_is_calibration: false,
      p_occurred_at: "2026-06-21T09:00:00.000Z",
      p_device_id: "srv",
      p_device_seq: 1,
      p_idempotency_key: "sess-1",
    });
  });

  it("surfaces a labelled message on an RPC error", async () => {
    const { store } = fakeStore({ data: null, error: { message: "x" } });
    const out = await recordCuppingSession(store, validRaw());
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toMatch(/record_cupping_session/i);
  });
});
