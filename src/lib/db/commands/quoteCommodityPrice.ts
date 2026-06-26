import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for a COMMODITY price quote (P3-S0). The unit price is
 * ("C" + differential) routed through the convert_qty-backed lb→kg factor (never a
 * 2.2046 literal) — computed inside the SECURITY DEFINER `quote_commodity_price`
 * RPC, which snapshots cogs_per_lot, fires the data-layer guards, and appends a
 * `price_quoted` lot_event in the same txn.
 *
 * THE KEYSTONE the RPC's BEFORE-INSERT triggers enforce (the data layer, not just
 * this command): a Presidential/Specialty single-origin lot CANNOT be priced on the
 * commodity index (regime isolation), and a price below cost × (1 + the commodity
 * margin floor) is rejected. This command's job is the friendly-validation seam and
 * translating those rejections into clean, family-readable sentences.
 *
 * Symmetric twin of the read ports: a pure validator plus a thin command that calls
 * the one `.rpc()` it needs (the `QuoteCommodityPriceStore` port), testable with no
 * database. The differential + fx are OPTIONAL — blank forwards null so the RPC uses
 * the house default differential / fx 1. The idempotency key is REQUIRED.
 */

/** Validated, domain-shaped commodity-quote args (camelCase). */
export interface QuoteCommodityPriceInput {
  greenLotCode: string;
  /** Mass to price (kg) — the `kg > 0` CHECK guards it. */
  kg: number;
  /** ICE "C" contract month, e.g. "2026-12" — the RPC needs a live mark for it. */
  contractMonth: string;
  /** Differential to the index ($/lb); null ⇒ the RPC uses the house default. May be negative. */
  differentialUsdPerLb: number | null;
  /** Settlement currency — defaults to 'USD'. */
  currency: string;
  /** FX rate to USD (> 0); null ⇒ the RPC defaults to 1. */
  fxRate: number | null;
  idempotencyKey: string;
}

/** Is `v` blank (absent / empty after trim)? */
function isBlank(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "");
}

/**
 * Pure validation of a raw commodity quote — mirrors the `quote_commodity_price`
 * constraints so errors surface before the round-trip (the regime + margin triggers
 * are the real enforcement). A commodity quote MUST name a contract month (its "C"
 * leg); the differential may be negative (a low-grade discount to the index).
 */
export function validateQuoteCommodityPrice(
  raw: Record<string, unknown>,
): ValidationResult<QuoteCommodityPriceInput> {
  const errors: Record<string, string> = {};

  const greenLotCode = trimmed(raw.greenLotCode);
  if (!greenLotCode) errors.greenLotCode = "Choose a green lot.";

  const kg = toNumber(raw.kg);
  if (kg === null || kg <= 0) errors.kg = "Mass (kg) must be greater than 0.";

  const contractMonth = trimmed(raw.contractMonth);
  if (!contractMonth) {
    errors.contractMonth = "Choose an ICE \"C\" contract month.";
  }

  // differential: optional; any finite number (a discount differential is negative).
  let differentialUsdPerLb: number | null = null;
  if (!isBlank(raw.differentialUsdPerLb)) {
    const d = toNumber(raw.differentialUsdPerLb);
    if (d === null) errors.differentialUsdPerLb = "Differential must be a number.";
    else differentialUsdPerLb = d;
  }

  const currency = trimmed(raw.currency) || "USD";

  // fx: optional, but if provided must be > 0 (the fx_rate_to_usd > 0 CHECK).
  let fxRate: number | null = null;
  if (!isBlank(raw.fxRate)) {
    const f = toNumber(raw.fxRate);
    if (f === null || f <= 0) errors.fxRate = "FX rate must be greater than 0.";
    else fxRate = f;
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      greenLotCode,
      kg: kg as number,
      contractMonth,
      differentialUsdPerLb,
      currency,
      fxRate,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint quote id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method `quote_commodity_price` needs. */
export interface QuoteCommodityPriceStore {
  rpc(
    fn: "quote_commodity_price",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the quote id, or friendly/labelled errors. */
export type QuoteCommodityPriceResult =
  | { ok: true; quoteId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `quote_commodity_price` onto a family-readable
 * sentence — the triggers/RPC are the real guard, but the family must never see raw
 * PG text (constraint names, errcodes, the function body's `regime isolation:` /
 * `margin floor:` engine prefixes). Returns null for anything unrecognised so the
 * caller can fall back to a generic labelled message.
 */
export function friendlyQuoteCommodityError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  // THE KEYSTONE: a reserve-only single-origin lot can't be priced on the index.
  if (/regime isolation|reserve-only/.test(m)) {
    return "This lot is reserve-only (Presidential/Specialty single-origin) — it can't be priced on the commodity index. Use a reserve quote instead.";
  }
  // The margin floor — price below cost × (1 + the commodity floor).
  if (/margin floor/.test(m)) {
    return "That price is below the minimum margin for this lot. Raise the differential (or the price) and try again.";
  }
  // No live "C" mark for the contract month.
  if (/no ice .*mark|contract month/.test(m)) {
    return "There's no ICE \"C\" mark for that contract month yet. Post a current mark first, then quote.";
  }
  // Unknown green lot.
  if (error.code === "23503" || /unknown green lot|foreign key/.test(m)) {
    return "That green lot couldn't be found. Pick a lot from the list and try again.";
  }
  return null;
}

/**
 * Validate then quote: calls `quote_commodity_price` exactly once with the snake_case
 * argument envelope. Bad input never reaches the RPC (friendly errors); the data-layer
 * guards (regime isolation, margin floor, missing mark) surface as CLEAN, family-readable
 * sentences, any other failure surfaces labelled. Exactly-once on `idempotencyKey`.
 */
export async function quoteCommodityPrice(
  store: QuoteCommodityPriceStore,
  raw: Record<string, unknown>,
): Promise<QuoteCommodityPriceResult> {
  const parsed = validateQuoteCommodityPrice(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("quote_commodity_price", {
    p_green_lot_code: parsed.data.greenLotCode,
    p_kg: parsed.data.kg,
    p_contract_month: parsed.data.contractMonth,
    p_differential_usd_per_lb: parsed.data.differentialUsdPerLb,
    p_currency: parsed.data.currency,
    p_fx_rate: parsed.data.fxRate,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyQuoteCommodityError(error) ??
        "This lot couldn't be quoted right now. Please check the details and try again.",
    };
  }
  if (data == null) {
    return { ok: false, message: "This lot couldn't be quoted right now. Please try again." };
  }
  return { ok: true, quoteId: Number(data) };
}
