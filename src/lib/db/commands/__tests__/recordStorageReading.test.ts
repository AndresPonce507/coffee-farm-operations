import { describe, expect, it, vi } from "vitest";

import {
  recordStorageReading,
  validateRecordStorageReading,
  type RecordStorageReadingStore,
} from "@/lib/db/commands/recordStorageReading";

/**
 * Pure-domain command test for the append-only environmental reading writer
 * (P3-S20 — `manual` is the $0 path; `lorawan-sensor` is the identical schema +
 * device id, a future ChirpStack gateway POSTing the same RPC; ADR-002). Drives
 * the command against a fake `.rpc('record_storage_reading', …)` store and proves:
 * (a) the friendly-validation seam (location + idempotency required; source enum
 * default 'manual'; aw ∈ [0,1] mirrored), (b) the exact snake_case envelope (a blank
 * reading time passes null so the RPC stamps now()), and (c) the unknown-location
 * rejection surfaces a clean message. Idempotency (a re-synced offline / duplicated
 * LoRaWAN uplink returns the same row) is the RPC's job (the migration's PGlite tests).
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: RecordStorageReadingStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as RecordStorageReadingStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  locationCode: "BODEGA-A",
  tempC: "21",
  rhPct: "58",
  aw: "0.61",
  source: "manual",
  deviceId: "",
  readingAt: "2026-06-21T09:00:00.000Z",
  idempotencyKey: "idem-read-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateRecordStorageReading", () => {
  it("accepts a complete, well-formed reading", () => {
    const r = validateRecordStorageReading(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.locationCode).toBe("BODEGA-A");
      expect(r.data.tempC).toBe(21);
      expect(r.data.rhPct).toBe(58);
      expect(r.data.aw).toBe(0.61);
      expect(r.data.source).toBe("manual");
      expect(r.data.readingAt).toBe("2026-06-21T09:00:00.000Z");
    }
  });

  it("defaults a blank source to 'manual'", () => {
    const r = validateRecordStorageReading({ ...validRaw(), source: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.source).toBe("manual");
  });

  it("accepts the lorawan-sensor source + a device id", () => {
    const r = validateRecordStorageReading({
      ...validRaw(),
      source: "lorawan-sensor",
      deviceId: "eui-0011223344",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.source).toBe("lorawan-sensor");
      expect(r.data.deviceId).toBe("eui-0011223344");
    }
  });

  it("rejects an unknown source enum value", () => {
    const r = validateRecordStorageReading({ ...validRaw(), source: "bluetooth" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.source).toBeDefined();
  });

  it("treats a blank reading time as 'not provided' (null → RPC stamps now())", () => {
    const r = validateRecordStorageReading({ ...validRaw(), readingAt: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.readingAt).toBeNull();
  });

  it("rejects a missing location code", () => {
    const r = validateRecordStorageReading({ ...validRaw(), locationCode: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.locationCode).toBeDefined();
  });

  it("rejects an aw outside [0,1] (mirrors the aw CHECK)", () => {
    const r = validateRecordStorageReading({ ...validRaw(), aw: "1.4" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.aw).toBeDefined();
  });

  it("treats blank measurements as null (a partial reading is legal)", () => {
    const r = validateRecordStorageReading({
      ...validRaw(),
      tempC: "21",
      rhPct: "",
      aw: "",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.tempC).toBe(21);
      expect(r.data.rhPct).toBeNull();
      expect(r.data.aw).toBeNull();
    }
  });

  it("rejects a missing idempotency key", () => {
    const r = validateRecordStorageReading({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("recordStorageReading", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await recordStorageReading(store, {
      ...validRaw(),
      locationCode: "",
    });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls record_storage_reading with the exact snake_case envelope and returns the id", async () => {
    const { store, rpc } = fakeStore({ data: 11, error: null });
    const result = await recordStorageReading(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_storage_reading", {
      p_location_code: "BODEGA-A",
      p_temp_c: 21,
      p_rh_pct: 58,
      p_aw: 0.61,
      p_source: "manual",
      p_device_id: null,
      p_reading_at: "2026-06-21T09:00:00.000Z",
      p_idempotency_key: "idem-read-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.readingId).toBe(11);
  });

  it("forwards a null p_reading_at when blank (RPC stamps now())", async () => {
    const { store, rpc } = fakeStore({ data: 12, error: null });
    await recordStorageReading(store, { ...validRaw(), readingAt: "" });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_reading_at).toBeNull();
  });

  it("surfaces the unknown-location rejection as a friendly message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        code: "23503",
        message: "unknown storage location BODEGA-Z for tenant",
      },
    });
    const result = await recordStorageReading(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/location|found/i);
      expect(result.message).not.toMatch(/foreign_key_violation/);
    }
  });

  it("falls back to a labelled message for an unrecognised RPC failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "deadlock detected" },
    });
    const result = await recordStorageReading(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });
});
