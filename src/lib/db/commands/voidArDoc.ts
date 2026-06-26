import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for VOIDING an AR doc (P3-S17 — `void_ar_doc`; ADR-002 — all
 * writes flow through a SECURITY DEFINER command RPC). Voiding REVERSES the doc's
 * revenue with negative `revenue_entry` rows (never a delete — the append-only
 * correction path) and enqueues a void `sync_outbox` post per target the doc was
 * issued to. A doc that already has payments CANNOT be voided — the RPC fails closed
 * and tells you to issue a credit note instead. Idempotent: a re-void returns the
 * same doc id with no second reversal.
 *
 * Symmetric twin of the read ports: a pure validator (`validateVoidArDoc`, the
 * friendly-error seam) plus a thin command (`voidArDoc`) that calls the single
 * `.rpc()` method it needs (the `VoidArDocStore` port) so it is testable against a
 * fake store with no database. The fail-closed has-payments rejection surfaces as a
 * CLEAN, family-readable sentence.
 */

/** Validated, domain-shaped void args (camelCase). */
export interface VoidArDocInput {
  /** The `ar_doc.id` being voided (a positive integer). */
  arDocId: number;
  /** Why it's being voided — surfaced in the reversal memo. Optional. */
  reason: string | null;
  /** Exactly-once anchor — the DB dedupes on a tenant-qualified key. */
  idempotencyKey: string;
}

/**
 * Pure validation of a raw void — mirrors the `void_ar_doc` preconditions (a real doc
 * id) so errors surface before the round-trip. The has-payments block is the actual
 * enforcement (issue a credit note instead).
 */
export function validateVoidArDoc(
  raw: Record<string, unknown>,
): ValidationResult<VoidArDocInput> {
  const errors: Record<string, string> = {};

  const arDocId = toNumber(raw.arDocId);
  if (arDocId === null || !Number.isInteger(arDocId) || arDocId <= 0) {
    errors.arDocId = "Choose an invoice to void.";
  }

  const reason = trimmed(raw.reason) || null;

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: { arDocId: arDocId as number, reason, idempotencyKey },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint ar_doc id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method `void_ar_doc` needs. */
export interface VoidArDocStore {
  rpc(
    fn: "void_ar_doc",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the voided doc's id, or friendly/labelled errors. */
export type VoidArDocResult =
  | { ok: true; docId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `void_ar_doc` onto a family-readable sentence.
 * Returns null for anything unrecognised so the caller falls back to a generic message.
 */
export function friendlyVoidArDocError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  // The has-payments block — voiding a paid doc is forbidden; credit-note instead.
  if (/has payments|issue a credit note|do not void/.test(m)) {
    return "This invoice already has payments, so it can't be voided. Issue a credit note instead.";
  }
  // Unknown doc.
  if (error.code === "23503" || /unknown ar_doc|foreign key/.test(m)) {
    return "That invoice couldn't be found. Refresh and try again.";
  }
  return null;
}

/**
 * Validate then void: calls `void_ar_doc` exactly once with the snake_case argument
 * envelope. Bad input never reaches the RPC (friendly errors); the fail-closed
 * has-payments rejection surfaces as a CLEAN sentence, any other failure surfaces
 * labelled. Idempotent on `idempotencyKey` — a replay returns the same doc id with no
 * second reversal.
 */
export async function voidArDoc(
  store: VoidArDocStore,
  raw: Record<string, unknown>,
): Promise<VoidArDocResult> {
  const parsed = validateVoidArDoc(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("void_ar_doc", {
    p_ar_doc_id: parsed.data.arDocId,
    p_reason: parsed.data.reason,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyVoidArDocError(error) ??
        "This invoice couldn't be voided right now. Please try again.",
    };
  }
  if (data == null) {
    return { ok: false, message: "This invoice couldn't be voided right now. Please try again." };
  }
  return { ok: true, docId: Number(data) };
}
