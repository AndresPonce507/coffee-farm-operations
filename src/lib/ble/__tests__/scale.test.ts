import { describe, expect, it, vi } from "vitest";

import {
  bleScaleSupported,
  decodeWeightMeasurement,
  readWeightKg,
  WEIGHT_MEASUREMENT_CHAR,
  WEIGHT_SCALE_SERVICE,
  type BluetoothLike,
  type ScaleReading,
} from "@/lib/ble/scale";

/**
 * BLE scale adapter (P2-S2) — the OPTIONAL hardware upgrade behind a port. The
 * load-bearing guarantee these tests pin: every code path resolves CLEANLY (never
 * throws), and an unsupported / cancelled / failed pair degrades to a labelled
 * result the UI uses to fall back to manual numeric entry. The Web Bluetooth surface
 * is injected so the whole flow runs in jsdom against a scripted fake — no device.
 */

/** Build a DataView for a GATT Weight Measurement (flags byte + LE uint16). */
function weightView(flags: number, raw: number): DataView {
  const buf = new ArrayBuffer(3);
  const dv = new DataView(buf);
  dv.setUint8(0, flags);
  dv.setUint16(1, raw, /* littleEndian */ true);
  return dv;
}

/** A fake BluetoothLike that yields the given measurement view on read. */
function fakeBluetooth(view: DataView): BluetoothLike {
  const characteristic = { readValue: vi.fn(async () => view) };
  const service = { getCharacteristic: vi.fn(async () => characteristic) };
  const server = {
    connect: vi.fn(async function (this: unknown) {
      return server;
    }),
    getPrimaryService: vi.fn(async () => service),
  };
  return {
    requestDevice: vi.fn(async () => ({ gatt: server })),
  } as unknown as BluetoothLike;
}

describe("decodeWeightMeasurement", () => {
  it("decodes an SI (kg) reading at 0.005 resolution", () => {
    // 12.4 kg / 0.005 = 2480
    const r: ScaleReading = decodeWeightMeasurement(weightView(0x00, 2480));
    expect(r.reportedUnit).toBe("kg");
    expect(r.kg).toBeCloseTo(12.4, 3);
  });

  it("decodes an Imperial (lb) reading and normalises to kg", () => {
    // flags bit0 = 1 (imperial); 27.34 lb / 0.01 = 2734 → 12.401 kg
    const r = decodeWeightMeasurement(weightView(0x01, 2734));
    expect(r.reportedUnit).toBe("lb");
    expect(r.kg).toBeCloseTo(27.34 * 0.45359237, 2);
  });
});

describe("bleScaleSupported", () => {
  it("false when there is no Web Bluetooth", () => {
    expect(bleScaleSupported(null)).toBe(false);
  });
  it("true when requestDevice exists", () => {
    expect(bleScaleSupported(fakeBluetooth(weightView(0, 2480)))).toBe(true);
  });
});

describe("readWeightKg", () => {
  it("pairs, reads, and resolves a kg reading (the happy upgrade path)", async () => {
    const bt = fakeBluetooth(weightView(0x00, 2480));
    const res = await readWeightKg(bt);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.reading.kg).toBeCloseTo(12.4, 3);
    // it requested the Weight Scale service + measurement characteristic.
    expect(bt.requestDevice).toHaveBeenCalledWith({
      filters: [{ services: [WEIGHT_SCALE_SERVICE] }],
    });
  });

  it("returns unsupported (NOT a throw) when Web Bluetooth is absent", async () => {
    const res = await readWeightKg(null);
    expect(res).toEqual({ ok: false, reason: "unsupported" });
  });

  it("treats a dismissed chooser as 'cancelled', not an error", async () => {
    const bt = {
      requestDevice: vi.fn(async () => {
        const e = new Error("User cancelled");
        e.name = "NotFoundError";
        throw e;
      }),
    } as unknown as BluetoothLike;
    const res = await readWeightKg(bt);
    expect(res).toEqual({ ok: false, reason: "cancelled" });
  });

  it("returns a clean labelled error on a pairing/read failure (no throw)", async () => {
    const bt = {
      requestDevice: vi.fn(async () => {
        throw new Error("GATT operation failed");
      }),
    } as unknown as BluetoothLike;
    const res = await readWeightKg(bt);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("error");
      expect(res.message).toMatch(/GATT/);
    }
  });

  it("exposes the standard GATT UUIDs", () => {
    expect(WEIGHT_SCALE_SERVICE).toBe(0x181d);
    expect(WEIGHT_MEASUREMENT_CHAR).toBe(0x2a9d);
  });
});
