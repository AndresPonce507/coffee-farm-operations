import { describe, expect, it, vi } from "vitest";

import {
  markDispatchSent,
  validateMarkDispatchSent,
  type MarkDispatchSentStore,
} from "@/lib/db/commands/markDispatchSent";

/**
 * Pure-domain command test for the OWNER-INITIATED OUTBOUND "share the card"
 * transition (P2-S5, ADR-002 — every write flows through a SECURITY DEFINER
 * command RPC). This file does NOT touch a database: it drives the command
 * against a *fake store* (a hand-rolled stub of the one method the command calls,
 * `.rpc('mark_dispatch_sent', …)`), so it can prove the friendly-validation seam
 * and the exactly-once contract SHAPE in the fast jsdom loop. The SQL CHECK/raise
 * is the *real* enforcement; this test pins the friendly errors and the exact
 * snake_case argument envelope the RPC gets. The RPC returns a bigint run id.
 *
 * Mirrors the Supabase-client mock idiom in
 * src/lib/db/commands/__tests__/enrollCrewMember.test.ts.
 */

/** Build a fake MarkDispatchSentStore whose `.rpc()` resolves to a fixed result. */
function fakeStore(
  result: { data: number | null; error: { message: string } | null },
): { store: MarkDispatchSentStore; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as MarkDispatchSentStore, rpc };
}

/** A complete, valid raw mark-sent request — the happy-path baseline each case tweaks. */
const validRaw = (): Record<string, unknown> => ({
  runId: "42",
  channel: "web-share",
  occurredAt: "2026-06-20T05:35:00.000Z",
  deviceId: "server",
  deviceSeq: "1",
  idempotencyKey: "sent-2026-06-20-run-42-001",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateMarkDispatchSent", () => {
  it("accepts a complete, well-formed mark-sent request", () => {
    const r = validateMarkDispatchSent(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.runId).toBe(42);
      expect(r.data.channel).toBe("web-share");
      expect(r.data.deviceSeq).toBe(1);
    }
  });

  it("accepts every recognised delivery channel", () => {
    for (const channel of ["web-share", "copy-link", "whatsapp-cloud", "sms"]) {
      const r = validateMarkDispatchSent({ ...validRaw(), channel });
      expect(r.ok).toBe(true);
    }
  });

  it("rejects an unknown channel", () => {
    const r = validateMarkDispatchSent({ ...validRaw(), channel: "carrier-pigeon" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.channel).toBeDefined();
  });

  it("rejects a missing run id", () => {
    const r = validateMarkDispatchSent({ ...validRaw(), runId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.runId).toBeDefined();
  });

  it("rejects a non-integer / non-positive run id", () => {
    expect(validateMarkDispatchSent({ ...validRaw(), runId: "0" }).ok).toBe(false);
    expect(validateMarkDispatchSent({ ...validRaw(), runId: "-1" }).ok).toBe(false);
    expect(validateMarkDispatchSent({ ...validRaw(), runId: "1.5" }).ok).toBe(false);
  });

  it("rejects a non-ISO occurredAt timestamp", () => {
    const r = validateMarkDispatchSent({ ...validRaw(), occurredAt: "not-a-date" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.occurredAt).toBeDefined();
  });

  it("rejects a missing device id", () => {
    const r = validateMarkDispatchSent({ ...validRaw(), deviceId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.deviceId).toBeDefined();
  });

  it("rejects a negative / non-integer device sequence", () => {
    expect(validateMarkDispatchSent({ ...validRaw(), deviceSeq: "-1" }).ok).toBe(false);
    expect(validateMarkDispatchSent({ ...validRaw(), deviceSeq: "1.5" }).ok).toBe(false);
  });

  it("rejects a blank idempotency key (the exactly-once anchor)", () => {
    const r = validateMarkDispatchSent({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });

  it("collects multiple field errors at once", () => {
    const r = validateMarkDispatchSent({
      ...validRaw(),
      runId: "",
      channel: "nope",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(["channel", "runId"]);
    }
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("markDispatchSent", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });

    const result = await markDispatchSent(store, { ...validRaw(), channel: "nope" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.channel).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls mark_dispatch_sent EXACTLY ONCE with the snake_case arg envelope", async () => {
    const { store, rpc } = fakeStore({ data: 42, error: null });

    const result = await markDispatchSent(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("mark_dispatch_sent", {
      p_run_id: 42,
      p_channel: "web-share",
      p_occurred_at: "2026-06-20T05:35:00.000Z",
      p_device_id: "server",
      p_device_seq: 1,
      p_idempotency_key: "sent-2026-06-20-run-42-001",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.runId).toBe(42);
  });

  it("surfaces a labelled error when the RPC fails", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "unknown dispatch run 42" },
    });

    const result = await markDispatchSent(store, validRaw());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("mark_dispatch_sent");
      expect(result.message).toContain("unknown dispatch run");
    }
  });

  it("surfaces a labelled error when the RPC returns no run id", async () => {
    const { store } = fakeStore({ data: null, error: null });

    const result = await markDispatchSent(store, validRaw());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("mark_dispatch_sent");
  });

  it("is exactly-once by key: a replay forwards the identical idempotencyKey", async () => {
    const { store, rpc } = fakeStore({ data: 42, error: null });
    const raw = validRaw();

    const first = await markDispatchSent(store, raw);
    const second = await markDispatchSent(store, raw);

    expect(first.ok && second.ok).toBe(true);
    const firstArgs = rpc.mock.calls[0][1] as Record<string, unknown>;
    const secondArgs = rpc.mock.calls[1][1] as Record<string, unknown>;
    expect(firstArgs.p_idempotency_key).toBe(secondArgs.p_idempotency_key);
  });
});
