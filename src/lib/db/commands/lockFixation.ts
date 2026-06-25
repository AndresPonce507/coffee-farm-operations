import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for LOCKING a commodity quote's "C" fixation (P3-S0). The
 * SECURITY DEFINER `lock_fixation` RPC snapshots the live `v_ice_c_latest` mark,
 * links the accepted quote's `lot_reservations` row, and appends a `fixation_locked`
 * lot_event — all in one txn, idempotent on a tenant-qualified key.
 *
 * THE FIXATION REGIME GUARD (the data layer, not just this command): a RESERVE quote
 * has no "C" leg to fix, so the RPC RAISES on it. A quote must also be accepted (have
 * a reservation) before its fixation can lock. A fixation is APPEND-ONLY and
 * irreversible (immutability triggers reject UPDATE/DELETE). This command surfaces
 * those rejections as CLEAN, family-readable sentences.
 *
 * Symmetric twin of the read ports: a pure validator plus a thin command that calls
 * the one `.rpc()` it needs (the `LockFixationStore` port), testable with no database.
 * The idempotency key is REQUIRED.
 */

/** Validated, domain-shaped fixation-lock args (camelCase). */
export interface LockFixationInput {
  /** The accepted COMMODITY `price_quotes.id` whose "C" leg is fixed (positive integer). */
  quoteId: number;
  /** Exactly-once anchor — the DB dedupes on a tenant-qualified key. */
  idempotencyKey: string;
}

/**
 * Pure validation of a raw fixation lock — mirrors the `lock_fixation` preconditions
 * (a real quote id) so errors surface before the round-trip. The regime guard +
 * must-be-accepted gate inside the RPC are the actual enforcement.
 *
 * Accepts the quote id under `priceQuoteId` (the field name the /hedge cockpit's
 * published `LockFixationInput` contract uses — it maps to the `fixations.price_quote_id`
 * column / `lock_fixation(p_quote_id)` arg) OR the legacy `quoteId`, so the port
 * binds to the UI's actual call shape either way.
 */
export function validateLockFixation(
  raw: Record<string, unknown>,
): ValidationResult<LockFixationInput> {
  const errors: Record<string, string> = {};

  const quoteId = toNumber(raw.priceQuoteId ?? raw.quoteId);
  if (quoteId === null || !Number.isInteger(quoteId) || quoteId <= 0) {
    errors.quoteId = "Choose a quote to fix.";
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, data: { quoteId: quoteId as number, idempotencyKey } };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint fixation id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method `lock_fixation` needs. */
export interface LockFixationStore {
  rpc(
    fn: "lock_fixation",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the fixation id, or friendly/labelled errors. */
export type LockFixationResult =
  | { ok: true; fixationId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `lock_fixation` onto a family-readable sentence —
 * the RPC raises are the real guard, but the family must never see raw PG text (the
 * `fixation regime guard:` engine prefix, errcodes). Returns null for anything
 * unrecognised so the caller can fall back to a generic labelled message.
 */
export function friendlyLockFixationError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  // THE REGIME GUARD — a reserve quote has no "C" leg to fix.
  if (/fixation regime guard|reserve quote/.test(m)) {
    return "Only commodity quotes carry an ICE \"C\" leg to fix — this is a reserve quote.";
  }
  // Must be accepted (have a reservation) before fixation.
  if (/must be accepted|before fixation/.test(m)) {
    return "Accept the quote (reserve the coffee) before locking its fixation.";
  }
  // No live "C" mark to fix for the contract month.
  if (/no ice .*mark/.test(m)) {
    return "There's no ICE \"C\" mark to fix for that contract month. Post a current mark first.";
  }
  // Unknown quote.
  if (error.code === "23503" || /unknown quote|foreign key/.test(m)) {
    return "That quote couldn't be found. Refresh and try again.";
  }
  return null;
}

/**
 * Validate then lock: calls `lock_fixation` exactly once with the snake_case
 * argument envelope. Bad input never reaches the RPC (friendly errors); the regime
 * guard / must-be-accepted / missing-mark rejections surface as CLEAN sentences, any
 * other failure surfaces labelled. Exactly-once on `idempotencyKey`.
 */
export async function lockFixation(
  store: LockFixationStore,
  raw: Record<string, unknown>,
): Promise<LockFixationResult> {
  const parsed = validateLockFixation(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("lock_fixation", {
    p_quote_id: parsed.data.quoteId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyLockFixationError(error) ??
        "This fixation couldn't be locked right now. Please try again.",
    };
  }
  if (data == null) {
    return { ok: false, message: "This fixation couldn't be locked right now. Please try again." };
  }
  return { ok: true, fixationId: Number(data) };
}
