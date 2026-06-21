import { describe, expect, it, vi } from "vitest";

import {
  recordDispatchAck,
  validateRecordDispatchAck,
  type RecordDispatchAckStore,
} from "@/lib/db/commands/recordDispatchAck";

/**
 * Pure-domain command test for the INJECTION-SAFE INBOUND writer (P2-S5,
 * ADR-002 — every write flows through a SECURITY DEFINER command RPC). This file
 * does NOT touch a database: it drives the command against a *fake store* (a
 * hand-rolled stub of the one method the command calls,
 * `.rpc('record_dispatch_ack', …)`), so it can prove the friendly-validation seam
 * and the exactly-once contract SHAPE in the fast jsdom loop. The RPC returns a
 * bigint ack id.
 *
 * 🚨 INJECTION INVARIANT (asserted here as a contract test): this command is the
 * sole inbound writer and records EVIDENCE ONLY — it can never drive a domain
 * action. The optional, untrusted `workerId` is forwarded verbatim (or null for
 * an unknown sender); nothing here interprets inbound text into an action.
 *
 * Mirrors the Supabase-client mock idiom in
 * src/lib/db/commands/__tests__/enrollCrewMember.test.ts.
 */

/** Build a fake RecordDispatchAckStore whose `.rpc()` resolves to a fixed result. */
function fakeStore(
  result: { data: number | null; error: { message: string } | null },
): { store: RecordDispatchAckStore; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as RecordDispatchAckStore, rpc };
}

/** A complete, valid raw ack — the happy-path baseline each case tweaks. */
const validRaw = (): Record<string, unknown> => ({
  runId: "42",
  workerId: "w-lucia",
  channel: "whatsapp-inbound",
  occurredAt: "2026-06-20T06:10:00.000Z",
  deviceId: "server",
  deviceSeq: "1",
  idempotencyKey: "ack-2026-06-20-run-42-001",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateRecordDispatchAck", () => {
  it("accepts a complete, well-formed ack", () => {
    const r = validateRecordDispatchAck(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.runId).toBe(42);
      expect(r.data.workerId).toBe("w-lucia");
      expect(r.data.channel).toBe("whatsapp-inbound");
      expect(r.data.deviceSeq).toBe(1);
    }
  });

  it("accepts an ack from an UNKNOWN sender (workerId is optional → null)", () => {
    const raw = validRaw();
    delete raw.workerId;
    const r = validateRecordDispatchAck(raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.workerId).toBeNull();
  });

  it("treats a blank workerId as an unknown sender (null), not an error", () => {
    const r = validateRecordDispatchAck({ ...validRaw(), workerId: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.workerId).toBeNull();
  });

  it("accepts a free-text channel (not an enum — any inbound source label)", () => {
    for (const channel of ["whatsapp-inbound", "sms-inbound", "manual"]) {
      const r = validateRecordDispatchAck({ ...validRaw(), channel });
      expect(r.ok).toBe(true);
    }
  });

  it("rejects a missing channel", () => {
    const r = validateRecordDispatchAck({ ...validRaw(), channel: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.channel).toBeDefined();
  });

  it("rejects a missing run id", () => {
    const r = validateRecordDispatchAck({ ...validRaw(), runId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.runId).toBeDefined();
  });

  it("rejects a non-integer / non-positive run id", () => {
    expect(validateRecordDispatchAck({ ...validRaw(), runId: "0" }).ok).toBe(false);
    expect(validateRecordDispatchAck({ ...validRaw(), runId: "-1" }).ok).toBe(false);
    expect(validateRecordDispatchAck({ ...validRaw(), runId: "1.5" }).ok).toBe(false);
  });

  it("rejects a non-ISO occurredAt timestamp", () => {
    const r = validateRecordDispatchAck({ ...validRaw(), occurredAt: "not-a-date" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.occurredAt).toBeDefined();
  });

  it("rejects a missing device id", () => {
    const r = validateRecordDispatchAck({ ...validRaw(), deviceId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.deviceId).toBeDefined();
  });

  it("rejects a negative / non-integer device sequence", () => {
    expect(validateRecordDispatchAck({ ...validRaw(), deviceSeq: "-1" }).ok).toBe(false);
    expect(validateRecordDispatchAck({ ...validRaw(), deviceSeq: "1.5" }).ok).toBe(false);
  });

  it("rejects a blank idempotency key (the exactly-once anchor)", () => {
    const r = validateRecordDispatchAck({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });

  it("collects multiple field errors at once", () => {
    const r = validateRecordDispatchAck({
      ...validRaw(),
      runId: "",
      channel: "",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(["channel", "runId"]);
    }
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("recordDispatchAck", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });

    const result = await recordDispatchAck(store, { ...validRaw(), channel: "" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.channel).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls record_dispatch_ack EXACTLY ONCE with the snake_case arg envelope", async () => {
    const { store, rpc } = fakeStore({ data: 7, error: null });

    const result = await recordDispatchAck(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_dispatch_ack", {
      p_run_id: 42,
      p_worker_id: "w-lucia",
      p_channel: "whatsapp-inbound",
      p_occurred_at: "2026-06-20T06:10:00.000Z",
      p_device_id: "server",
      p_device_seq: 1,
      p_idempotency_key: "ack-2026-06-20-run-42-001",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ackId).toBe(7);
  });

  it("forwards p_worker_id as null when no sender is supplied (unknown sender)", async () => {
    const { store, rpc } = fakeStore({ data: 7, error: null });
    const raw = validRaw();
    delete raw.workerId;

    await recordDispatchAck(store, raw);

    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_worker_id).toBeNull();
  });

  it("surfaces a labelled error when the RPC fails", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "unknown dispatch run 42" },
    });

    const result = await recordDispatchAck(store, validRaw());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("record_dispatch_ack");
      expect(result.message).toContain("unknown dispatch run");
    }
  });

  it("surfaces a labelled error when the RPC returns no ack id", async () => {
    const { store } = fakeStore({ data: null, error: null });

    const result = await recordDispatchAck(store, validRaw());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("record_dispatch_ack");
  });

  it("is exactly-once by key: a replay forwards the identical idempotencyKey", async () => {
    const { store, rpc } = fakeStore({ data: 7, error: null });
    const raw = validRaw();

    const first = await recordDispatchAck(store, raw);
    const second = await recordDispatchAck(store, raw);

    expect(first.ok && second.ok).toBe(true);
    const firstArgs = rpc.mock.calls[0][1] as Record<string, unknown>;
    const secondArgs = rpc.mock.calls[1][1] as Record<string, unknown>;
    expect(firstArgs.p_idempotency_key).toBe(secondArgs.p_idempotency_key);
  });
});
