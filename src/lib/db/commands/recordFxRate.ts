import {
  isISODate,
  toNumber,
  trimmed,
  type ValidationResult,
} from "@/lib/validation/shared";

/**
 * Write-side command for posting a daily FX rate (P3-S16 — the accounting spine;
 * ADR-002 — all writes flow through a SECURITY DEFINER command RPC). `fx_rate` is
 * the canonical daily-rate SSOT: ONE place a rate lives, never hardcoded. Every
 * non-USD `revenue_entry`/`ar_payment` row's USD value must trace to a rate ON this
 * table — the migration's `_revenue_entry_fx_on_book` trigger rejects an off-book
 * rate. The single write door is `record_fx_rate` — tenant-clamped, idempotent on a
 * tenant-qualified key, append-only (the immutability triggers reject UPDATE/DELETE:
 * a correction is a NEW rate for the same day, never an edit). The free ECB daily
 * feed (a Supabase scheduled fn, NOT a paid FX API) calls this; manual entry is the
 * always-available $0 fallback (`source` 'manual').
 *
 * Symmetric twin of the read port (`@/lib/db/accounting`): a pure validator
 * (`validateRecordFxRate`, the friendly-error seam) plus a thin command
 * (`recordFxRate`) that calls the single `.rpc()` method it needs (the
 * `RecordFxRateStore` port) so it is testable against a fake store with no database.
 * The idempotency key is REQUIRED — the action/form layer mints a stable token
 * (mirrors recordIceCQuote / advanceProcessingStage).
 */

/** Where a rate came from — feed-agnostic; 'manual' is the $0 fallback. */
export const FX_SOURCES = ["ecb", "manual"] as const;
export type FxSource = (typeof FX_SOURCES)[number];

/** Validated, domain-shaped rate args (camelCase). */
export interface RecordFxRateInput {
  /** The rate's calendar day (ISO `YYYY-MM-DD`). */
  asOf: string;
  /** The base currency (3-letter ISO code, uppercased), e.g. "EUR". */
  base: string;
  /** The quote currency (3-letter ISO code, uppercased) — defaults to "USD". */
  quote: string;
  /** base→quote rate; the `rate > 0` CHECK guards it. */
  rate: number;
  /** Where the rate came from — defaults to 'manual'. */
  source: FxSource;
  /** Exactly-once anchor — the DB dedupes on a tenant-qualified key. */
  idempotencyKey: string;
}

/** Is `v` one of the recognised feed sources? */
function isFxSource(v: string): v is FxSource {
  return (FX_SOURCES as readonly string[]).includes(v);
}

/** A plausible ISO-4217 currency code: exactly three letters. */
const CURRENCY_RE = /^[A-Za-z]{3}$/;

/**
 * Pure validation of a raw rate — mirrors the `record_fx_rate` / `fx_rate`
 * constraints (a real calendar day, plausible currency codes, the rate > 0 CHECK,
 * the 'ecb'|'manual' source) so errors surface before the round-trip. The
 * append-only triggers + tenant clamp + on-book guard are the actual enforcement.
 * Currencies are uppercased so 'eur'/'EUR' resolve to the same SSOT row.
 */
export function validateRecordFxRate(
  raw: Record<string, unknown>,
): ValidationResult<RecordFxRateInput> {
  const errors: Record<string, string> = {};

  const asOf = trimmed(raw.asOf);
  if (!asOf) {
    errors.asOf = "A rate date is required.";
  } else if (!isISODate(asOf)) {
    errors.asOf = "Use a valid date (YYYY-MM-DD).";
  }

  const baseRaw = trimmed(raw.base);
  let base = "";
  if (!baseRaw) {
    errors.base = "A base currency is required.";
  } else if (!CURRENCY_RE.test(baseRaw)) {
    errors.base = "Use a 3-letter currency code (e.g. EUR).";
  } else {
    base = baseRaw.toUpperCase();
  }

  // Blank quote defaults to 'USD' (the home currency); a supplied code is validated.
  const quoteRaw = trimmed(raw.quote) || "USD";
  let quote = "";
  if (!CURRENCY_RE.test(quoteRaw)) {
    errors.quote = "Use a 3-letter currency code (e.g. USD).";
  } else {
    quote = quoteRaw.toUpperCase();
  }

  const rate = toNumber(raw.rate);
  if (rate === null || rate <= 0) {
    errors.rate = "The rate must be greater than 0.";
  }

  // Blank source defaults to 'manual'; a supplied value must be a known feed.
  const rawSource = trimmed(raw.source) || "manual";
  if (!isFxSource(rawSource)) {
    errors.source = "Choose a valid rate source.";
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      asOf,
      base,
      quote,
      rate: rate as number,
      source: rawSource as FxSource,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/**
 * The narrow write port the command depends on — exactly the one `.rpc()` method
 * `record_fx_rate` needs. A Supabase client satisfies this structurally; a
 * hand-rolled stub satisfies it in pure-domain tests.
 */
export interface RecordFxRateStore {
  rpc(
    fn: "record_fx_rate",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the posted rate's id, or friendly/labelled errors. */
export type RecordFxRateResult =
  | { ok: true; rateId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Validate then post: calls `record_fx_rate` exactly once with the snake_case
 * argument envelope the SECURITY DEFINER RPC expects. Bad input never reaches the
 * RPC (friendly errors); a failure surfaces as a labelled message (raw Postgres
 * text never leaks). Exactly-once on `idempotencyKey` — a replay returns the same
 * rate id with no second insert.
 */
export async function recordFxRate(
  store: RecordFxRateStore,
  raw: Record<string, unknown>,
): Promise<RecordFxRateResult> {
  const parsed = validateRecordFxRate(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("record_fx_rate", {
    p_as_of: parsed.data.asOf,
    p_base: parsed.data.base,
    p_quote: parsed.data.quote,
    p_rate: parsed.data.rate,
    p_source: parsed.data.source,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return { ok: false, message: `Couldn't record the FX rate: ${error.message}` };
  }
  if (data == null) {
    return {
      ok: false,
      message: "The FX rate couldn't be recorded. Please try again.",
    };
  }
  return { ok: true, rateId: Number(data) };
}
