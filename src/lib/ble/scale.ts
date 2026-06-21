/**
 * BLE weight-scale adapter (P2-S2) — an OPTIONAL upgrade behind a port, so manual
 * numeric entry is always the shipped, guaranteed path.
 *
 * The hardware integration (a cheap BLE scale via Web Bluetooth `navigator.bluetooth`,
 * GATT Weight Scale profile 0x181D / Weight Measurement characteristic 0x2A9D) is the
 * one genuinely uncertain part of this slice (DESIGN P2-SPIKE-B). So everything here
 * is structured as a capability probe + a single `readWeightKg()` call that EITHER
 * resolves a reading OR fails cleanly — the UI treats BLE as a try-this button that
 * degrades to the numeric pad, never a blocker.
 *
 * Pure + testable: the Web Bluetooth surface is injected (`BluetoothLike`), so the
 * pairing/read flow is exercised in jsdom with a scripted fake — no real device.
 */

/** The GATT Weight Scale Service + Weight Measurement characteristic UUIDs. */
export const WEIGHT_SCALE_SERVICE = 0x181d;
export const WEIGHT_MEASUREMENT_CHAR = 0x2a9d;

/** A single scale reading. `kg` is always the canonical unit (we convert lb→kg). */
export interface ScaleReading {
  kg: number;
  /** The raw unit the device reported, for provenance. */
  reportedUnit: "kg" | "lb";
}

/** Outcome of a BLE read attempt — a reading, or a clean, labelled failure. */
export type ScaleResult =
  | { ok: true; reading: ScaleReading }
  | { ok: false; reason: "unsupported" | "cancelled" | "error"; message?: string };

/* ----------------------------------------------------------------------- */
/* Minimal structural slice of the Web Bluetooth API we depend on.         */
/* ----------------------------------------------------------------------- */

export interface BluetoothCharacteristicLike {
  readValue(): Promise<DataView>;
}
export interface BluetoothServiceLike {
  getCharacteristic(uuid: number): Promise<BluetoothCharacteristicLike>;
}
export interface BluetoothServerLike {
  connect(): Promise<BluetoothServerLike>;
  getPrimaryService(uuid: number): Promise<BluetoothServiceLike>;
}
export interface BluetoothDeviceLike {
  gatt?: BluetoothServerLike;
}
export interface BluetoothLike {
  requestDevice(options: unknown): Promise<BluetoothDeviceLike>;
}

/** Resolve the platform Web Bluetooth object, or null when unavailable. */
function platformBluetooth(): BluetoothLike | null {
  if (typeof navigator === "undefined") return null;
  const bt = (navigator as unknown as { bluetooth?: BluetoothLike }).bluetooth;
  return bt ?? null;
}

/** Is a BLE scale even possible on this device? (drives the "Try scale" affordance) */
export function bleScaleSupported(bt: BluetoothLike | null = platformBluetooth()): boolean {
  return bt !== null && typeof bt.requestDevice === "function";
}

/**
 * Decode a GATT Weight Measurement (0x2A9D) value. Per the spec: byte 0 is a flags
 * field whose bit 0 selects units (0 = SI/kg with 0.005 resolution, 1 = Imperial/lb
 * with 0.01 resolution); bytes 1–2 are a uint16 little-endian weight. We normalise to
 * kg. Exported pure so the byte math is unit-tested without any device.
 */
export function decodeWeightMeasurement(view: DataView): ScaleReading {
  const flags = view.getUint8(0);
  const imperial = (flags & 0x01) === 0x01;
  const raw = view.getUint16(1, /* littleEndian */ true);
  if (imperial) {
    const lb = raw * 0.01;
    return { kg: round3(lb * 0.45359237), reportedUnit: "lb" };
  }
  const kg = raw * 0.005;
  return { kg: round3(kg), reportedUnit: "kg" };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Pair a BLE scale and read one weight. Resolves a clean `ScaleResult` for EVERY
 * outcome (never throws) so the caller can fall straight back to manual entry:
 *   - unsupported  → no Web Bluetooth (the common case on the crew's cheap phones)
 *   - cancelled    → the chooser was dismissed (the user picked manual instead)
 *   - error        → a pairing/read failure (surface, then offer manual)
 */
export async function readWeightKg(
  bt: BluetoothLike | null = platformBluetooth(),
): Promise<ScaleResult> {
  if (!bleScaleSupported(bt) || bt === null) {
    return { ok: false, reason: "unsupported" };
  }
  try {
    const device = await bt.requestDevice({
      filters: [{ services: [WEIGHT_SCALE_SERVICE] }],
    });
    if (!device.gatt) {
      return { ok: false, reason: "error", message: "No GATT server on device." };
    }
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(WEIGHT_SCALE_SERVICE);
    const char = await service.getCharacteristic(WEIGHT_MEASUREMENT_CHAR);
    const value = await char.readValue();
    return { ok: true, reading: decodeWeightMeasurement(value) };
  } catch (err) {
    // The chooser dismissal rejects with a NotFoundError / AbortError on most
    // browsers — treat a user cancel distinctly from a real failure.
    const name = err instanceof Error ? err.name : "";
    if (name === "NotFoundError" || name === "AbortError") {
      return { ok: false, reason: "cancelled" };
    }
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : "BLE read failed.",
    };
  }
}
