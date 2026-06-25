import { describe, expect, it, vi } from "vitest";

import {
  recordIceCQuote,
  validateRecordIceCQuote,
  type RecordIceCQuoteStore,
} from "@/lib/db/commands/recordIceCQuote";

/**
 * Pure-domain command test for the append-only ICE "C" mark writer (P3-S0 — the
 * dual-regime pricing core; ADR-002 — every write flows through a SECURITY DEFINER
 * RPC). This file does NOT touch a database: it drives the command against a *fake
 * store* stubbing the one method it calls, `.rpc('record_ice_c_quote', …)`, and
 * proves (a) the friendly-validation seam, (b) the exact snake_case argument
 * envelope (incl. the source-enum default + the optional `as_of` passing as null
 * so the RPC stamps `now()`), and (c) that a DB failure surfaces a clean labelled
 * message, never a raw Postgres exception. The append-only immutability + the
 * tenant clamp are the *real* enforcement (proven by the migration's PGlite tests).
 *
 * Mirrors the established command-test idiom in advanceProcessingStage.test.ts:
 * the idempotency key is REQUIRED (the action/form layer mints a stable token).
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** Build a fake store whose `.rpc()` resolves to a fixed result. */
function fakeStore(result: RpcResult): {
  store: RecordIceCQuoteStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as RecordIceCQuoteStore, rpc };
}

/** A complete, valid raw mark — the happy-path baseline each case tweaks. */
const validRaw = (): Record<string, unknown> => ({
  contractMonth: "2026-12",
  price: "1.85",
  source: "manual",
  asOf: "2026-06-20T10:00:00.000Z",
  idempotencyKey: "idem-mark-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateRecordIceCQuote", () => {
  it("accepts a complete, well-formed mark", () => {
    const r = validateRecordIceCQuote(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.contractMonth).toBe("2026-12");
      expect(r.data.price).toBe(1.85);
      expect(r.data.source).toBe("manual");
      expect(r.data.asOf).toBe("2026-06-20T10:00:00.000Z");
      expect(r.data.idempotencyKey).toBe("idem-mark-1");
    }
  });

  it("defaults a blank source to 'manual'", () => {
    const r = validateRecordIceCQuote({ ...validRaw(), source: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.source).toBe("manual");
  });

  it("accepts the feed source enum values", () => {
    for (const s of ["manual", "barchart-free", "investing-scrape"]) {
      const r = validateRecordIceCQuote({ ...validRaw(), source: s });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.source).toBe(s);
    }
  });

  it("rejects an unknown source enum value", () => {
    const r = validateRecordIceCQuote({ ...validRaw(), source: "bloomberg" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.source).toBeDefined();
  });

  it("treats a blank as_of as 'not provided' (null → RPC stamps now())", () => {
    const r = validateRecordIceCQuote({ ...validRaw(), asOf: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.asOf).toBeNull();
  });

  it("rejects a missing contract month", () => {
    const r = validateRecordIceCQuote({ ...validRaw(), contractMonth: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.contractMonth).toMatch(/month/i);
  });

  it("rejects a non-positive price (the price > 0 CHECK)", () => {
    const zero = validateRecordIceCQuote({ ...validRaw(), price: "0" });
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.errors.price).toMatch(/greater than 0/i);

    const neg = validateRecordIceCQuote({ ...validRaw(), price: "-1" });
    expect(neg.ok).toBe(false);
  });

  it("rejects a non-numeric price", () => {
    const r = validateRecordIceCQuote({ ...validRaw(), price: "cheap" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.price).toBeDefined();
  });

  it("rejects a missing idempotency key", () => {
    const r = validateRecordIceCQuote({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("recordIceCQuote", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await recordIceCQuote(store, {
      ...validRaw(),
      contractMonth: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.contractMonth).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls record_ice_c_quote with the exact snake_case envelope and returns the mark id", async () => {
    const { store, rpc } = fakeStore({ data: 7, error: null });
    const result = await recordIceCQuote(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_ice_c_quote", {
      p_contract_month: "2026-12",
      p_price: 1.85,
      p_source: "manual",
      p_as_of: "2026-06-20T10:00:00.000Z",
      p_idempotency_key: "idem-mark-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.markId).toBe(7);
  });

  it("forwards a null p_as_of when the mark time is blank (RPC stamps now())", async () => {
    const { store, rpc } = fakeStore({ data: 8, error: null });
    await recordIceCQuote(store, { ...validRaw(), asOf: "" });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_as_of).toBeNull();
  });

  it("coerces a string id from PostgREST to a number", async () => {
    const { store } = fakeStore({ data: "9", error: null });
    const result = await recordIceCQuote(store, validRaw());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.markId).toBe(9);
  });

  it("surfaces a labelled error (never raw PG) when the RPC fails", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "permission denied for table ice_c_quotes" },
    });
    const result = await recordIceCQuote(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBeTruthy();
      expect(result.message).toContain("permission denied");
    }
  });
});
