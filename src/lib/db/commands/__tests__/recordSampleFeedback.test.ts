import { describe, expect, it, vi } from "vitest";

import {
  recordSampleFeedback,
  validateRecordSampleFeedback,
  type RecordSampleFeedbackStore,
} from "@/lib/db/commands/recordSampleFeedback";

/**
 * Pure-domain command test for the buyer's cup verdict on a dispatched sample
 * (P3-S18; ADR-002). `record_sample_feedback` appends an APPEND-ONLY
 * 'sample_feedback' event onto the contact timeline (the dispatch row is immutable;
 * a verdict is new evidence, never a column rewrite) and returns the event uid as a
 * uuid string. The verdict is constrained to approved|rejected|counter (mirrored
 * client-side; the RPC CHECK is the real enforcement). Score/notes are optional.
 * Drives the command against a fake `.rpc('record_sample_feedback', …)` store and
 * proves the validation seam + the exact snake_case argument envelope.
 */

interface RpcResult {
  data: string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: RecordSampleFeedbackStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as RecordSampleFeedbackStore, rpc };
}

const EVENT_UID = "22222222-2222-2222-2222-222222222222";

const validRaw = (): Record<string, unknown> => ({
  sampleDispatchId: "5",
  score: "88.5",
  verdict: "approved",
  notes: "Bright jasmine, will contract.",
  idempotencyKey: "idem-fb-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateRecordSampleFeedback", () => {
  it("accepts a complete, well-formed feedback", () => {
    const r = validateRecordSampleFeedback(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.sampleDispatchId).toBe(5);
      expect(r.data.score).toBe(88.5);
      expect(r.data.verdict).toBe("approved");
      expect(r.data.notes).toBe("Bright jasmine, will contract.");
      expect(r.data.idempotencyKey).toBe("idem-fb-1");
    }
  });

  it("accepts each verdict enum value", () => {
    for (const v of ["approved", "rejected", "counter"]) {
      const r = validateRecordSampleFeedback({ ...validRaw(), verdict: v });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.verdict).toBe(v);
    }
  });

  it("rejects an unknown verdict", () => {
    const r = validateRecordSampleFeedback({ ...validRaw(), verdict: "maybe" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.verdict).toBeDefined();
  });

  it("treats a blank score as null (a verdict can stand without a number)", () => {
    const r = validateRecordSampleFeedback({ ...validRaw(), score: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.score).toBeNull();
  });

  it("treats blank notes as null", () => {
    const r = validateRecordSampleFeedback({ ...validRaw(), notes: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.notes).toBeNull();
  });

  it("rejects a missing / non-positive sample dispatch id", () => {
    const r = validateRecordSampleFeedback({
      ...validRaw(),
      sampleDispatchId: "0",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.sampleDispatchId).toBeDefined();
  });

  it("rejects a non-numeric score when one is supplied", () => {
    const r = validateRecordSampleFeedback({ ...validRaw(), score: "great" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.score).toBeDefined();
  });

  it("rejects a missing idempotency key", () => {
    const r = validateRecordSampleFeedback({
      ...validRaw(),
      idempotencyKey: "",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("recordSampleFeedback", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await recordSampleFeedback(store, {
      ...validRaw(),
      verdict: "maybe",
    });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls record_sample_feedback with the exact snake_case envelope and returns the event uid", async () => {
    const { store, rpc } = fakeStore({ data: EVENT_UID, error: null });
    const result = await recordSampleFeedback(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_sample_feedback", {
      p_sample_dispatch_id: 5,
      p_score: 88.5,
      p_verdict: "approved",
      p_notes: "Bright jasmine, will contract.",
      p_idempotency_key: "idem-fb-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.eventUid).toBe(EVENT_UID);
  });

  it("forwards a null score/notes when blank", async () => {
    const { store, rpc } = fakeStore({ data: EVENT_UID, error: null });
    await recordSampleFeedback(store, { ...validRaw(), score: "", notes: "" });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_score).toBeNull();
    expect(args.p_notes).toBeNull();
  });

  it("surfaces a labelled error (never raw PG) when the RPC fails", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "unknown sample dispatch 5 for tenant" },
    });
    const result = await recordSampleFeedback(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });
});
