import { trimmed, type ValidationResult } from "@/lib/validation/shared";
import {
  friendlyCreateOrderError,
  isEmail,
  parseOrderLines,
  type OrderLineInput,
} from "@/lib/db/commands/createOrder";

/**
 * Write-side command for the Stripe hosted-Checkout order entry (P3-S12). The
 * `create_checkout_order` RPC DELEGATES to `create_order` (web channel, the same
 * SERVER-SIDE total compute + finished-goods allocation) and then stamps the Stripe
 * checkout session id — so this command carries NO channel and NO client total. Hosted
 * Checkout keeps PCI scope inside Stripe; we only persist the session/intent ids.
 *
 * Reuses the order line/email parsing + the finished-goods/SKU friendly-error mapping
 * from `createOrder` (identical DB rejections, since the RPC delegates). The idempotency
 * key is REQUIRED; a replay returns the same order id with no second allocation.
 */

/** Validated, domain-shaped checkout args (camelCase) — no channel (always 'web'). */
export interface CreateCheckoutOrderInput {
  customerEmail: string;
  customerName: string | null;
  currency: string;
  lines: OrderLineInput[];
  /** The Stripe hosted Checkout Session id minted before redirect. */
  stripeCheckoutSession: string;
  idempotencyKey: string;
}

/**
 * Pure validation of a raw checkout — same line/email rules as `create_order` plus a
 * required Stripe checkout session id (the thing this RPC stamps onto the order).
 */
export function validateCreateCheckoutOrder(
  raw: Record<string, unknown>,
): ValidationResult<CreateCheckoutOrderInput> {
  const errors: Record<string, string> = {};

  const customerEmail = trimmed(raw.customerEmail);
  if (!customerEmail || !isEmail(customerEmail)) {
    errors.customerEmail = "A valid email is required.";
  }

  const customerName = trimmed(raw.customerName) || null;
  const currency = trimmed(raw.currency) || "USD";

  let lines: OrderLineInput[] = [];
  const parsedLines = parseOrderLines(raw.lines);
  if ("error" in parsedLines) errors.lines = parsedLines.error;
  else lines = parsedLines.lines;

  const stripeCheckoutSession = trimmed(raw.stripeCheckoutSession);
  if (!stripeCheckoutSession) {
    errors.stripeCheckoutSession = "A Stripe checkout session is required.";
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: { customerEmail, customerName, currency, lines, stripeCheckoutSession, idempotencyKey },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint order id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the `.rpc()` method `create_checkout_order` needs. */
export interface CreateCheckoutOrderStore {
  rpc(
    fn: "create_checkout_order",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the order id, or friendly/labelled errors. */
export type CreateCheckoutOrderResult =
  | { ok: true; orderId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Validate then create: calls `create_checkout_order` exactly once with the snake_case
 * envelope (p_lines as [{sku_id, qty_units}], the Stripe session id). Bad input never
 * reaches the RPC; the delegated oversell / unknown-SKU rejections surface as CLEAN
 * sentences (reusing `friendlyCreateOrderError`). Exactly-once on `idempotencyKey`.
 */
export async function createCheckoutOrder(
  store: CreateCheckoutOrderStore,
  raw: Record<string, unknown>,
): Promise<CreateCheckoutOrderResult> {
  const parsed = validateCreateCheckoutOrder(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("create_checkout_order", {
    p_customer_email: parsed.data.customerEmail,
    p_customer_name: parsed.data.customerName,
    p_currency: parsed.data.currency,
    p_lines: parsed.data.lines.map((l) => ({
      sku_id: l.skuId,
      qty_units: l.qtyUnits,
    })),
    p_stripe_checkout_session: parsed.data.stripeCheckoutSession,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyCreateOrderError(error) ??
        "Checkout couldn't be started right now. Please check your cart and try again.",
    };
  }
  if (data == null) {
    return { ok: false, message: "Checkout couldn't be started right now. Please try again." };
  }
  return { ok: true, orderId: Number(data) };
}
