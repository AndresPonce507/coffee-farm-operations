import { describe, expect, it, vi } from "vitest";

import {
  recordWeighIn,
  validateWeighIn,
  weighInRpcArgs,
  type WeighStore,
} from "@/lib/db/commands/recordWeighIn";

/**
 * Pure-domain command test for the weigh-in write (P2-S2 — THE GENESIS FIELD EVENT,
 * ADR-002: every write flows through a SECURITY DEFINER command RPC). This file does
 * NOT touch a database: it drives the command against a *fake store* (a stub of the
 * one method the command calls, `.rpc('record_weigh_in', …)`) so it proves the
 * friendly-validation seam + the exact snake_case envelope in the fast jsdom loop.
 * The SQL CHECK/raise (kg >= 0, the active-crew gate, exactly-once) is the *real*
 * enforcement; this pins the friendly errors the supervisor sees before the round-trip.
 */

/** Build a fake WeighStore whose `.rpc()` resolves to a fixed result. */
function fakeStore(result: {
  data: string | null;
  error: { message: string } | null;
}): { store: WeighStore; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as WeighStore, rpc };
}

/** A complete, valid raw weigh-in — the happy-path baseline each case tweaks. */
const validRaw = (): Record<string, unknown> => ({
  workerId: "w-lucia",
  plotId: "p-tizingal-alto",
  cherriesKg: "12.4",
  ripeness: "ripe",
  scaleSource: "manual",
  capturedLat: "8.777835",
  capturedLng: "-82.640344",
  occurredAt: "2026-06-21T15:00:00.000Z",
  deviceId: "dev-field-1",
  deviceSeq: "7",
  idempotencyKey: "weigh-2026-06-21-w-lucia-001",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateWeighIn", () => {
  it("accepts a complete, well-formed weigh-in (coercing kg/seq/lat/lng)", () => {
    const r = validateWeighIn(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.workerId).toBe("w-lucia");
      expect(r.data.cherriesKg).toBe(12.4);
      expect(r.data.ripeness).toBe("ripe");
      expect(r.data.scaleSource).toBe("manual");
      expect(r.data.capturedLat).toBeCloseTo(8.777835, 5);
      expect(r.data.deviceSeq).toBe(7);
      expect(r.data.brix).toBeNull();
    }
  });

  it("badges-the-picker error when workerId is blank", () => {
    const raw = validRaw();
    raw.workerId = "  ";
    const r = validateWeighIn(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.workerId).toMatch(/badge/i);
  });

  it("rejects a negative or non-numeric weight", () => {
    const neg = validateWeighIn({ ...validRaw(), cherriesKg: "-3" });
    expect(neg.ok).toBe(false);
    if (!neg.ok) expect(neg.errors.cherriesKg).toBeTruthy();
    const nan = validateWeighIn({ ...validRaw(), cherriesKg: "heavy" });
    expect(nan.ok).toBe(false);
  });

  // The slice invariant is "kg > 0"; the RPC + harvests CHECK both reject zero, so
  // the friendly validator must too (it enforced only `< 0`, letting zero through to
  // a raw downstream constraint). (D00 findings 4/7/8.)
  it("rejects a ZERO weight (kg > 0 invariant, not >= 0)", () => {
    const r = validateWeighIn({ ...validRaw(), cherriesKg: "0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.cherriesKg).toBeTruthy();
  });

  it("requires a recognised ripeness tap", () => {
    const r = validateWeighIn({ ...validRaw(), ripeness: "greenish" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.ripeness).toMatch(/ripeness/i);
  });

  it("defaults an absent/unknown scaleSource to manual (the always-available fallback)", () => {
    const a = validateWeighIn({ ...validRaw(), scaleSource: "" });
    expect(a.ok && a.data.scaleSource).toBe("manual");
    const b = validateWeighIn({ ...validRaw(), scaleSource: "bathroom-scale" });
    expect(b.ok && b.data.scaleSource).toBe("manual");
  });

  it("treats a missing GPS fix as null (geofence becomes a NULL signal, not an error)", () => {
    const raw = validRaw();
    delete raw.capturedLat;
    delete raw.capturedLng;
    const r = validateWeighIn(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.capturedLat).toBeNull();
      expect(r.data.capturedLng).toBeNull();
    }
  });

  it("accepts an optional brix probe reading", () => {
    const r = validateWeighIn({ ...validRaw(), brix: "21.5" });
    expect(r.ok && r.data.brix).toBe(21.5);
  });
});

// ─────────────────────────── envelope + command ────────────────────────────

describe("weighInRpcArgs", () => {
  it("maps the validated input to the exact snake_case RPC envelope", () => {
    const v = validateWeighIn(validRaw());
    if (!v.ok) throw new Error("fixture should validate");
    expect(weighInRpcArgs(v.data)).toEqual({
      p_worker_id: "w-lucia",
      p_plot_id: "p-tizingal-alto",
      p_cherries_kg: 12.4,
      p_ripeness: "ripe",
      p_brix: null,
      p_scale_source: "manual",
      p_captured_lat: expect.closeTo(8.777835, 5),
      p_captured_lng: expect.closeTo(-82.640344, 5),
      p_occurred_at: "2026-06-21T15:00:00.000Z",
      p_device_id: "dev-field-1",
      p_device_seq: 7,
      p_idempotency_key: "weigh-2026-06-21-w-lucia-001",
    });
  });
});

describe("recordWeighIn", () => {
  it("calls record_weigh_in once and returns the bound lot code", async () => {
    const { store, rpc } = fakeStore({ data: "JC-712", error: null });
    const res = await recordWeighIn(store, validRaw());
    expect(res).toEqual({ ok: true, lotCode: "JC-712" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "record_weigh_in",
      expect.objectContaining({ p_worker_id: "w-lucia", p_cherries_kg: 12.4 }),
    );
  });

  it("never reaches the RPC on invalid input (friendly errors only)", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const res = await recordWeighIn(store, { ...validRaw(), cherriesKg: "-1" });
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  // The cherry-intake twin maps raw PG errors to calm, family-readable messages so
  // "no raw constraint text reaches the family"; the weigh door (the higher-traffic
  // screen) must do the same. (D00 finding — friendlyRpcError seam.)
  it("maps the active-crew gate to a calm message (no raw SQL on the field screen)", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "worker w-x is not an active crew member" },
    });
    const res = await recordWeighIn(store, validRaw());
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toMatch(/active crew/i);
      expect(res.message).not.toMatch(/worker w-x/); // raw worker id never leaks
    }
  });

  it("maps a duplicate-key (23505) replay to a retry-safe message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        message:
          'duplicate key value violates unique constraint "weigh_event_device_id_device_seq_key"',
      },
    });
    const res = await recordWeighIn(store, validRaw());
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toMatch(/already recorded|already saved/i);
      expect(res.message).not.toMatch(/constraint|duplicate key/i);
    }
  });

  it("maps the kg check_violation to a friendly weight message (no harvests_cherries_pos leak)", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        message:
          'new row for relation "harvests" violates check constraint "harvests_cherries_pos"',
      },
    });
    const res = await recordWeighIn(store, validRaw());
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toMatch(/weight/i);
      expect(res.message).not.toMatch(/harvests_cherries_pos|check constraint/i);
    }
  });

  it("falls back to a calm generic message for an unmapped error (still labelled, no crash)", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "some unexpected backend hiccup" },
    });
    const res = await recordWeighIn(store, validRaw());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toBeTruthy();
  });

  it("the same idempotency key flows through unchanged (exactly-once anchor)", async () => {
    const { store, rpc } = fakeStore({ data: "JC-712", error: null });
    await recordWeighIn(store, validRaw());
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_idempotency_key).toBe("weigh-2026-06-21-w-lucia-001");
  });
});
