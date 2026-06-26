import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for SETTLING an AR payment (P3-S17 — `settle_ar_payment`;
 * ADR-002 — all writes flow through a SECURITY DEFINER command RPC). The S16 cap +
 * recompute triggers do the heavy lifting: the cap forbids Σ payments from exceeding
 * the doc total (a scarce invoice can't be double-collected), and the status is a
 * DETERMINISTIC function of the paid sum — never a manual 'paid' flip. On full
 * settlement the RPC books the realized two-rate FX. This is a MONEY-SHAPED write —
 * confirm-gated in the UI, never auto (§1.7); the Stripe/Yappy webhook calls it with
 * the gateway event id as the idempotency_key (exactly-once). `enqueueSync=false`
 * suppresses the outbound push when the payment was pulled FROM the external system
 * (the asymmetric source-of-truth rule — no echo loop).
 *
 * Symmetric twin of the read ports: a pure validator (`validateSettleArPayment`, the
 * friendly-error seam) plus a thin command (`settleArPayment`) that calls the single
 * `.rpc()` method it needs (the `SettleArPaymentStore` port) so it is testable
 * against a fake store with no database. The fail-closed overpayment / void-doc /
 * off-book-FX rejections surface as CLEAN, family-readable sentences.
 */

/** The `payment_method` enum (S16). */
export const PAYMENT_METHODS = [
  "wire",
  "ach",
  "card",
  "cash",
  "yappy",
  "check",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Validated, domain-shaped settlement args (camelCase). */
export interface SettleArPaymentInput {
  /** The `ar_doc.id` being paid (a positive integer). */
  arDocId: number;
  method: PaymentMethod;
  /** The cash amount in the doc currency (the `amount_doc > 0` CHECK guards it). */
  amountDoc: number;
  currency: string;
  /** Exactly-once anchor — the gateway event id (Stripe/Yappy). */
  idempotencyKey: string;
  /** Push the payment OUT to the buyer's books? false when it came FROM them. */
  enqueueSync: boolean;
}

function isPaymentMethod(v: string): v is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(v);
}

/**
 * Pure validation of a raw settlement — mirrors the `settle_ar_payment` /
 * `ar_payment` constraints (a real doc id, a known method, amount > 0) so errors
 * surface before the round-trip. The cap + recompute triggers are the actual
 * enforcement (the overpayment guard / deterministic status).
 */
export function validateSettleArPayment(
  raw: Record<string, unknown>,
): ValidationResult<SettleArPaymentInput> {
  const errors: Record<string, string> = {};

  const arDocId = toNumber(raw.arDocId);
  if (arDocId === null || !Number.isInteger(arDocId) || arDocId <= 0) {
    errors.arDocId = "Choose an invoice to settle.";
  }

  const rawMethod = trimmed(raw.method);
  if (!isPaymentMethod(rawMethod)) {
    errors.method = "Choose a valid payment method.";
  }

  const amountDoc = toNumber(raw.amountDoc);
  if (amountDoc === null || amountDoc <= 0) {
    errors.amountDoc = "The payment amount must be greater than 0.";
  }

  const currency = trimmed(raw.currency) || "USD";

  // enqueueSync defaults ON; only an explicit boolean false (or the string "false")
  // suppresses the push (the inbound-application path).
  const enqueueSync = raw.enqueueSync === false || raw.enqueueSync === "false" ? false : true;

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      arDocId: arDocId as number,
      method: rawMethod as PaymentMethod,
      amountDoc: amountDoc as number,
      currency,
      idempotencyKey,
      enqueueSync,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint payment id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method `settle_ar_payment` needs. */
export interface SettleArPaymentStore {
  rpc(
    fn: "settle_ar_payment",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the recorded payment's id, or friendly/labelled errors. */
export type SettleArPaymentResult =
  | { ok: true; paymentId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `settle_ar_payment` onto a family-readable sentence.
 * Returns null for anything unrecognised so the caller falls back to a generic message.
 */
export function friendlySettleArPaymentError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  // The S16 cap — Σ payments would exceed the doc total.
  if (/overpayment|exceed doc total|would exceed.*total/.test(m)) {
    return "That payment is more than the invoice's outstanding balance. Enter the remaining amount.";
  }
  // The doc is void — it can't take a payment.
  if (/is void|cannot accept a payment/.test(m)) {
    return "This invoice is void and can't take a payment.";
  }
  // The off-book-FX guard — the receipt currency has no on-book rate.
  if (/off-book fx|no fx_rate|record the rate first/.test(m)) {
    return "There's no exchange rate on the books for this currency yet. Record the rate first, then settle.";
  }
  // Unknown doc.
  if (error.code === "23503" || /unknown ar_doc|foreign key/.test(m)) {
    return "That invoice couldn't be found. Refresh and try again.";
  }
  return null;
}

/**
 * Validate then settle: calls `settle_ar_payment` exactly once with the snake_case
 * argument envelope (including `p_enqueue_sync`). Bad input never reaches the RPC
 * (friendly errors); the fail-closed overpayment / void-doc / off-book-FX rejections
 * surface as CLEAN sentences, any other failure surfaces labelled. Exactly-once on
 * `idempotencyKey` — a replay returns the same payment id with no second collection.
 */
export async function settleArPayment(
  store: SettleArPaymentStore,
  raw: Record<string, unknown>,
): Promise<SettleArPaymentResult> {
  const parsed = validateSettleArPayment(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("settle_ar_payment", {
    p_ar_doc_id: parsed.data.arDocId,
    p_method: parsed.data.method,
    p_amount_doc: parsed.data.amountDoc,
    p_currency: parsed.data.currency,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_enqueue_sync: parsed.data.enqueueSync,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlySettleArPaymentError(error) ??
        "This payment couldn't be recorded right now. Please try again.",
    };
  }
  if (data == null) {
    return { ok: false, message: "This payment couldn't be recorded right now. Please try again." };
  }
  return { ok: true, paymentId: Number(data) };
}
