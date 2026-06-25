import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Server Actions call `await (await getSupabase()).rpc(...)` and then
// revalidatePath. Mock both: a single rpc spy whose result each test sets, and a
// no-op revalidatePath. next-intl/server is mocked globally in setup.ts, so
// getTranslations resolves the real EN copy — validation messages come back as the
// actual English strings the UI shows.
const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => Promise.resolve({ rpc: rpcMock }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  acceptQuoteAction,
  quoteCommodityPriceAction,
  quoteReservePriceAction,
} from "@/app/(app)/pricing/actions";

beforeEach(() => rpcMock.mockReset());
afterEach(() => vi.clearAllMocks());

const commodityInput = () => ({
  greenLotCode: "JC-902",
  kg: 100,
  contractMonth: "DEC25",
  differentialUsdPerLb: 0.35,
  currency: "USD",
  fxRate: 1,
  idempotencyKey: "idem-1",
});

describe("quoteCommodityPriceAction — validation seam", () => {
  it("rejects non-positive kg WITHOUT touching the database", async () => {
    const result = await quoteCommodityPriceAction({ ...commodityInput(), kg: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Kilograms must be greater than zero.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a missing contract month WITHOUT touching the database", async () => {
    const result = await quoteCommodityPriceAction({
      ...commodityInput(),
      contractMonth: "  ",
    });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("quoteCommodityPriceAction — command behaviour", () => {
  it("passes the EXACT snake_case p_ envelope to quote_commodity_price on the happy path", async () => {
    rpcMock.mockResolvedValue({ data: 7, error: null });
    const result = await quoteCommodityPriceAction(commodityInput());
    expect(result).toEqual({ ok: true, quoteId: 7 });
    expect(rpcMock).toHaveBeenCalledWith("quote_commodity_price", {
      p_green_lot_code: "JC-902",
      p_kg: 100,
      p_contract_month: "DEC25",
      p_differential_usd_per_lb: 0.35,
      p_currency: "USD",
      p_fx_rate: 1,
      p_idempotency_key: "idem-1",
    });
  });

  it("surfaces the author-written regime-isolation guard message verbatim (never a raw SQLSTATE leak)", async () => {
    const guard =
      "regime isolation: green lot JC-901 is Presidential-grade single-origin — cannot be priced on the commodity index (reserve-only)";
    rpcMock.mockResolvedValue({ data: null, error: { message: guard, code: "23514" } });
    const result = await quoteCommodityPriceAction(commodityInput());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(guard);
      expect(result.error).not.toMatch(/SQLSTATE|23514/);
    }
  });

  it("maps an unknown structural Postgres error to clean generic copy (no raw leak)", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'relation "price_quotes" does not exist', code: "42P01" },
    });
    const result = await quoteCommodityPriceAction(commodityInput());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Could not save that quote. Check the numbers and try again.");
      expect(result.error).not.toMatch(/relation|price_quotes/);
    }
  });
});

describe("quoteReservePriceAction — command behaviour", () => {
  it("passes a null override through to quote_reserve_price (take the modeled price)", async () => {
    rpcMock.mockResolvedValue({ data: 11, error: null });
    const result = await quoteReservePriceAction({
      greenLotCode: "JC-901",
      kg: 30,
      overrideUsdPerKg: null,
      currency: "USD",
      fxRate: 1,
      idempotencyKey: "idem-2",
    });
    expect(result).toEqual({ ok: true, quoteId: 11 });
    expect(rpcMock).toHaveBeenCalledWith("quote_reserve_price", {
      p_green_lot_code: "JC-901",
      p_kg: 30,
      p_override_usd_per_kg: null,
      p_currency: "USD",
      p_fx_rate: 1,
      p_idempotency_key: "idem-2",
    });
  });
});

describe("acceptQuoteAction — the money-shaped write", () => {
  it("rejects an empty buyer WITHOUT touching the database", async () => {
    const result = await acceptQuoteAction({
      quoteId: 7,
      buyer: "   ",
      idempotencyKey: "idem-3",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Enter the buyer's name to accept.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("passes the exact envelope to accept_quote and returns the reservation id", async () => {
    rpcMock.mockResolvedValue({ data: 555, error: null });
    const result = await acceptQuoteAction({
      quoteId: 7,
      buyer: "  Tokyo Roasters ",
      idempotencyKey: "idem-4",
    });
    expect(result).toEqual({ ok: true, reservationId: 555 });
    expect(rpcMock).toHaveBeenCalledWith("accept_quote", {
      p_quote_id: 7,
      p_buyer: "Tokyo Roasters",
      p_idempotency_key: "idem-4",
    });
  });

  it("surfaces the oversell guard message verbatim when the reservation would oversell", async () => {
    const guard =
      "oversell guard: committing 70 kg to green lot JC-901 would exceed its 50 kg available-to-promise (0 already committed)";
    rpcMock.mockResolvedValue({ data: null, error: { message: guard, code: "23514" } });
    const result = await acceptQuoteAction({
      quoteId: 7,
      buyer: "Bravo Coffee",
      idempotencyKey: "idem-5",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(guard);
  });
});
