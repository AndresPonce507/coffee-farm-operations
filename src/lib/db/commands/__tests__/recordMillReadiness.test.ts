import { describe, expect, it, vi } from "vitest";

import {
  recordMillReadiness,
  validateRecordMillReadiness,
  type RecordMillReadinessStore,
} from "@/lib/db/commands/recordMillReadiness";

/**
 * Pure-domain command test for the pre-mill readiness writer (P3-S7 — mill readiness +
 * run skeleton, the no-mill-out-of-spec gate; ADR-002 — every write flows through a
 * SECURITY DEFINER RPC). This file does NOT touch a database: it drives the command
 * against a *fake store* stubbing the one method it calls, `.rpc('record_mill_readiness', …)`,
 * and proves (a) the friendly-validation seam (moisture 0–100%, water-activity 0–1 aw —
 * the table's CHECK bounds, NOT the pass thresholds: a FAILING reading is still a valid
 * append, it just won't satisfy the gate; an OPTIONAL measured_at forwarded as null so the
 * RPC stamps now()), (b) the exact snake_case argument envelope, and (c) that a DB failure
 * surfaces a CLEAN, family-readable message (raw Postgres text never leaks). The append-only
 * insert + the reposo snapshot + the tenant clamp are the *real* enforcement (proven by the
 * migration's PGlite tests, not re-implemented here).
 *
 * Mirrors the established command-test idiom (recordIceCQuote.test.ts / logSample.test.ts):
 * the idempotency key is REQUIRED (the action/form layer mints a stable token).
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: RecordMillReadinessStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as RecordMillReadinessStore, rpc };
}

/** A complete, valid raw readiness measurement — the happy-path baseline each case tweaks. */
const validRaw = (): Record<string, unknown> => ({
  parchmentLotCode: "JC-204",
  moisturePct: "11",
  waterActivityAw: "0.55",
  measuredAt: "2026-06-24T08:00:00.000Z",
  idempotencyKey: "idem-readiness-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateRecordMillReadiness", () => {
  it("accepts a complete, well-formed (passing-spec) measurement", () => {
    const r = validateRecordMillReadiness(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.parchmentLotCode).toBe("JC-204");
      expect(r.data.moisturePct).toBe(11);
      expect(r.data.waterActivityAw).toBe(0.55);
      expect(r.data.measuredAt).toBe("2026-06-24T08:00:00.000Z");
      expect(r.data.idempotencyKey).toBe("idem-readiness-1");
    }
  });

  it("accepts an OUT-OF-SPEC reading (too wet) — a failing reading is still a valid append", () => {
    // moisture 12.4% / aw 0.62 won't satisfy the gate, but recording it is legitimate
    // (the append-only ledger documents the failure; the DB's GENERATED `passed` is the verdict).
    const r = validateRecordMillReadiness({
      ...validRaw(),
      moisturePct: "12.4",
      waterActivityAw: "0.62",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.moisturePct).toBe(12.4);
      expect(r.data.waterActivityAw).toBe(0.62);
    }
  });

  it("rejects a missing parchment lot", () => {
    const r = validateRecordMillReadiness({ ...validRaw(), parchmentLotCode: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.parchmentLotCode).toBeDefined();
  });

  it("rejects a non-numeric moisture", () => {
    const r = validateRecordMillReadiness({ ...validRaw(), moisturePct: "wet" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.moisturePct).toBeDefined();
  });

  it("rejects moisture outside the 0–100% CHECK bounds", () => {
    const low = validateRecordMillReadiness({ ...validRaw(), moisturePct: "-1" });
    expect(low.ok).toBe(false);
    if (!low.ok) expect(low.errors.moisturePct).toBeDefined();

    const high = validateRecordMillReadiness({ ...validRaw(), moisturePct: "101" });
    expect(high.ok).toBe(false);
    if (!high.ok) expect(high.errors.moisturePct).toBeDefined();
  });

  it("rejects a non-numeric water activity", () => {
    const r = validateRecordMillReadiness({ ...validRaw(), waterActivityAw: "dry" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.waterActivityAw).toBeDefined();
  });

  it("rejects water activity outside the 0–1 aw CHECK bounds", () => {
    const low = validateRecordMillReadiness({ ...validRaw(), waterActivityAw: "-0.1" });
    expect(low.ok).toBe(false);
    if (!low.ok) expect(low.errors.waterActivityAw).toBeDefined();

    const high = validateRecordMillReadiness({ ...validRaw(), waterActivityAw: "1.2" });
    expect(high.ok).toBe(false);
    if (!high.ok) expect(high.errors.waterActivityAw).toBeDefined();
  });

  it("treats a blank measured_at as 'not provided' (null → the RPC stamps now())", () => {
    const r = validateRecordMillReadiness({ ...validRaw(), measuredAt: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.measuredAt).toBeNull();
  });

  it("rejects a malformed measured_at when one is provided", () => {
    const r = validateRecordMillReadiness({ ...validRaw(), measuredAt: "yesterday" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.measuredAt).toBeDefined();
  });

  it("rejects a missing idempotency key", () => {
    const r = validateRecordMillReadiness({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("recordMillReadiness", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await recordMillReadiness(store, {
      ...validRaw(),
      parchmentLotCode: "",
    });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls record_mill_readiness with the exact snake_case envelope and returns the readiness id", async () => {
    const { store, rpc } = fakeStore({ data: 21, error: null });
    const result = await recordMillReadiness(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_mill_readiness", {
      p_parchment_lot_code: "JC-204",
      p_moisture_pct: 11,
      p_water_activity_aw: 0.55,
      p_measured_at: "2026-06-24T08:00:00.000Z",
      p_idempotency_key: "idem-readiness-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.readinessId).toBe(21);
  });

  it("forwards null measured_at when blank (the RPC stamps now())", async () => {
    const { store, rpc } = fakeStore({ data: 1, error: null });
    await recordMillReadiness(store, { ...validRaw(), measuredAt: "" });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_measured_at).toBeNull();
  });

  it("coerces a string id from PostgREST to a number", async () => {
    const { store } = fakeStore({ data: "9", error: null });
    const result = await recordMillReadiness(store, validRaw());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.readinessId).toBe(9);
  });

  it("surfaces an unknown parchment lot (FK violation) as a friendly message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        code: "23503",
        message:
          'insert or update on table "mill_readiness" violates foreign key constraint "mill_readiness_parchment_lot_tfk"',
      },
    });
    const result = await recordMillReadiness(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/couldn't be found|lot/i);
      expect(result.message).not.toMatch(/23503|foreign key constraint/);
    }
  });

  it("falls back to a labelled message for an unrecognised RPC failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "deadlock detected" },
    });
    const result = await recordMillReadiness(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBeTruthy();
      expect(result.message).not.toMatch(/deadlock detected/);
    }
  });
});
