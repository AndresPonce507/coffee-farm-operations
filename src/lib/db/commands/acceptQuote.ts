import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for ACCEPTING a price quote (P3-S0). Accepting flips the
 * quote to 'accepted' and — the load-bearing step — INSERTS a `lot_reservations`
 * row inside the SECURITY DEFINER `accept_quote` RPC. That insert fires the
 * EXISTING `prevent_oversell` + `_prevent_held_lot_commit` BEFORE-INSERT triggers:
 * the money guarantee is REUSED, not rebuilt (no parallel counter, no new hold
 * guard). An over-commit or a QC-held lot rolls the WHOLE transaction back — the
 * quote stays 'quoted'. The RPC appends a `price_accepted` lot_event and is
 * idempotent on a tenant-qualified key (a replay returns the same reservation id).
 *
 * Symmetric twin of the read ports: a pure validator plus a thin command that calls
 * the one `.rpc()` it needs (the `AcceptQuoteStore` port), testable with no database.
 * The idempotency key is REQUIRED. This command surfaces the fail-closed oversell /
 * QC-hold rejections as CLEAN, family-readable sentences.
 */

/** Validated, domain-shaped acceptance args (camelCase). */
export interface AcceptQuoteInput {
  /** The `price_quotes.id` being accepted (a positive integer). */
  quoteId: number;
  /** The buyer the reservation is held for. */
  buyer: string;
  /** Exactly-once anchor — the DB dedupes on a tenant-qualified key. */
  idempotencyKey: string;
}

/**
 * Pure validation of a raw acceptance — mirrors the `accept_quote` preconditions
 * (a real quote id, a buyer) so errors surface before the round-trip. The oversell
 * / QC-hold triggers fired by the reservation insert are the actual enforcement.
 */
export function validateAcceptQuote(
  raw: Record<string, unknown>,
): ValidationResult<AcceptQuoteInput> {
  const errors: Record<string, string> = {};

  // Accept the quote id under `priceQuoteId` (the pricing UI's field convention,
  // matching `price_quotes.id`) OR the legacy `quoteId`.
  const quoteId = toNumber(raw.priceQuoteId ?? raw.quoteId);
  if (quoteId === null || !Number.isInteger(quoteId) || quoteId <= 0) {
    errors.quoteId = "Choose a quote to accept.";
  }

  const buyer = trimmed(raw.buyer);
  if (!buyer) errors.buyer = "A buyer is required.";

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: { quoteId: quoteId as number, buyer, idempotencyKey },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint reservation id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method `accept_quote` needs. */
export interface AcceptQuoteStore {
  rpc(
    fn: "accept_quote",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the reservation id, or friendly/labelled errors. */
export type AcceptQuoteResult =
  | { ok: true; reservationId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `accept_quote` onto a family-readable sentence —
 * the triggers/RPC are the real guard, but the family must never see raw PG text
 * (the `oversell guard:` / `qc-hold:` engine prefixes, errcodes). Returns null for
 * anything unrecognised so the caller can fall back to a generic labelled message.
 */
export function friendlyAcceptQuoteError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  // The REUSED money guarantee — the reservation insert hit prevent_oversell.
  if (/oversell|available-to-promise|would exceed|no declared mass/.test(m)) {
    return "There isn't enough available-to-promise on this lot to accept that quantity. Lower the kilograms or pick another lot.";
  }
  // The QC-hold commit block (_prevent_held_lot_commit).
  if (/qc-hold|open qc-hold|reserved or shipped/.test(m)) {
    return "This lot is under an open QC hold and can't be committed yet. Release the hold first.";
  }
  // The quote isn't in a state that can be accepted (already accepted/cancelled/superseded).
  if (/cannot be accepted from status/.test(m)) {
    return "This quote can't be accepted — it may already be accepted, superseded, or cancelled.";
  }
  // Unknown quote.
  if (error.code === "23503" || /unknown quote|foreign key/.test(m)) {
    return "That quote couldn't be found. Refresh and try again.";
  }
  return null;
}

/**
 * Validate then accept: calls `accept_quote` exactly once with the snake_case
 * argument envelope. Bad input never reaches the RPC (friendly errors); the
 * fail-closed oversell / QC-hold rejections surface as CLEAN sentences, any other
 * failure surfaces labelled. Exactly-once on `idempotencyKey` — a replay returns the
 * same reservation id with no second commit.
 */
export async function acceptQuote(
  store: AcceptQuoteStore,
  raw: Record<string, unknown>,
): Promise<AcceptQuoteResult> {
  const parsed = validateAcceptQuote(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("accept_quote", {
    p_quote_id: parsed.data.quoteId,
    p_buyer: parsed.data.buyer,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyAcceptQuoteError(error) ??
        "This quote couldn't be accepted right now. Please try again.",
    };
  }
  if (data == null) {
    return { ok: false, message: "This quote couldn't be accepted right now. Please try again." };
  }
  return { ok: true, reservationId: Number(data) };
}
