import { describe, expect, it, vi } from "vitest";

import {
  quoteReservePrice,
  validateQuoteReservePrice,
  type QuoteReservePriceStore,
} from "@/lib/db/commands/quoteReservePrice";

/**
 * Pure-domain command test for the reserve (model + comp-clamped, optional human
 * override) quote writer (P3-S0). Drives the command against a fake
 * `.rpc('quote_reserve_price', …)` store and proves the friendly-validation seam,
 * the exact snake_case argument envelope (override/fx forwarded as null when blank
 * so the RPC prices from the model), and clean error surfacing for the MARGIN
 * FLOOR and a missing reserve_price_model. The model/clamp + margin trigger are
 * the real enforcement (the migration's PGlite tests). Mirrors advanceProcessingStage.test.ts.
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: QuoteReservePriceStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as QuoteReservePriceStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  greenLotCode: "JC-701",
  kg: "30",
  overrideUsdPerKg: "",
  currency: "USD",
  fxRate: "1",
  idempotencyKey: "idem-rq-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateQuoteReservePrice", () => {
  it("accepts a complete, well-formed reserve quote (model-priced, no override)", () => {
    const r = validateQuoteReservePrice(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.greenLotCode).toBe("JC-701");
      expect(r.data.kg).toBe(30);
      expect(r.data.overrideUsdPerKg).toBeNull();
      expect(r.data.currency).toBe("USD");
      expect(r.data.fxRate).toBe(1);
    }
  });

  it("accepts a positive human override", () => {
    const r = validateQuoteReservePrice({
      ...validRaw(),
      overrideUsdPerKg: "500",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.overrideUsdPerKg).toBe(500);
  });

  it("rejects a negative override (the unit_price >= 0 CHECK)", () => {
    const r = validateQuoteReservePrice({
      ...validRaw(),
      overrideUsdPerKg: "-1",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.overrideUsdPerKg).toBeDefined();
  });

  it("treats a blank fx rate as null (RPC defaults to 1)", () => {
    const r = validateQuoteReservePrice({ ...validRaw(), fxRate: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.fxRate).toBeNull();
  });

  it("rejects a missing green lot", () => {
    const r = validateQuoteReservePrice({ ...validRaw(), greenLotCode: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.greenLotCode).toBeDefined();
  });

  it("rejects a non-positive kg", () => {
    const r = validateQuoteReservePrice({ ...validRaw(), kg: "0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.kg).toMatch(/greater than 0/i);
  });

  it("rejects a missing idempotency key", () => {
    const r = validateQuoteReservePrice({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("quoteReservePrice", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await quoteReservePrice(store, { ...validRaw(), kg: "0" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls quote_reserve_price with the exact snake_case envelope and returns the quote id", async () => {
    const { store, rpc } = fakeStore({ data: 202, error: null });
    const result = await quoteReservePrice(store, {
      ...validRaw(),
      overrideUsdPerKg: "500",
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("quote_reserve_price", {
      p_green_lot_code: "JC-701",
      p_kg: 30,
      p_override_usd_per_kg: 500,
      p_currency: "USD",
      p_fx_rate: 1,
      p_idempotency_key: "idem-rq-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.quoteId).toBe(202);
  });

  it("forwards null override + fx when blank (RPC prices from the model)", async () => {
    const { store, rpc } = fakeStore({ data: 1, error: null });
    await quoteReservePrice(store, {
      ...validRaw(),
      overrideUsdPerKg: "",
      fxRate: "",
    });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_override_usd_per_kg).toBeNull();
    expect(args.p_fx_rate).toBeNull();
  });

  it("surfaces the MARGIN FLOOR rejection as a friendly message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        code: "23514",
        message:
          "margin floor: 100/kg is below the reserve regime floor of 150/kg (cost 125/kg × (1 + 0.20))",
      },
    });
    const result = await quoteReservePrice(store, {
      ...validRaw(),
      overrideUsdPerKg: "100",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/margin|floor|below/i);
      expect(result.message).not.toMatch(/margin floor:/);
    }
  });

  it("surfaces a missing reserve_price_model as a friendly setup message", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "no reserve_price_model configured" },
    });
    const result = await quoteReservePrice(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/reserve price model|model|configure/i);
      expect(result.message).not.toMatch(/reserve_price_model/);
    }
  });

  it("falls back to a labelled message for an unrecognised RPC failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "deadlock detected" },
    });
    const result = await quoteReservePrice(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });
});
