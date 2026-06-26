import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for the WIN write-back (P3-S4 — specialty auctions; ADR-002 —
 * all writes flow through a SECURITY DEFINER command RPC). `record_auction_result`
 * stamps the entry (jury score, clearing price, winning bidder, result year), flips
 * the auction to 'sold', and CLOSES THE LOOP into P3-S0: it posts an `auction_comps`
 * row (so the clearing price anchors the NEXT Geisha's reserve model) AND a reserve
 * `price_quotes` row that REUSES the existing auction reservation (never a second
 * claim → no double-sell). The single write door is tenant-clamped and idempotent on
 * the entry already being sold; it returns the entry id.
 *
 * Symmetric twin of the read ports: a pure validator plus a thin command that calls
 * the one `.rpc()` it needs (the `RecordAuctionResultStore` port), testable with no
 * database. Only `entryId` + `clearingPriceUsdPerKg` are required; the jury score,
 * winner and year are optional and forwarded as null when blank. The idempotency key
 * is REQUIRED. The positive-clearing-price rejection surfaces as a CLEAN sentence.
 */

/** Validated, domain-shaped result args (camelCase). Optionals null when blank. */
export interface RecordAuctionResultInput {
  /** The `auction_entries.id` that cleared (a positive integer). */
  entryId: number;
  /** The auction panel's headline verdict, 0–100, or null when not recorded. */
  juryScore: number | null;
  /** The hammer price, USD per kg (the RPC requires it > 0). */
  clearingPriceUsdPerKg: number;
  /** The winning bidder, or null when undisclosed. */
  winningBidder: string | null;
  /** The result year; null ⇒ the RPC stamps the current year. */
  resultYear: number | null;
  /** Exactly-once anchor — the DB dedupes on the entry already being sold. */
  idempotencyKey: string;
}

/** Is `v` blank (absent / empty after trim)? Optional fields treat blank as null. */
function isBlank(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "");
}

/** Trim to a non-empty string, or null when blank. */
function optionalText(v: unknown): string | null {
  const t = trimmed(v);
  return t === "" ? null : t;
}

/**
 * Pure validation of a raw result — mirrors the `record_auction_result` rule (a real
 * entry id, a clearing price > 0, jury score 0–100, an integer year) so errors
 * surface before the round-trip. The tenant clamp + the write-back's reservation
 * reuse are the actual enforcement (ADR-002).
 */
export function validateRecordAuctionResult(
  raw: Record<string, unknown>,
): ValidationResult<RecordAuctionResultInput> {
  const errors: Record<string, string> = {};

  const entryId = toNumber(raw.entryId);
  if (entryId === null || !Number.isInteger(entryId) || entryId <= 0) {
    errors.entryId = "Choose an auction entry to clear.";
  }

  const clearingPriceUsdPerKg = toNumber(raw.clearingPriceUsdPerKg);
  if (clearingPriceUsdPerKg === null || clearingPriceUsdPerKg <= 0) {
    errors.clearingPriceUsdPerKg = "The clearing price ($/kg) must be greater than 0.";
  }

  // jury score: optional, but if provided must be in [0, 100].
  let juryScore: number | null = null;
  if (!isBlank(raw.juryScore)) {
    const j = toNumber(raw.juryScore);
    if (j === null || j < 0 || j > 100) {
      errors.juryScore = "The jury score must be between 0 and 100.";
    } else {
      juryScore = j;
    }
  }

  // result year: optional, but if provided must be a whole year.
  let resultYear: number | null = null;
  if (!isBlank(raw.resultYear)) {
    const y = toNumber(raw.resultYear);
    if (y === null || !Number.isInteger(y)) {
      errors.resultYear = "Enter a four-digit year.";
    } else {
      resultYear = y;
    }
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      entryId: entryId as number,
      juryScore,
      clearingPriceUsdPerKg: clearingPriceUsdPerKg as number,
      winningBidder: optionalText(raw.winningBidder),
      resultYear,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint entry id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method `record_auction_result` needs. */
export interface RecordAuctionResultStore {
  rpc(
    fn: "record_auction_result",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the cleared entry's id, or friendly/labelled errors. */
export type RecordAuctionResultResult =
  | { ok: true; entryId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `record_auction_result` onto a family-readable
 * sentence (raw PG text / errcodes never reach the family). Returns null for
 * anything unrecognised so the caller falls back to a generic message.
 */
export function friendlyRecordAuctionResultError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  // The RPC's positive-clearing-price guard.
  if (/positive clearing price|clearing price/.test(m)) {
    return "A cleared auction lot needs a positive clearing price ($/kg).";
  }
  // Unknown entry.
  if (error.code === "23503" || /unknown auction entry|foreign key/.test(m)) {
    return "That auction entry couldn't be found. Refresh and try again.";
  }
  return null;
}

/**
 * Validate then record: calls `record_auction_result` exactly once with the
 * snake_case argument envelope. Bad input never reaches the RPC (friendly errors);
 * the positive-clearing-price rejection surfaces as a CLEAN sentence, any other
 * failure surfaces labelled. Idempotent — re-recording an already-sold entry returns
 * the same entry id with no second write-back.
 */
export async function recordAuctionResult(
  store: RecordAuctionResultStore,
  raw: Record<string, unknown>,
): Promise<RecordAuctionResultResult> {
  const parsed = validateRecordAuctionResult(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("record_auction_result", {
    p_entry_id: parsed.data.entryId,
    p_jury_score: parsed.data.juryScore,
    p_clearing_price_usd_per_kg: parsed.data.clearingPriceUsdPerKg,
    p_winning_bidder: parsed.data.winningBidder,
    p_result_year: parsed.data.resultYear,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyRecordAuctionResultError(error) ??
        `Couldn't record the auction result: ${error.message}`,
    };
  }
  if (data == null) {
    return { ok: false, message: "The auction result couldn't be recorded. Please try again." };
  }
  return { ok: true, entryId: Number(data) };
}
