import { describe, expect, it, vi } from "vitest";

import {
  quoteCommodityPrice,
  validateQuoteCommodityPrice,
  type QuoteCommodityPriceStore,
} from "@/lib/db/commands/quoteCommodityPrice";

/**
 * Pure-domain command test for the commodity ("C" + differential) quote writer
 * (P3-S0). Drives the command against a fake `.rpc('quote_commodity_price', …)`
 * store and proves the friendly-validation seam, the exact snake_case argument
 * envelope (optional differential/fx forwarded as null so the RPC defaults them),
 * and — the load-bearing cases — that the DATA-LAYER guards surface CLEAN, family-
 * readable errors instead of raw Postgres text:
 *   - the REGIME ISOLATION keystone (a reserve-only single-origin lot rejected),
 *   - the MARGIN FLOOR (price below cost × (1 + floor) rejected),
 *   - a missing ICE "C" mark for the contract month.
 * The triggers/RPC are the real enforcement (the migration's PGlite tests pin the
 * keystone); this proves the friendly surface. Mirrors advanceProcessingStage.test.ts.
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: QuoteCommodityPriceStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as QuoteCommodityPriceStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  greenLotCode: "JC-820",
  kg: "60",
  contractMonth: "2026-12",
  differentialUsdPerLb: "0.35",
  currency: "USD",
  fxRate: "1",
  idempotencyKey: "idem-cq-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateQuoteCommodityPrice", () => {
  it("accepts a complete, well-formed commodity quote", () => {
    const r = validateQuoteCommodityPrice(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.greenLotCode).toBe("JC-820");
      expect(r.data.kg).toBe(60);
      expect(r.data.contractMonth).toBe("2026-12");
      expect(r.data.differentialUsdPerLb).toBe(0.35);
      expect(r.data.currency).toBe("USD");
      expect(r.data.fxRate).toBe(1);
    }
  });

  it("treats a blank differential as 'not provided' (null → RPC uses the house default)", () => {
    const r = validateQuoteCommodityPrice({
      ...validRaw(),
      differentialUsdPerLb: "",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.differentialUsdPerLb).toBeNull();
  });

  it("allows a NEGATIVE differential (low-grade discount to the index)", () => {
    const r = validateQuoteCommodityPrice({
      ...validRaw(),
      differentialUsdPerLb: "-0.10",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.differentialUsdPerLb).toBe(-0.1);
  });

  it("treats a blank fx rate as 'not provided' (null → RPC defaults to 1)", () => {
    const r = validateQuoteCommodityPrice({ ...validRaw(), fxRate: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.fxRate).toBeNull();
  });

  it("defaults a blank currency to 'USD'", () => {
    const r = validateQuoteCommodityPrice({ ...validRaw(), currency: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.currency).toBe("USD");
  });

  it("rejects a missing green lot", () => {
    const r = validateQuoteCommodityPrice({ ...validRaw(), greenLotCode: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.greenLotCode).toBeDefined();
  });

  it("rejects a non-positive kg (the kg > 0 CHECK)", () => {
    const r = validateQuoteCommodityPrice({ ...validRaw(), kg: "0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.kg).toMatch(/greater than 0/i);
  });

  it("rejects a missing contract month (commodity needs an ICE 'C' leg)", () => {
    const r = validateQuoteCommodityPrice({ ...validRaw(), contractMonth: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.contractMonth).toBeDefined();
  });

  it("rejects a non-positive fx rate when provided (the fx_rate_to_usd > 0 CHECK)", () => {
    const r = validateQuoteCommodityPrice({ ...validRaw(), fxRate: "0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.fxRate).toBeDefined();
  });

  it("rejects a missing idempotency key", () => {
    const r = validateQuoteCommodityPrice({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("quoteCommodityPrice", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await quoteCommodityPrice(store, {
      ...validRaw(),
      greenLotCode: "",
    });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls quote_commodity_price with the exact snake_case envelope and returns the quote id", async () => {
    const { store, rpc } = fakeStore({ data: 101, error: null });
    const result = await quoteCommodityPrice(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("quote_commodity_price", {
      p_green_lot_code: "JC-820",
      p_kg: 60,
      p_contract_month: "2026-12",
      p_differential_usd_per_lb: 0.35,
      p_currency: "USD",
      p_fx_rate: 1,
      p_idempotency_key: "idem-cq-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.quoteId).toBe(101);
  });

  it("forwards null differential + fx when blank (RPC defaults them)", async () => {
    const { store, rpc } = fakeStore({ data: 1, error: null });
    await quoteCommodityPrice(store, {
      ...validRaw(),
      differentialUsdPerLb: "",
      fxRate: "",
    });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_differential_usd_per_lb).toBeNull();
    expect(args.p_fx_rate).toBeNull();
  });

  it("surfaces the REGIME ISOLATION keystone as a friendly reserve-only message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        code: "23514",
        message:
          "regime isolation: green lot JC-701 is Presidential-grade single-origin — cannot be priced on the commodity index (reserve-only)",
      },
    });
    const result = await quoteCommodityPrice(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/reserve/i);
      expect(result.message).not.toMatch(/regime isolation:|check_violation/);
    }
  });

  it("surfaces the MARGIN FLOOR rejection as a friendly message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        code: "23514",
        message:
          "margin floor: 10/kg is below the commodity regime floor of 13.75/kg (cost 12.5/kg × (1 + 0.10))",
      },
    });
    const result = await quoteCommodityPrice(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/margin|floor|below/i);
      expect(result.message).not.toMatch(/margin floor:/);
    }
  });

  it("surfaces a missing ICE 'C' mark as a friendly 'post a mark first' message", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: 'no ICE "C" mark for contract month 2026-12' },
    });
    const result = await quoteCommodityPrice(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/mark|contract month|C/);
  });

  it("falls back to a labelled message for an unrecognised RPC failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "deadlock detected" },
    });
    const result = await quoteCommodityPrice(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });
});
