import { describe, expect, it, vi } from "vitest";

import {
  recordFxRate,
  validateRecordFxRate,
  type RecordFxRateStore,
} from "@/lib/db/commands/recordFxRate";

/**
 * Pure-domain command test for the FX-rate writer (P3-S16 — the accounting spine;
 * ADR-002 — every write flows through a SECURITY DEFINER RPC). `record_fx_rate` is
 * the ONLY `fx_rate` writer: the canonical daily-rate SSOT a revenue/payment row's
 * USD value must trace to (the off-book-rate guard rejects any rate not on this
 * table). This file does NOT touch a database: it drives the command against a
 * *fake store* stubbing the one method it calls, `.rpc('record_fx_rate', …)`, and
 * proves (a) the friendly-validation seam (ISO date, 3-letter currency codes, the
 * rate > 0 CHECK, the 'ecb'|'manual' source default), (b) the exact snake_case
 * argument envelope (incl. the uppercased currencies + the 'USD' quote default), and
 * (c) that a DB failure surfaces a clean labelled message, never a raw Postgres
 * exception. The append-only immutability + the tenant clamp are the *real*
 * enforcement (proven by the migration's PGlite tests). Mirrors recordIceCQuote.
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** Build a fake store whose `.rpc()` resolves to a fixed result. */
function fakeStore(result: RpcResult): {
  store: RecordFxRateStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as RecordFxRateStore, rpc };
}

/** A complete, valid raw rate — the happy-path baseline each case tweaks. */
const validRaw = (): Record<string, unknown> => ({
  asOf: "2026-06-20",
  base: "EUR",
  quote: "USD",
  rate: "1.08",
  source: "ecb",
  idempotencyKey: "idem-fx-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateRecordFxRate", () => {
  it("accepts a complete, well-formed rate", () => {
    const r = validateRecordFxRate(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.asOf).toBe("2026-06-20");
      expect(r.data.base).toBe("EUR");
      expect(r.data.quote).toBe("USD");
      expect(r.data.rate).toBe(1.08);
      expect(r.data.source).toBe("ecb");
      expect(r.data.idempotencyKey).toBe("idem-fx-1");
    }
  });

  it("defaults a blank quote to 'USD'", () => {
    const r = validateRecordFxRate({ ...validRaw(), quote: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.quote).toBe("USD");
  });

  it("defaults a blank source to 'manual'", () => {
    const r = validateRecordFxRate({ ...validRaw(), source: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.source).toBe("manual");
  });

  it("accepts the 'ecb' and 'manual' sources", () => {
    for (const s of ["ecb", "manual"]) {
      const r = validateRecordFxRate({ ...validRaw(), source: s });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.source).toBe(s);
    }
  });

  it("rejects an unknown source value", () => {
    const r = validateRecordFxRate({ ...validRaw(), source: "bloomberg" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.source).toBeDefined();
  });

  it("uppercases the base and quote currency codes", () => {
    const r = validateRecordFxRate({ ...validRaw(), base: "eur", quote: "usd" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.base).toBe("EUR");
      expect(r.data.quote).toBe("USD");
    }
  });

  it("rejects a missing as-of date", () => {
    const r = validateRecordFxRate({ ...validRaw(), asOf: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.asOf).toBeDefined();
  });

  it("rejects a non-ISO as-of date", () => {
    const r = validateRecordFxRate({ ...validRaw(), asOf: "June 20 2026" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.asOf).toBeDefined();
  });

  it("rejects a missing base currency", () => {
    const r = validateRecordFxRate({ ...validRaw(), base: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.base).toBeDefined();
  });

  it("rejects a malformed base currency (not a 3-letter code)", () => {
    const r = validateRecordFxRate({ ...validRaw(), base: "EURO" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.base).toBeDefined();
  });

  it("rejects a non-positive rate (the rate > 0 CHECK)", () => {
    const zero = validateRecordFxRate({ ...validRaw(), rate: "0" });
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.errors.rate).toMatch(/greater than 0/i);

    const neg = validateRecordFxRate({ ...validRaw(), rate: "-1" });
    expect(neg.ok).toBe(false);
  });

  it("rejects a non-numeric rate", () => {
    const r = validateRecordFxRate({ ...validRaw(), rate: "par" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.rate).toBeDefined();
  });

  it("rejects a missing idempotency key", () => {
    const r = validateRecordFxRate({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("recordFxRate", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await recordFxRate(store, { ...validRaw(), base: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.base).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls record_fx_rate with the exact snake_case envelope and returns the rate id", async () => {
    const { store, rpc } = fakeStore({ data: 11, error: null });
    const result = await recordFxRate(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_fx_rate", {
      p_as_of: "2026-06-20",
      p_base: "EUR",
      p_quote: "USD",
      p_rate: 1.08,
      p_source: "ecb",
      p_idempotency_key: "idem-fx-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rateId).toBe(11);
  });

  it("forwards the defaulted 'USD' quote and 'manual' source when both are blank", async () => {
    const { store, rpc } = fakeStore({ data: 12, error: null });
    await recordFxRate(store, { ...validRaw(), quote: "", source: "" });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_quote).toBe("USD");
    expect(args.p_source).toBe("manual");
  });

  it("coerces a string id from PostgREST to a number", async () => {
    const { store } = fakeStore({ data: "13", error: null });
    const result = await recordFxRate(store, validRaw());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rateId).toBe(13);
  });

  it("surfaces a labelled error (never raw PG) when the RPC fails", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "permission denied for function record_fx_rate" },
    });
    const result = await recordFxRate(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBeTruthy();
      expect(result.message).toContain("permission denied");
    }
  });

  it("surfaces a labelled error when the RPC returns a null id", async () => {
    const { store } = fakeStore({ data: null, error: null });
    const result = await recordFxRate(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });
});
