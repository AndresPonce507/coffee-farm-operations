import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for THE money-guarantee touch point of P3-S12:
 * `allocate_subscription_cycle`. The SECURITY DEFINER RPC inserts a `lot_reservations`
 * row so the EXISTING `prevent_oversell` trigger fires — a scarce $30k/kg Geisha micro-lot
 * can NEVER be promised to more subscribers than kg exist (Σreservations + Σshipments ≤
 * current_kg, per-tenant per-lot advisory lock). An over-allocation rolls the WHOLE txn
 * back. The money guarantee is REUSED, not rebuilt (no parallel counter); the RPC then
 * records the `sub_allocations` link + an 'allocated' `sub_event` + a lot_event. Idempotent
 * on a tenant-qualified key (a replay returns the same allocation id, no second reservation).
 *
 * Symmetric twin of the read ports: a pure validator plus a thin command calling the one
 * `.rpc()` it needs (the `AllocateSubscriptionCycleStore` port), testable with no database.
 * This command surfaces the fail-closed oversell rejection as a CLEAN, family-readable
 * sentence — the trigger is the real enforcement (the migration's PGlite oversell test pins it).
 */

/** Validated, domain-shaped allocation args (camelCase). */
export interface AllocateSubscriptionCycleInput {
  subscriptionId: number;
  /** The green lot the kg are drawn from (composite FK to green_lots). */
  greenLotCode: string;
  /** Kilograms to allocate — the `kg > 0` CHECK guards it; the trigger guards oversell. */
  kg: number;
  /** The cycle this allocation belongs to, e.g. "2026-07". */
  cycleLabel: string;
  idempotencyKey: string;
}

/**
 * Pure validation — a real subscription id, a green lot, kg > 0, a cycle + a key. The
 * `prevent_oversell` trigger fired by the reservation insert is the actual money wall.
 */
export function validateAllocateSubscriptionCycle(
  raw: Record<string, unknown>,
): ValidationResult<AllocateSubscriptionCycleInput> {
  const errors: Record<string, string> = {};

  const subscriptionId = toNumber(raw.subscriptionId);
  if (subscriptionId === null || !Number.isInteger(subscriptionId) || subscriptionId <= 0) {
    errors.subscriptionId = "Choose a subscription.";
  }

  const greenLotCode = trimmed(raw.greenLotCode);
  if (!greenLotCode) errors.greenLotCode = "Choose a green lot.";

  const kg = toNumber(raw.kg);
  if (kg === null || kg <= 0) errors.kg = "Kilograms must be greater than 0.";

  const cycleLabel = trimmed(raw.cycleLabel);
  if (!cycleLabel) errors.cycleLabel = "A cycle label is required.";

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      subscriptionId: subscriptionId as number,
      greenLotCode,
      kg: kg as number,
      cycleLabel,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint allocation id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the `.rpc()` method `allocate_subscription_cycle` needs. */
export interface AllocateSubscriptionCycleStore {
  rpc(
    fn: "allocate_subscription_cycle",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the allocation id, or friendly/labelled errors. */
export type AllocateSubscriptionCycleResult =
  | { ok: true; allocationId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error onto a family-readable sentence — the REUSED `prevent_oversell`
 * rejection is the expected one (the reservation insert hit the trigger). Returns null for
 * anything unrecognised so the caller can fall back to a generic labelled message.
 */
export function friendlyAllocateSubscriptionError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  // The REUSED money guarantee — the reservation insert hit prevent_oversell.
  if (/oversell|available-to-promise|would exceed|no declared mass/.test(m)) {
    return "There isn't enough available-to-promise on this micro-lot to allocate that quantity to the Reserve Club. Lower the kilograms or pick another lot.";
  }
  // Unknown subscription.
  if (error.code === "23503" || /unknown subscription|foreign key/.test(m)) {
    return "That subscription couldn't be found. Refresh and try again.";
  }
  return null;
}

/**
 * Validate then allocate: calls `allocate_subscription_cycle` exactly once with the
 * snake_case envelope. Bad input never reaches the RPC; the fail-closed oversell rejection
 * surfaces as a CLEAN sentence (never raw PG). Exactly-once on `idempotencyKey`.
 */
export async function allocateSubscriptionCycle(
  store: AllocateSubscriptionCycleStore,
  raw: Record<string, unknown>,
): Promise<AllocateSubscriptionCycleResult> {
  const parsed = validateAllocateSubscriptionCycle(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("allocate_subscription_cycle", {
    p_subscription_id: parsed.data.subscriptionId,
    p_green_lot_code: parsed.data.greenLotCode,
    p_kg: parsed.data.kg,
    p_cycle_label: parsed.data.cycleLabel,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyAllocateSubscriptionError(error) ??
        "This cycle couldn't be allocated right now. Please try again.",
    };
  }
  if (data == null) {
    return { ok: false, message: "This cycle couldn't be allocated right now. Please try again." };
  }
  return { ok: true, allocationId: Number(data) };
}
