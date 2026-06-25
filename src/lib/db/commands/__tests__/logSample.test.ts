import { describe, expect, it, vi } from "vitest";

import {
  logSample,
  validateLogSample,
  type LogSampleStore,
} from "@/lib/db/commands/logSample";

/**
 * Pure-domain command test for the B2B sample-dispatch writer (P3-S2 — sample
 * tracking + sample-approval-as-contract-prereq; ADR-002 — every write flows through
 * a SECURITY DEFINER RPC). This file does NOT touch a database: it drives the command
 * against a *fake store* stubbing the one method it calls, `.rpc('log_sample', …)`,
 * and proves (a) the friendly-validation seam (sample_kind enum, grams > 0, an
 * OPTIONAL buyer forwarded as null for a spec/type sample, optional courier/tracking),
 * (b) the exact snake_case argument envelope, and (c) that a DB failure surfaces a
 * CLEAN, family-readable message — load-bearing: a `pre_shipment` sample draws ATP via
 * a `lot_shipments` insert, so an over-draw hits the REUSED `prevent_oversell` guard and
 * must read as a plain sentence, never raw Postgres text. The append-only insert + the
 * tenant clamp are the *real* enforcement (proven by the migration's PGlite tests).
 *
 * Mirrors the established command-test idiom (acceptQuote.test.ts / quoteCommodityPrice.test.ts):
 * the idempotency key is REQUIRED (the action/form layer mints a stable token).
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: LogSampleStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as LogSampleStore, rpc };
}

/** A complete, valid raw sample dispatch — the happy-path baseline each case tweaks. */
const validRaw = (): Record<string, unknown> => ({
  greenLotCode: "JC-204",
  buyerId: "3",
  sampleKind: "pre_shipment",
  grams: "200",
  courier: "DHL Express",
  trackingNo: "JD0140290923",
  idempotencyKey: "idem-sample-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateLogSample", () => {
  it("accepts a complete, well-formed pre-shipment sample", () => {
    const r = validateLogSample(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.greenLotCode).toBe("JC-204");
      expect(r.data.buyerId).toBe(3);
      expect(r.data.sampleKind).toBe("pre_shipment");
      expect(r.data.grams).toBe(200);
      expect(r.data.courier).toBe("DHL Express");
      expect(r.data.trackingNo).toBe("JD0140290923");
      expect(r.data.idempotencyKey).toBe("idem-sample-1");
    }
  });

  it("accepts every sample_kind enum value", () => {
    for (const k of ["offer", "pre_shipment", "type", "arbitration"]) {
      const r = validateLogSample({ ...validRaw(), sampleKind: k });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.sampleKind).toBe(k);
    }
  });

  it("rejects an unknown sample_kind", () => {
    const r = validateLogSample({ ...validRaw(), sampleKind: "espresso" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.sampleKind).toBeDefined();
  });

  it("treats a blank buyer as 'not provided' (null → a spec/type sample)", () => {
    const r = validateLogSample({ ...validRaw(), buyerId: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.buyerId).toBeNull();
  });

  it("rejects a non-positive / non-integer buyer id when provided", () => {
    const zero = validateLogSample({ ...validRaw(), buyerId: "0" });
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.errors.buyerId).toBeDefined();

    const frac = validateLogSample({ ...validRaw(), buyerId: "3.5" });
    expect(frac.ok).toBe(false);
  });

  it("rejects a non-positive grams (the grams > 0 CHECK)", () => {
    const r = validateLogSample({ ...validRaw(), grams: "0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.grams).toMatch(/greater than 0/i);
  });

  it("rejects a non-numeric grams", () => {
    const r = validateLogSample({ ...validRaw(), grams: "heavy" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.grams).toBeDefined();
  });

  it("treats blank courier + tracking as 'not provided' (null)", () => {
    const r = validateLogSample({
      ...validRaw(),
      courier: "",
      trackingNo: "",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.courier).toBeNull();
      expect(r.data.trackingNo).toBeNull();
    }
  });

  it("rejects a missing green lot", () => {
    const r = validateLogSample({ ...validRaw(), greenLotCode: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.greenLotCode).toBeDefined();
  });

  it("rejects a missing idempotency key", () => {
    const r = validateLogSample({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("logSample", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await logSample(store, { ...validRaw(), greenLotCode: "" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls log_sample with the exact snake_case envelope and returns the sample id", async () => {
    const { store, rpc } = fakeStore({ data: 12, error: null });
    const result = await logSample(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("log_sample", {
      p_green_lot_code: "JC-204",
      p_buyer_id: 3,
      p_sample_kind: "pre_shipment",
      p_grams: 200,
      p_courier: "DHL Express",
      p_tracking_no: "JD0140290923",
      p_idempotency_key: "idem-sample-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sampleId).toBe(12);
  });

  it("forwards null buyer/courier/tracking when blank (a spec sample, no carrier)", async () => {
    const { store, rpc } = fakeStore({ data: 1, error: null });
    await logSample(store, {
      ...validRaw(),
      buyerId: "",
      courier: "",
      trackingNo: "",
    });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_buyer_id).toBeNull();
    expect(args.p_courier).toBeNull();
    expect(args.p_tracking_no).toBeNull();
  });

  it("coerces a string id from PostgREST to a number", async () => {
    const { store } = fakeStore({ data: "9", error: null });
    const result = await logSample(store, validRaw());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sampleId).toBe(9);
  });

  it("surfaces the REUSED oversell guard (pre-shipment ATP over-draw) as a friendly message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        code: "P0001",
        message:
          "oversell guard: drawing 200 g would exceed available-to-promise on green lot JC-204",
      },
    });
    const result = await logSample(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/available|enough|sample/i);
      expect(result.message).not.toMatch(/oversell guard:|P0001/);
    }
  });

  it("surfaces an unknown green lot as a friendly message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        code: "23503",
        message:
          'insert or update on table "green_samples" violates foreign key constraint',
      },
    });
    const result = await logSample(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/couldn't be found|lot|buyer/i);
  });

  it("falls back to a labelled message for an unrecognised RPC failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "deadlock detected" },
    });
    const result = await logSample(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });
});
