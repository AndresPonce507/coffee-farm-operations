import { describe, expect, it, vi } from "vitest";

import {
  recordSampleVerdict,
  validateRecordSampleVerdict,
  type RecordSampleVerdictStore,
} from "@/lib/db/commands/recordSampleVerdict";

/**
 * Pure-domain command test for the B2B sample-VERDICT writer (P3-S2; ADR-002 — every
 * write flows through a SECURITY DEFINER RPC). This file does NOT touch a database: it
 * drives the command against a *fake store* stubbing the one method it calls,
 * `.rpc('record_sample_verdict', …)`, and proves (a) the friendly-validation seam (the
 * buyer_verdict enum approved|rejected|counter, an OPTIONAL buyer_score in [0,100]
 * forwarded as null when blank), (b) the exact snake_case argument envelope, and (c)
 * that a DB failure surfaces a CLEAN, family-readable message. The verdict is written by
 * the RPC AS OWNER (the `green_samples` table has no client UPDATE grant); 'sample_approved'
 * is appended ONLY on 'approved', and the RPC is idempotent (same verdict = no-op) — that
 * is the RPC's job, proven by the migration's PGlite tests; this proves the friendly surface.
 *
 * Mirrors the established command-test idiom (recordIceCQuote.test.ts / acceptQuote.test.ts):
 * the idempotency key is REQUIRED (the action/form layer mints a stable token).
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: RecordSampleVerdictStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as RecordSampleVerdictStore, rpc };
}

/** A complete, valid raw verdict — the happy-path baseline each case tweaks. */
const validRaw = (): Record<string, unknown> => ({
  sampleId: "12",
  buyerScore: "92.5",
  buyerVerdict: "approved",
  idempotencyKey: "idem-verdict-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateRecordSampleVerdict", () => {
  it("accepts a complete, well-formed approval", () => {
    const r = validateRecordSampleVerdict(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.sampleId).toBe(12);
      expect(r.data.buyerScore).toBe(92.5);
      expect(r.data.buyerVerdict).toBe("approved");
      expect(r.data.idempotencyKey).toBe("idem-verdict-1");
    }
  });

  it("accepts every buyer_verdict enum value", () => {
    for (const v of ["approved", "rejected", "counter"]) {
      const r = validateRecordSampleVerdict({ ...validRaw(), buyerVerdict: v });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.buyerVerdict).toBe(v);
    }
  });

  it("rejects an unknown buyer_verdict", () => {
    const r = validateRecordSampleVerdict({
      ...validRaw(),
      buyerVerdict: "maybe",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.buyerVerdict).toBeDefined();
  });

  it("rejects a missing buyer_verdict", () => {
    const r = validateRecordSampleVerdict({ ...validRaw(), buyerVerdict: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.buyerVerdict).toBeDefined();
  });

  it("treats a blank buyer_score as 'not provided' (null — a verdict without a number)", () => {
    const r = validateRecordSampleVerdict({ ...validRaw(), buyerScore: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.buyerScore).toBeNull();
  });

  it("accepts the score boundary values 0 and 100", () => {
    const lo = validateRecordSampleVerdict({ ...validRaw(), buyerScore: "0" });
    expect(lo.ok).toBe(true);
    if (lo.ok) expect(lo.data.buyerScore).toBe(0);

    const hi = validateRecordSampleVerdict({ ...validRaw(), buyerScore: "100" });
    expect(hi.ok).toBe(true);
    if (hi.ok) expect(hi.data.buyerScore).toBe(100);
  });

  it("rejects a buyer_score out of the [0,100] range (the CHECK)", () => {
    const over = validateRecordSampleVerdict({
      ...validRaw(),
      buyerScore: "101",
    });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.errors.buyerScore).toBeDefined();

    const under = validateRecordSampleVerdict({
      ...validRaw(),
      buyerScore: "-1",
    });
    expect(under.ok).toBe(false);
  });

  it("rejects a missing / non-positive sample id", () => {
    const blank = validateRecordSampleVerdict({ ...validRaw(), sampleId: "" });
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.errors.sampleId).toBeDefined();

    const zero = validateRecordSampleVerdict({ ...validRaw(), sampleId: "0" });
    expect(zero.ok).toBe(false);
  });

  it("rejects a missing idempotency key", () => {
    const r = validateRecordSampleVerdict({
      ...validRaw(),
      idempotencyKey: "",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("recordSampleVerdict", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await recordSampleVerdict(store, {
      ...validRaw(),
      buyerVerdict: "",
    });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls record_sample_verdict with the exact snake_case envelope and returns the sample id", async () => {
    const { store, rpc } = fakeStore({ data: 12, error: null });
    const result = await recordSampleVerdict(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_sample_verdict", {
      p_sample_id: 12,
      p_buyer_score: 92.5,
      p_buyer_verdict: "approved",
      p_idempotency_key: "idem-verdict-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sampleId).toBe(12);
  });

  it("forwards a null p_buyer_score when the score is blank (a verdict without a number)", async () => {
    const { store, rpc } = fakeStore({ data: 12, error: null });
    await recordSampleVerdict(store, { ...validRaw(), buyerScore: "" });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_buyer_score).toBeNull();
  });

  it("coerces a string id from PostgREST to a number", async () => {
    const { store } = fakeStore({ data: "12", error: null });
    const result = await recordSampleVerdict(store, validRaw());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sampleId).toBe(12);
  });

  it("surfaces an unknown sample as a friendly message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        code: "P0002",
        message: "sample 999 not found for this tenant",
      },
    });
    const result = await recordSampleVerdict(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/sample|couldn't be found/i);
      expect(result.message).not.toMatch(/P0002/);
    }
  });

  it("surfaces an invalid verdict raised by the RPC as a friendly message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        code: "23514",
        message: "invalid buyer_verdict: must be approved, rejected or counter",
      },
    });
    const result = await recordSampleVerdict(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/approved|rejected|counter|verdict/i);
      expect(result.message).not.toMatch(/23514/);
    }
  });

  it("falls back to a labelled message for an unrecognised RPC failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "deadlock detected" },
    });
    const result = await recordSampleVerdict(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });
});
