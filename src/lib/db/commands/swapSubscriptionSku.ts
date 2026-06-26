import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for swapping a Reserve-Club line's SKU (P3-S12). The
 * `swap_subscription_sku` RPC repoints a `subscription_line` to a new SKU and appends a
 * 'swapped' `sub_event` in one txn, idempotent on the key. Symmetric twin of the read
 * ports: a pure validator plus a thin command calling the one `.rpc()` it needs. The
 * idempotency key is REQUIRED.
 */

/** Validated, domain-shaped swap args (camelCase). */
export interface SwapSubscriptionSkuInput {
  subscriptionId: number;
  /** The `subscription_lines.id` being repointed. */
  lineId: number;
  /** The new `product_skus.id`. */
  newSkuId: number;
  idempotencyKey: string;
}

/** Pure validation — real subscription / line / new-sku ids + a key. */
export function validateSwapSubscriptionSku(
  raw: Record<string, unknown>,
): ValidationResult<SwapSubscriptionSkuInput> {
  const errors: Record<string, string> = {};

  const subscriptionId = toNumber(raw.subscriptionId);
  if (subscriptionId === null || !Number.isInteger(subscriptionId) || subscriptionId <= 0) {
    errors.subscriptionId = "Choose a subscription.";
  }

  const lineId = toNumber(raw.lineId);
  if (lineId === null || !Number.isInteger(lineId) || lineId <= 0) {
    errors.lineId = "Choose a subscription line to swap.";
  }

  const newSkuId = toNumber(raw.newSkuId);
  if (newSkuId === null || !Number.isInteger(newSkuId) || newSkuId <= 0) {
    errors.newSkuId = "Choose a coffee to swap to.";
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      subscriptionId: subscriptionId as number,
      lineId: lineId as number,
      newSkuId: newSkuId as number,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint subscription id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the `.rpc()` method `swap_subscription_sku` needs. */
export interface SwapSubscriptionSkuStore {
  rpc(
    fn: "swap_subscription_sku",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the subscription id, or friendly/labelled errors. */
export type SwapSubscriptionSkuResult =
  | { ok: true; subscriptionId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error onto a family-readable sentence — an unknown line vs an
 * unknown SKU get distinct copy (line check first; both raise FK 23503). Null when
 * unrecognised.
 */
export function friendlySwapSubscriptionSkuError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  if (/subscription_line/.test(m)) {
    return "That subscription line couldn't be found. Refresh and try again.";
  }
  if (/unknown sku|sku/.test(m)) {
    return "That coffee couldn't be found. Pick another and try again.";
  }
  if (error.code === "23503" || /foreign key/.test(m)) {
    return "Something referenced here couldn't be found. Refresh and try again.";
  }
  return null;
}

/**
 * Validate then swap: calls `swap_subscription_sku` exactly once with the snake_case
 * envelope. Bad input never reaches the RPC; unknown line/SKU surface clean. Exactly-once
 * on `idempotencyKey`.
 */
export async function swapSubscriptionSku(
  store: SwapSubscriptionSkuStore,
  raw: Record<string, unknown>,
): Promise<SwapSubscriptionSkuResult> {
  const parsed = validateSwapSubscriptionSku(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("swap_subscription_sku", {
    p_subscription_id: parsed.data.subscriptionId,
    p_line_id: parsed.data.lineId,
    p_new_sku_id: parsed.data.newSkuId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlySwapSubscriptionSkuError(error) ??
        "That swap couldn't be applied right now. Please try again.",
    };
  }
  if (data == null) {
    return { ok: false, message: "That swap couldn't be applied right now. Please try again." };
  }
  return { ok: true, subscriptionId: Number(data) };
}
