import { describe, expect, it, vi } from "vitest";

import {
  recordFermentReading,
  validateFermentReading,
  type RecordFermentReadingStore,
} from "@/lib/db/commands/recordFermentReading";

/**
 * Pure-domain command test for the P2-S3 ferment-reading write (ADR-002 — every
 * write flows through a SECURITY DEFINER command RPC). No database: drives the
 * command against a fake store (the one `.rpc('record_ferment_reading', …)` method),
 * proving the friendly-validation seam and the exact snake_case argument envelope.
 * The DB CHECK/FK (reading_kind ∈ ph/temp/brix, batch must exist, append-only) is
 * the real enforcement; this validates friendly errors before the round-trip.
 * Mirrors the advanceProcessingStage.test.ts idiom.
 */

function fakeStore(result: {
  data: number | null;
  error: { message: string; code?: string } | null;
}): { store: RecordFermentReadingStore; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as RecordFermentReadingStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  batchId: "00000000-0000-0000-0000-0000000000b1",
  kind: "ph",
  value: "5.4",
  occurredAt: "2026-06-20T08:00:00.000Z",
  deviceId: "server-ferment",
  deviceSeq: 10,
  idempotencyKey: "rd-1",
});

describe("validateFermentReading", () => {
  it("accepts a complete, well-formed reading", () => {
    const r = validateFermentReading(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.batchId).toBe("00000000-0000-0000-0000-0000000000b1");
      expect(r.data.kind).toBe("ph");
      expect(r.data.value).toBe(5.4);
    }
  });

  it("rejects a missing batch id", () => {
    const r = validateFermentReading({ ...validRaw(), batchId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.batchId).toMatch(/batch/i);
  });

  it("rejects a reading_kind outside ph/temp/brix", () => {
    const r = validateFermentReading({ ...validRaw(), kind: "density" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.kind).toMatch(/reading|ph|temp|brix/i);
  });

  it("rejects a non-numeric value", () => {
    const r = validateFermentReading({ ...validRaw(), value: "acidic" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.value).toBeDefined();
  });

  it("rejects a pH outside the 0–14 range", () => {
    const r = validateFermentReading({ ...validRaw(), kind: "ph", value: "15" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.value).toMatch(/ph|0|14/i);
  });

  it("rejects a non-ISO occurredAt", () => {
    const r = validateFermentReading({ ...validRaw(), occurredAt: "soon" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.occurredAt).toBeDefined();
  });
});

describe("recordFermentReading", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await recordFermentReading(store, { ...validRaw(), batchId: "" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls record_ferment_reading EXACTLY ONCE with the snake_case envelope", async () => {
    const { store, rpc } = fakeStore({ data: 7, error: null });
    const result = await recordFermentReading(store, validRaw());
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_ferment_reading", {
      p_batch_id: "00000000-0000-0000-0000-0000000000b1",
      p_kind: "ph",
      p_value: 5.4,
      p_occurred_at: "2026-06-20T08:00:00.000Z",
      p_device_id: "server-ferment",
      p_device_seq: 10,
      p_idempotency_key: "rd-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.readingId).toBe(7);
  });

  it("maps an unknown-batch foreign_key_violation to a FRIENDLY message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        message: 'unknown ferment batch 00000000-…',
        code: "23503",
      },
    });
    const result = await recordFermentReading(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/batch|exist|found/i);
      expect(result.message).not.toMatch(/foreign key constraint/i);
    }
  });

  it("maps a (device_id, device_seq) unique_violation to a FRIENDLY retry message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        message:
          'duplicate key value violates unique constraint "ferment_readings_device_id_device_seq_key"',
        code: "23505",
      },
    });
    const result = await recordFermentReading(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/again|retry|already/i);
      expect(result.message).not.toMatch(/duplicate key value/i);
    }
  });

  it("surfaces a labelled error for any other RPC failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "connection reset", code: "08006" },
    });
    const result = await recordFermentReading(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("record_ferment_reading");
  });
});
