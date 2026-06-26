import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for placing a DTC order (P3-S12 — DTC orders + Stripe Checkout;
 * §1 rail 1 — all writes flow through a SECURITY DEFINER command RPC). The single write
 * door is `create_order`, which COMPUTES subtotal / ITBMS 7% / total SERVER-SIDE from
 * `product_skus.price_usd_cents` (a tampered cart can NEVER underpay — the RPC takes NO
 * client total) and decrements finished goods per line via `record_fg_movement` (the
 * S11 fail-closed oversell guard; an over-order rolls the whole txn back). Tenant-clamped,
 * idempotent on a tenant-qualified key.
 *
 * Symmetric twin of the read ports: a pure validator (`validateCreateOrder`) plus a thin
 * command (`createOrder`) calling the one `.rpc()` it needs (the `CreateOrderStore` port),
 * testable against a fake store with no database. The line helpers (`parseOrderLines`,
 * `isEmail`, `friendlyCreateOrderError`) are exported for `createCheckoutOrder` to reuse.
 * The idempotency key is REQUIRED — the action/form layer mints a stable token.
 */

/** The `order_channel` enum — where the order originated. */
export const ORDER_CHANNELS = ["web", "pos", "wholesale"] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

/** One validated cart line — a SKU + a positive integer quantity. */
export interface OrderLineInput {
  skuId: number;
  qtyUnits: number;
}

/** Validated, domain-shaped order args (camelCase). */
export interface CreateOrderInput {
  customerEmail: string;
  /** Optional display name; null when blank. */
  customerName: string | null;
  channel: OrderChannel;
  /** Settlement currency — defaults to 'USD'. */
  currency: string;
  lines: OrderLineInput[];
  idempotencyKey: string;
}

/** Is `v` one of the recognised order channels? (mirrors the `order_channel` enum) */
function isOrderChannel(v: string): v is OrderChannel {
  return (ORDER_CHANNELS as readonly string[]).includes(v);
}

/** A permissive email shape check (the DB only enforces case-insensitive uniqueness). */
export function isEmail(v: string): boolean {
  return /\S+@\S+\.\S+/.test(v);
}

/**
 * Parse an unknown cart payload into validated `OrderLineInput[]`, or a single
 * family-readable error string. Accepts camelCase (`skuId`/`qtyUnits`) or snake_case
 * (`sku_id`/`qty_units`) item keys. Mirrors the `qty_units > 0` CHECK + the SKU FK.
 */
export function parseOrderLines(
  raw: unknown,
): { lines: OrderLineInput[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: "Add at least one item to the order." };
  }
  const lines: OrderLineInput[] = [];
  for (const item of raw) {
    const rec = (item ?? {}) as Record<string, unknown>;
    const skuId = toNumber(rec.skuId ?? rec.sku_id);
    const qtyUnits = toNumber(rec.qtyUnits ?? rec.qty_units);
    if (skuId === null || !Number.isInteger(skuId) || skuId <= 0) {
      return { error: "Each line needs a valid product." };
    }
    if (qtyUnits === null || !Number.isInteger(qtyUnits) || qtyUnits <= 0) {
      return { error: "Each line's quantity must be greater than 0." };
    }
    lines.push({ skuId, qtyUnits });
  }
  return { lines };
}

/**
 * Pure validation of a raw order — mirrors the `create_order` preconditions (a real
 * email, a known channel, ≥1 line with positive integer qty) so errors surface before
 * the round-trip. The server-side total compute + finished-goods guard are the actual
 * enforcement (proven by the migration's PGlite tests).
 */
export function validateCreateOrder(
  raw: Record<string, unknown>,
): ValidationResult<CreateOrderInput> {
  const errors: Record<string, string> = {};

  const customerEmail = trimmed(raw.customerEmail);
  if (!customerEmail || !isEmail(customerEmail)) {
    errors.customerEmail = "A valid email is required.";
  }

  const customerName = trimmed(raw.customerName) || null;

  const rawChannel = trimmed(raw.channel);
  if (!isOrderChannel(rawChannel)) errors.channel = "Choose a valid order channel.";

  const currency = trimmed(raw.currency) || "USD";

  let lines: OrderLineInput[] = [];
  const parsedLines = parseOrderLines(raw.lines);
  if ("error" in parsedLines) errors.lines = parsedLines.error;
  else lines = parsedLines.lines;

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      customerEmail,
      customerName,
      channel: rawChannel as OrderChannel,
      currency,
      lines,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint order id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method `create_order` needs. */
export interface CreateOrderStore {
  rpc(
    fn: "create_order",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the new order id, or friendly/labelled errors. */
export type CreateOrderResult =
  | { ok: true; orderId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `create_order` onto a family-readable sentence — the
 * RPC/guards are the real wall, but the family must never see raw PG text. The
 * finished-goods oversell (record_fg_movement fail-closed) and the unknown-SKU FK are
 * the two expected rejections. Returns null for anything unrecognised. Exported so
 * `createCheckoutOrder` reuses the identical mapping (it delegates to `create_order`).
 */
export function friendlyCreateOrderError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  // The REUSED finished-goods guard fired (record_fg_movement rejected available < 0).
  if (/finished good|insufficient|available|oversell|out of stock|not enough/.test(m)) {
    return "One of these items is out of stock. Lower the quantity or remove it and try again.";
  }
  // Unknown SKU.
  if (error.code === "23503" || /unknown sku|foreign key/.test(m)) {
    return "One of the items couldn't be found. Refresh your cart and try again.";
  }
  if (/at least one line/.test(m)) {
    return "Add at least one item to the order.";
  }
  return null;
}

/**
 * Validate then place: calls `create_order` exactly once with the snake_case envelope
 * (p_lines as a [{sku_id, qty_units}] array — the shape the RPC's jsonb loop reads).
 * Bad input never reaches the RPC; the fail-closed oversell / unknown-SKU rejections
 * surface as CLEAN sentences. Exactly-once on `idempotencyKey`.
 */
export async function createOrder(
  store: CreateOrderStore,
  raw: Record<string, unknown>,
): Promise<CreateOrderResult> {
  const parsed = validateCreateOrder(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("create_order", {
    p_customer_email: parsed.data.customerEmail,
    p_customer_name: parsed.data.customerName,
    p_channel: parsed.data.channel,
    p_currency: parsed.data.currency,
    p_lines: parsed.data.lines.map((l) => ({
      sku_id: l.skuId,
      qty_units: l.qtyUnits,
    })),
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyCreateOrderError(error) ??
        "This order couldn't be placed right now. Please check your cart and try again.",
    };
  }
  if (data == null) {
    return { ok: false, message: "This order couldn't be placed right now. Please try again." };
  }
  return { ok: true, orderId: Number(data) };
}
