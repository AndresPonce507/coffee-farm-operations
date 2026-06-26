import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for a RESERVE price quote (P3-S0). The price comes from the
 * named, versioned `reserve_price_model` (base + coefficient × (score − pivot) +
 * scarcity), clamped to the `auction_comps` range — computed inside the SECURITY
 * DEFINER `quote_reserve_price` RPC, which snapshots cogs_per_lot, fires the margin
 * trigger, and appends a `reserve_priced` lot_event in the same txn. It NEVER reads
 * the ICE "C" index (that's the commodity regime). An optional human override
 * replaces the model price but is STILL floored by the margin trigger.
 *
 * Symmetric twin of the read ports: a pure validator plus a thin command that calls
 * the one `.rpc()` it needs (the `QuoteReservePriceStore` port), testable with no
 * database. Override + fx are OPTIONAL — blank forwards null so the RPC prices from
 * the model / defaults fx to 1. The idempotency key is REQUIRED.
 */

/** Validated, domain-shaped reserve-quote args (camelCase). */
export interface QuoteReservePriceInput {
  greenLotCode: string;
  /** Mass to price (kg) — the `kg > 0` CHECK guards it. */
  kg: number;
  /** Human override ($/kg, >= 0); null ⇒ the RPC prices from the model + comp clamp. */
  overrideUsdPerKg: number | null;
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
 * Pure validation of a raw reserve quote — mirrors the `quote_reserve_price` /
 * `price_quotes` constraints so errors surface before the round-trip (the model
 * clamp + margin trigger are the real enforcement). The override, if present, must
 * be >= 0 (the `unit_price >= 0` CHECK).
 */
export function validateQuoteReservePrice(
  raw: Record<string, unknown>,
): ValidationResult<QuoteReservePriceInput> {
  const errors: Record<string, string> = {};

  const greenLotCode = trimmed(raw.greenLotCode);
  if (!greenLotCode) errors.greenLotCode = "Choose a green lot.";

  const kg = toNumber(raw.kg);
  if (kg === null || kg <= 0) errors.kg = "Mass (kg) must be greater than 0.";

  // override: optional, but if provided must be >= 0.
  let overrideUsdPerKg: number | null = null;
  if (!isBlank(raw.overrideUsdPerKg)) {
    const o = toNumber(raw.overrideUsdPerKg);
    if (o === null || o < 0) {
      errors.overrideUsdPerKg = "An override price ($/kg) can't be negative.";
    } else {
      overrideUsdPerKg = o;
    }
  }

  const currency = trimmed(raw.currency) || "USD";

  // fx: optional, but if provided must be > 0.
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
      overrideUsdPerKg,
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

/** The narrow write port — exactly the one `.rpc()` method `quote_reserve_price` needs. */
export interface QuoteReservePriceStore {
  rpc(
    fn: "quote_reserve_price",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the quote id, or friendly/labelled errors. */
export type QuoteReservePriceResult =
  | { ok: true; quoteId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `quote_reserve_price` onto a family-readable sentence
 * — the model/clamp + margin trigger are the real guard, but the family must never
 * see raw PG text (constraint names, the `margin floor:` engine prefix, the table
 * name `reserve_price_model`). Returns null for anything unrecognised.
 */
export function friendlyQuoteReserveError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  if (/margin floor/.test(m)) {
    return "That price is below the minimum margin for this lot. Raise the price and try again.";
  }
  if (/reserve_price_model|reserve price model/.test(m)) {
    return "There's no reserve price model configured yet. Set one up before quoting reserve lots.";
  }
  if (error.code === "23503" || /unknown green lot|foreign key/.test(m)) {
    return "That green lot couldn't be found. Pick a lot from the list and try again.";
  }
  return null;
}

/**
 * Validate then quote: calls `quote_reserve_price` exactly once with the snake_case
 * argument envelope. Bad input never reaches the RPC (friendly errors); the margin
 * floor + missing-model failures surface as CLEAN sentences, any other failure
 * surfaces labelled. Exactly-once on `idempotencyKey`.
 */
export async function quoteReservePrice(
  store: QuoteReservePriceStore,
  raw: Record<string, unknown>,
): Promise<QuoteReservePriceResult> {
  const parsed = validateQuoteReservePrice(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("quote_reserve_price", {
    p_green_lot_code: parsed.data.greenLotCode,
    p_kg: parsed.data.kg,
    p_override_usd_per_kg: parsed.data.overrideUsdPerKg,
    p_currency: parsed.data.currency,
    p_fx_rate: parsed.data.fxRate,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyQuoteReserveError(error) ??
        "This lot couldn't be quoted right now. Please check the details and try again.",
    };
  }
  if (data == null) {
    return { ok: false, message: "This lot couldn't be quoted right now. Please try again." };
  }
  return { ok: true, quoteId: Number(data) };
}
