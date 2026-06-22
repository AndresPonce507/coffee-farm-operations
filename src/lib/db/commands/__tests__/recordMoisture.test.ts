import { describe, expect, it, vi } from "vitest";

import {
  recordMoisture,
  validateRecordMoisture,
  type RecordMoistureStore,
} from "@/lib/db/commands/recordMoisture";

/**
 * Pure-domain command test for the moisture-reading write (P2-S4 — drying + the
 * reposo gate; ADR-002). Drives the command against a *fake store* (a stub of the
 * one `.rpc('record_moisture_reading', …)` method) so it proves the friendly-
 * validation seam and the exact snake_case argument envelope the RPC receives, in
 * the fast jsdom loop. The append-only + 0..100 + exactly-once enforcement is the
 * RPC's job (pinned by the migration's PGlite tests). Mirrors
 * advanceProcessingStage.test.ts.
 */

function fakeStore(result: {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}): { store: RecordMoistureStore; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as RecordMoistureStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  lotCode: "JC-571",
  moisturePct: "11.2",
  occurredAt: "2026-06-20T14:00:00.000Z",
  deviceId: "server-drying",
  deviceSeq: 7,
  idempotencyKey: "idem-1",
});

describe("validateRecordMoisture", () => {
  it("accepts a complete, valid reading and coerces the pct to a number", () => {
    const r = validateRecordMoisture(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.moisturePct).toBe(11.2);
  });

  it("rejects an out-of-range moisture (> 100)", () => {
    const r = validateRecordMoisture({ ...validRaw(), moisturePct: "140" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.moisturePct).toMatch(/between 0 and 100/i);
  });

  it("rejects a negative moisture", () => {
    const r = validateRecordMoisture({ ...validRaw(), moisturePct: "-3" });
    expect(r.ok).toBe(false);
  });

  it("rejects a missing lot code and a bad time", () => {
    const r = validateRecordMoisture({ ...validRaw(), lotCode: "", occurredAt: "nope" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.lotCode).toBeTruthy();
      expect(r.errors.occurredAt).toBeTruthy();
    }
  });
});

describe("recordMoisture", () => {
  it("calls the RPC once with the exact snake_case envelope and returns the id", async () => {
    const { store, rpc } = fakeStore({ data: 42, error: null });
    const r = await recordMoisture(store, validRaw());
    expect(r).toEqual({ ok: true, readingId: 42 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_moisture_reading", {
      p_lot_code: "JC-571",
      p_moisture_pct: 11.2,
      p_occurred_at: "2026-06-20T14:00:00.000Z",
      p_device_id: "server-drying",
      p_device_seq: 7,
      p_idempotency_key: "idem-1",
    });
  });

  it("never calls the RPC when validation fails (friendly errors before the round-trip)", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const r = await recordMoisture(store, { ...validRaw(), moisturePct: "999" });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("translates an unknown-lot FK violation into a clean reason", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: 'insert violates foreign key constraint', code: "23503" },
    });
    const r = await recordMoisture(store, validRaw());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/doesn't exist/i);
  });

  it("translates a duplicate-key replay (idempotency_key) into a clean reason", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        message:
          'duplicate key value violates unique constraint "moisture_readings_idempotency_key_key"',
        code: "23505",
      },
    });
    const r = await recordMoisture(store, validRaw());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/already recorded/i);
  });

  it("surfaces a device-seq clash as a real error, NOT a benign 'already recorded' replay", async () => {
    // moisture_readings carries BOTH unique(idempotency_key) AND
    // unique(device_id, device_seq). A genuine replay short-circuits inside the
    // RPC on idempotency_key, so the ONLY path to a 23505 reaching the caller is a
    // NON-replay (device_id, device_seq) collision — a distinct reading that was
    // REJECTED and LOST. It must surface as a real error, never the success-shaped
    // "already recorded" message that would tell the family everything is fine.
    const { store } = fakeStore({
      data: null,
      error: {
        message:
          'duplicate key value violates unique constraint "moisture_readings_device_id_device_seq_key"',
        code: "23505",
      },
    });
    const r = await recordMoisture(store, validRaw());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).not.toMatch(/already recorded/i);
      expect(r.message).toMatch(/sequence number was reused|re-sync/i);
    }
  });
});
