import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for posting a finished-goods movement (P3-S11; ADR-002 — all
 * writes flow through a SECURITY DEFINER command RPC). The `fg_ledger` is APPEND-ONLY
 * (immutability triggers reject UPDATE/DELETE): a correction is a NEW reversing
 * movement, never an edit. The single write door is `record_fg_movement` — tenant-
 * clamped, idempotent on a tenant-qualified key. The ledger's AFTER-INSERT trigger
 * rolls the signed qty into finished_goods under a per-SKU advisory lock and FAILS
 * CLOSED if available would go negative (invariant 2 — the prevent_oversell pattern,
 * reused for retail inventory, never a parallel counter).
 *
 * Symmetric twin of the read ports: a pure validator (mirrors the reason enum + the
 * `qty_units <> 0` CHECK) plus a thin command that calls the single `.rpc()` it needs
 * (the `RecordFgMovementStore` port), testable with no database. A sale/return is a
 * NEGATIVE qty; a roast-in/adjust-up is POSITIVE. The idempotency key is REQUIRED.
 */

/** The `fg_ledger.reason` CHECK values. */
export const FG_REASONS = [
  "roast-in",
  "sale",
  "subscription-fulfill",
  "adjust",
  "return",
] as const;
export type FgReason = (typeof FG_REASONS)[number];

/** Validated, domain-shaped movement args (camelCase). */
export interface RecordFgMovementInput {
  skuId: number;
  /** Signed on-hand delta (positive = stock in, negative = stock out); `<> 0`. */
  qtyUnits: number;
  reason: FgReason;
  idempotencyKey: string;
}

function isFgReason(v: string): v is FgReason {
  return (FG_REASONS as readonly string[]).includes(v);
}

/**
 * Pure validation of a raw movement — mirrors the `fg_ledger` constraints (the reason
 * enum, `qty_units <> 0`, an integer signed delta) so errors surface before the round-
 * trip. The oversell guard + tenant clamp + append-only triggers are the data layer's
 * job (invariant 2, ADR-002).
 */
export function validateRecordFgMovement(
  raw: Record<string, unknown>,
): ValidationResult<RecordFgMovementInput> {
  const errors: Record<string, string> = {};

  const skuId = toNumber(raw.skuId);
  if (skuId === null || !Number.isInteger(skuId) || skuId <= 0) {
    errors.skuId = "Choose a SKU.";
  }

  const qtyUnits = toNumber(raw.qtyUnits);
  if (qtyUnits === null || !Number.isInteger(qtyUnits)) {
    errors.qtyUnits = "Quantity must be a whole number of units.";
  } else if (qtyUnits === 0) {
    errors.qtyUnits = "Quantity can't be zero — post a positive or negative movement.";
  }

  const rawReason = trimmed(raw.reason);
  if (!rawReason) errors.reason = "Choose a movement reason.";
  else if (!isFgReason(rawReason)) errors.reason = "Choose a valid movement reason.";

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      skuId: skuId as number,
      qtyUnits: qtyUnits as number,
      reason: rawReason as FgReason,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint ledger id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method `record_fg_movement` needs. */
export interface RecordFgMovementStore {
  rpc(
    fn: "record_fg_movement",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the posted ledger row's id, or friendly/labelled errors. */
export type RecordFgMovementResult =
  | { ok: true; ledgerId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `record_fg_movement` onto a family-readable sentence —
 * the trigger's advisory-lock + available>=0 raise is the real wall, but the family
 * must never see raw PG text (the `oversell guard:` engine prefix, on_hand/allocated
 * internals, errcodes). Returns null for anything unrecognised so the caller can fall
 * back to a generic message.
 */
export function friendlyRecordFgMovementError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  // INVARIANT 2: a sale can't oversell finished goods (fail-closed).
  if (/oversell guard|available below zero|finished_goods_available_nonneg/.test(m)) {
    return "There aren't enough bags on hand for that — it would oversell finished goods. Restock (post a roast-in) first.";
  }
  if (/no finished_goods row|unknown sku|create the sku first/.test(m)) {
    return "That SKU couldn't be found. Pick a SKU from the list and try again.";
  }
  return null;
}

/**
 * Validate then post: calls `record_fg_movement` exactly once with the snake_case
 * argument envelope. Bad input never reaches the RPC (friendly errors); the data-layer
 * oversell guard (invariant 2) surfaces as a CLEAN, family-readable sentence, any other
 * failure surfaces a generic clean message. Exactly-once on `idempotencyKey` — a replay
 * returns the same ledger id with no second movement.
 */
export async function recordFgMovement(
  store: RecordFgMovementStore,
  raw: Record<string, unknown>,
): Promise<RecordFgMovementResult> {
  const parsed = validateRecordFgMovement(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("record_fg_movement", {
    p_sku_id: parsed.data.skuId,
    p_qty_units: parsed.data.qtyUnits,
    p_reason: parsed.data.reason,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyRecordFgMovementError(error) ??
        "That movement couldn't be recorded right now. Please check the details and try again.",
    };
  }
  if (data == null) {
    return {
      ok: false,
      message: "That movement couldn't be recorded right now. Please try again.",
    };
  }
  return { ok: true, ledgerId: Number(data) };
}
