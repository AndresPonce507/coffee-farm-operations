import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for skipping a Reserve-Club cycle (P3-S12). The
 * `skip_subscription_cycle` RPC appends a 'skipped' `sub_event` for the named cycle with
 * NO status change, idempotent on the key. Symmetric twin of the read ports: a pure
 * validator plus a thin command calling the one `.rpc()` it needs. The idempotency key is
 * REQUIRED.
 */

/** Validated, domain-shaped skip args (camelCase). */
export interface SkipSubscriptionCycleInput {
  subscriptionId: number;
  /** The cycle being skipped, e.g. "2026-07". */
  cycleLabel: string;
  idempotencyKey: string;
}

/** Pure validation — a real subscription id + a cycle label + a key. */
export function validateSkipSubscriptionCycle(
  raw: Record<string, unknown>,
): ValidationResult<SkipSubscriptionCycleInput> {
  const errors: Record<string, string> = {};

  const subscriptionId = toNumber(raw.subscriptionId);
  if (subscriptionId === null || !Number.isInteger(subscriptionId) || subscriptionId <= 0) {
    errors.subscriptionId = "Choose a subscription.";
  }

  const cycleLabel = trimmed(raw.cycleLabel);
  if (!cycleLabel) errors.cycleLabel = "A cycle label is required.";

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: { subscriptionId: subscriptionId as number, cycleLabel, idempotencyKey },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint subscription id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the `.rpc()` method `skip_subscription_cycle` needs. */
export interface SkipSubscriptionCycleStore {
  rpc(
    fn: "skip_subscription_cycle",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the subscription id, or friendly/labelled errors. */
export type SkipSubscriptionCycleResult =
  | { ok: true; subscriptionId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/** Map a raw Postgres error onto a family-readable sentence; null when unrecognised. */
export function friendlySkipSubscriptionCycleError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  if (error.code === "23503" || /unknown subscription|foreign key/.test(m)) {
    return "That subscription couldn't be found. Refresh and try again.";
  }
  return null;
}

/**
 * Validate then skip: calls `skip_subscription_cycle` exactly once with the snake_case
 * envelope. Bad input never reaches the RPC; an unknown subscription surfaces clean.
 * Exactly-once on `idempotencyKey`.
 */
export async function skipSubscriptionCycle(
  store: SkipSubscriptionCycleStore,
  raw: Record<string, unknown>,
): Promise<SkipSubscriptionCycleResult> {
  const parsed = validateSkipSubscriptionCycle(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("skip_subscription_cycle", {
    p_subscription_id: parsed.data.subscriptionId,
    p_cycle_label: parsed.data.cycleLabel,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlySkipSubscriptionCycleError(error) ??
        "That cycle couldn't be skipped right now. Please try again.",
    };
  }
  if (data == null) {
    return { ok: false, message: "That cycle couldn't be skipped right now. Please try again." };
  }
  return { ok: true, subscriptionId: Number(data) };
}
