import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side commands for the three simple Reserve-Club status transitions (P3-S12):
 * `pause_subscription` / `resume_subscription` / `cancel_subscription`. Each is a thin
 * SECURITY DEFINER RPC taking only (subscription_id, idempotency_key), flipping status and
 * appending the matching `sub_event` (paused/resumed/cancelled) in one txn, idempotent on
 * the key. They share one validator (`validateSubscriptionAction`) but each command binds
 * to its OWN literal rpc name, so a typo can't silently call the wrong transition.
 *
 * Symmetric twin of the read ports: a pure validator plus thin commands calling the one
 * `.rpc()` each needs (the shared `SubscriptionLifecycleStore` port), testable with no
 * database. The idempotency key is REQUIRED.
 */

/** Validated args common to all three transitions (camelCase). */
export interface SubscriptionActionInput {
  subscriptionId: number;
  idempotencyKey: string;
}

/**
 * Pure validation shared by pause/resume/cancel — a real subscription id + a key. The
 * subscription FK + the idempotency dedupe are the actual enforcement (the RPC).
 */
export function validateSubscriptionAction(
  raw: Record<string, unknown>,
): ValidationResult<SubscriptionActionInput> {
  const errors: Record<string, string> = {};

  const subscriptionId = toNumber(raw.subscriptionId);
  if (subscriptionId === null || !Number.isInteger(subscriptionId) || subscriptionId <= 0) {
    errors.subscriptionId = "Choose a subscription.";
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, data: { subscriptionId: subscriptionId as number, idempotencyKey } };
}

/** The PostgREST shape the commands return from `.rpc()` (bigint subscription id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — the three literal transition rpc names. */
export interface SubscriptionLifecycleStore {
  rpc(
    fn: "pause_subscription" | "resume_subscription" | "cancel_subscription",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of a transition: the subscription id, or friendly/labelled errors. */
export type SubscriptionLifecycleResult =
  | { ok: true; subscriptionId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/** Map a raw Postgres error onto a family-readable sentence; null when unrecognised. */
export function friendlySubscriptionLifecycleError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  if (error.code === "23503" || /unknown subscription|foreign key/.test(m)) {
    return "That subscription couldn't be found. Refresh and try again.";
  }
  return null;
}

/** Shared engine: validate then call the one literal transition rpc, exactly once. */
async function runTransition(
  store: SubscriptionLifecycleStore,
  fn: "pause_subscription" | "resume_subscription" | "cancel_subscription",
  raw: Record<string, unknown>,
): Promise<SubscriptionLifecycleResult> {
  const parsed = validateSubscriptionAction(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc(fn, {
    p_subscription_id: parsed.data.subscriptionId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlySubscriptionLifecycleError(error) ??
        "That subscription couldn't be updated right now. Please try again.",
    };
  }
  if (data == null) {
    return { ok: false, message: "That subscription couldn't be updated right now. Please try again." };
  }
  return { ok: true, subscriptionId: Number(data) };
}

/** Pause a subscription — appends a 'paused' sub_event, idempotent on the key. */
export function pauseSubscription(
  store: SubscriptionLifecycleStore,
  raw: Record<string, unknown>,
): Promise<SubscriptionLifecycleResult> {
  return runTransition(store, "pause_subscription", raw);
}

/** Resume a paused subscription — appends a 'resumed' sub_event, idempotent on the key. */
export function resumeSubscription(
  store: SubscriptionLifecycleStore,
  raw: Record<string, unknown>,
): Promise<SubscriptionLifecycleResult> {
  return runTransition(store, "resume_subscription", raw);
}

/** Cancel a subscription — appends a 'cancelled' sub_event, idempotent on the key. */
export function cancelSubscription(
  store: SubscriptionLifecycleStore,
  raw: Record<string, unknown>,
): Promise<SubscriptionLifecycleResult> {
  return runTransition(store, "cancel_subscription", raw);
}
