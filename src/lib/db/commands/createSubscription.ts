import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";
import { isEmail } from "@/lib/db/commands/createOrder";

/**
 * Write-side command for minting a Reserve-Club subscription (P3-S12). The single write
 * door is `create_subscription`, which creates the subscription (status active) + one
 * `subscription_line` + a 'created' `sub_event` in one txn, tenant-clamped, idempotent on
 * a tenant-qualified key. Stripe Billing is the $0-until-revenue billing rail; the
 * `stripe_subscription_id` is nullable so a subscription can exist before Billing wires up.
 *
 * Symmetric twin of the read ports: a pure validator plus a thin command calling the one
 * `.rpc()` it needs (the `CreateSubscriptionStore` port), testable with no database. The
 * idempotency key is REQUIRED.
 */

/** The `sub_cadence` enum — the recurring-box cadence. */
export const SUB_CADENCES = ["monthly", "bi-monthly", "quarterly"] as const;
export type SubCadence = (typeof SUB_CADENCES)[number];

/** Validated, domain-shaped subscription args (camelCase). */
export interface CreateSubscriptionInput {
  customerEmail: string;
  customerName: string | null;
  skuId: number;
  cadence: SubCadence;
  qtyUnits: number;
  /** Stripe Billing subscription id; null at $0 before Billing is wired. */
  stripeSubscriptionId: string | null;
  idempotencyKey: string;
}

/** Is `v` one of the recognised cadences? (mirrors the `sub_cadence` enum) */
function isSubCadence(v: string): v is SubCadence {
  return (SUB_CADENCES as readonly string[]).includes(v);
}

/**
 * Pure validation of a raw subscription — mirrors the `create_subscription` preconditions
 * (a real email, a known cadence, a real SKU, qty_units > 0) so errors surface before the
 * round-trip. The SKU FK + the qty CHECK are the actual enforcement.
 */
export function validateCreateSubscription(
  raw: Record<string, unknown>,
): ValidationResult<CreateSubscriptionInput> {
  const errors: Record<string, string> = {};

  const customerEmail = trimmed(raw.customerEmail);
  if (!customerEmail || !isEmail(customerEmail)) {
    errors.customerEmail = "A valid email is required.";
  }

  const customerName = trimmed(raw.customerName) || null;

  const skuId = toNumber(raw.skuId);
  if (skuId === null || !Number.isInteger(skuId) || skuId <= 0) {
    errors.skuId = "Choose a coffee to subscribe to.";
  }

  const rawCadence = trimmed(raw.cadence);
  if (!isSubCadence(rawCadence)) errors.cadence = "Choose a valid cadence.";

  const qtyUnits = toNumber(raw.qtyUnits);
  if (qtyUnits === null || !Number.isInteger(qtyUnits) || qtyUnits <= 0) {
    errors.qtyUnits = "Quantity must be greater than 0.";
  }

  // stripe subscription id: optional; blank → null (the $0 pre-Billing path).
  const stripeSubscriptionId = trimmed(raw.stripeSubscriptionId) || null;

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      customerEmail,
      customerName,
      skuId: skuId as number,
      cadence: rawCadence as SubCadence,
      qtyUnits: qtyUnits as number,
      stripeSubscriptionId,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint subscription id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the `.rpc()` method `create_subscription` needs. */
export interface CreateSubscriptionStore {
  rpc(
    fn: "create_subscription",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the subscription id, or friendly/labelled errors. */
export type CreateSubscriptionResult =
  | { ok: true; subscriptionId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/** Map a raw Postgres error onto a family-readable sentence; null when unrecognised. */
export function friendlyCreateSubscriptionError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  if (error.code === "23503" || /unknown sku|foreign key/.test(m)) {
    return "That coffee couldn't be found. Pick one from the list and try again.";
  }
  return null;
}

/**
 * Validate then create: calls `create_subscription` exactly once with the snake_case
 * envelope (incl. a null p_stripe_subscription_id at $0). Bad input never reaches the
 * RPC; an unknown SKU surfaces as a CLEAN sentence. Exactly-once on `idempotencyKey`.
 */
export async function createSubscription(
  store: CreateSubscriptionStore,
  raw: Record<string, unknown>,
): Promise<CreateSubscriptionResult> {
  const parsed = validateCreateSubscription(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("create_subscription", {
    p_customer_email: parsed.data.customerEmail,
    p_customer_name: parsed.data.customerName,
    p_sku_id: parsed.data.skuId,
    p_cadence: parsed.data.cadence,
    p_qty_units: parsed.data.qtyUnits,
    p_stripe_subscription_id: parsed.data.stripeSubscriptionId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyCreateSubscriptionError(error) ??
        "This subscription couldn't be started right now. Please try again.",
    };
  }
  if (data == null) {
    return { ok: false, message: "This subscription couldn't be started right now. Please try again." };
  }
  return { ok: true, subscriptionId: Number(data) };
}
