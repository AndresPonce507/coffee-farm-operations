import { describe, expect, it, vi } from "vitest";

import {
  recordAttendance,
  validateAttendance,
  type AttendanceStore,
} from "@/lib/db/commands/recordAttendance";

/**
 * Pure-domain command test for the attendance write (ADR-002 — every write
 * flows through a SECURITY DEFINER command RPC). This file does NOT touch a
 * database: it drives the command against a *fake store* (a hand-rolled stub of
 * the one method the command calls, `.rpc('record_attendance', …)`), so it can
 * prove the friendly-validation seam and the exactly-once contract SHAPE in the
 * fast jsdom loop. The SQL CHECK/raise is the *real* enforcement; this test pins
 * the friendly errors the family sees before the round-trip and the exact
 * snake_case argument envelope the RPC receives.
 *
 * Mirrors the Supabase-client mock idiom in src/lib/db/commands/__tests__/recordCherryIntake.test.ts
 * (a vi.fn() returning a configured `{ data, error }` PostgREST-shaped result).
 */

/** Build a fake AttendanceStore whose `.rpc()` resolves to a fixed result. */
function fakeStore(
  result: { data: string | null; error: { message: string } | null },
): { store: AttendanceStore; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as AttendanceStore, rpc };
}

/** A complete, valid raw attendance — the happy-path baseline each case tweaks. */
const validRaw = (): Record<string, unknown> => ({
  workerId: "w-lucia",
  eventKind: "clock-in",
  plotId: "p-tizingal-alto",
  occurredAt: "2026-06-20T14:03:00.000Z",
  deviceId: "server",
  deviceSeq: "1",
  idempotencyKey: "att-2026-06-20-w-lucia-001",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateAttendance", () => {
  it("accepts a complete, well-formed attendance event", () => {
    const r = validateAttendance(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.workerId).toBe("w-lucia");
      expect(r.data.eventKind).toBe("clock-in");
      expect(r.data.plotId).toBe("p-tizingal-alto");
      expect(r.data.deviceSeq).toBe(1);
    }
  });

  it("accepts an attendance event with no plot (plotId is optional)", () => {
    const raw = validRaw();
    delete raw.plotId;
    const r = validateAttendance(raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.plotId).toBeNull();
  });

  it("rejects a missing worker with a friendly error", () => {
    const r = validateAttendance({ ...validRaw(), workerId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.workerId).toMatch(/worker/i);
  });

  it("rejects an unknown event kind", () => {
    const r = validateAttendance({ ...validRaw(), eventKind: "lunch" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.eventKind).toBeDefined();
  });

  it("accepts every recognised event kind", () => {
    for (const kind of ["clock-in", "clock-out", "rest-day", "absent"]) {
      const r = validateAttendance({ ...validRaw(), eventKind: kind });
      expect(r.ok).toBe(true);
    }
  });

  it("rejects a non-ISO occurredAt timestamp", () => {
    const r = validateAttendance({ ...validRaw(), occurredAt: "not-a-date" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.occurredAt).toBeDefined();
  });

  it("rejects a missing device id", () => {
    const r = validateAttendance({ ...validRaw(), deviceId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.deviceId).toBeDefined();
  });

  it("rejects a negative / non-integer device sequence", () => {
    expect(validateAttendance({ ...validRaw(), deviceSeq: "-1" }).ok).toBe(false);
    expect(validateAttendance({ ...validRaw(), deviceSeq: "1.5" }).ok).toBe(false);
  });

  it("rejects a blank idempotency key (the exactly-once anchor)", () => {
    const r = validateAttendance({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });

  it("collects multiple field errors at once", () => {
    const r = validateAttendance({
      ...validRaw(),
      workerId: "",
      eventKind: "nope",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(["eventKind", "workerId"]);
    }
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("recordAttendance", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });

    const result = await recordAttendance(store, { ...validRaw(), workerId: "" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.workerId).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls record_attendance EXACTLY ONCE with the snake_case arg envelope", async () => {
    const { store, rpc } = fakeStore({ data: "evt-uuid-123", error: null });

    const result = await recordAttendance(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_attendance", {
      p_worker_id: "w-lucia",
      p_event_kind: "clock-in",
      p_plot_id: "p-tizingal-alto",
      p_occurred_at: "2026-06-20T14:03:00.000Z",
      p_device_id: "server",
      p_device_seq: 1,
      p_idempotency_key: "att-2026-06-20-w-lucia-001",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.eventUid).toBe("evt-uuid-123");
  });

  it("forwards p_plot_id as null when no plot is supplied", async () => {
    const { store, rpc } = fakeStore({ data: "evt-uuid-123", error: null });
    const raw = validRaw();
    delete raw.plotId;

    await recordAttendance(store, raw);

    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_plot_id).toBeNull();
  });

  it("surfaces a labelled error when the RPC fails", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "duplicate key value violates unique constraint" },
    });

    const result = await recordAttendance(store, validRaw());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("record_attendance");
      expect(result.message).toContain("duplicate key");
    }
  });

  it("is exactly-once by key: a replay forwards the identical idempotencyKey", async () => {
    const { store, rpc } = fakeStore({ data: "evt-uuid-123", error: null });
    const raw = validRaw();

    const first = await recordAttendance(store, raw);
    const second = await recordAttendance(store, raw);

    expect(first.ok && second.ok).toBe(true);
    const firstArgs = rpc.mock.calls[0][1] as Record<string, unknown>;
    const secondArgs = rpc.mock.calls[1][1] as Record<string, unknown>;
    expect(firstArgs.p_idempotency_key).toBe(secondArgs.p_idempotency_key);
  });
});
