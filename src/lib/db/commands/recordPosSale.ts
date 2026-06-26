import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for ringing a POS sale (P3-S14 — the offline DGI farm-store/café
 * POS; ADR-002 — all writes flow through a SECURITY DEFINER command RPC). A POS sale IS
 * an `order` with channel='pos': the single write door `record_pos_sale` DELEGATES to
 * the shipped `create_order` for the server-computed subtotal / ITBMS 7% / total + the
 * S11 fail-closed finished_goods decrement (the money guarantee REUSED, never rebuilt —
 * no parallel counter), then mints a human POS-NNNN folio carrying the offline
 * (device_id, device_seq) coordinate.
 *
 * EXACTLY-ONCE (the offline-sync keystone): a replay of the same client key returns the
 * EXISTING folio (no second charge, no second decrement); a key-regenerated re-sync on
 * the SAME (device_id, device_seq) hits the UNIQUE backstop and fails the whole txn
 * closed. The client supplies NO total — the server computes it.
 *
 * Symmetric twin of the read ports: a pure validator (`validateRecordPosSale`, the
 * friendly-error seam) plus a thin command (`recordPosSale`) that calls the single
 * `.rpc()` method it needs (the `RecordPosSaleStore` port), testable with no database.
 * The walk-in customer email/name are OPTIONAL — blank forwards null so the RPC defaults
 * to walkin@pos.local / 'Walk-in'. Currency defaults to 'USD'. The idempotency key is
 * REQUIRED. Mirrors recordCherryIntake (the folio-returning minter) + quoteCommodityPrice
 * (the friendly-rejection seam).
 */

/** One cart line — a SKU and the number of units sold. The price is read
 *  SERVER-SIDE from the SKU inside `create_order`; the client cannot set it. */
export interface PosSaleLineInput {
  skuId: number;
  qtyUnits: number;
}

/** Validated, domain-shaped POS-sale args (camelCase). */
export interface RecordPosSaleInput {
  /** The registered terminal's code (the RPC rejects an unknown/inactive till). */
  terminalCode: string;
  /** Buyer email; null ⇒ the RPC defaults to walkin@pos.local. */
  customerEmail: string | null;
  /** Buyer name; null ⇒ the RPC defaults to 'Walk-in'. */
  customerName: string | null;
  /** Offline device coordinate — the till's stable id. */
  deviceId: string;
  /** Per-device monotonic counter — the offline exactly-once backstop. */
  deviceSeq: number;
  /** The cart — at least one line (the delegated `create_order` CHECK). */
  lines: PosSaleLineInput[];
  /** Settlement currency — defaults to 'USD'. */
  currency: string;
  /** Exactly-once anchor — the DB dedupes on a tenant-qualified key. */
  idempotencyKey: string;
}

/** Coerce one raw cart line to a validated `{skuId, qtyUnits}`, or null if it is
 *  malformed (non-object, non-positive-integer sku/qty). Mirrors the
 *  `create_order` line guards (`qty_units > 0`, the SKU FK). */
function parseLine(raw: unknown): PosSaleLineInput | null {
  if (raw == null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const skuId = toNumber(o.skuId);
  const qtyUnits = toNumber(o.qtyUnits);
  if (skuId === null || !Number.isInteger(skuId) || skuId <= 0) return null;
  if (qtyUnits === null || !Number.isInteger(qtyUnits) || qtyUnits <= 0) {
    return null;
  }
  return { skuId, qtyUnits };
}

/**
 * Pure validation of a raw POS sale — mirrors the `record_pos_sale` / delegated
 * `create_order` constraints (a terminal code, a non-empty cart, positive integer
 * qty per line, a device coordinate) so errors surface before the round-trip. The
 * oversell guard + tenant clamp + the (device_id, device_seq) UNIQUE are the actual
 * enforcement (ADR-002).
 */
export function validateRecordPosSale(
  raw: Record<string, unknown>,
): ValidationResult<RecordPosSaleInput> {
  const errors: Record<string, string> = {};

  const terminalCode = trimmed(raw.terminalCode);
  if (!terminalCode) errors.terminalCode = "Choose a POS terminal.";

  // Walk-in customer email/name are optional → blank forwards null (RPC defaults).
  const customerEmail = trimmed(raw.customerEmail) || null;
  const customerName = trimmed(raw.customerName) || null;

  const deviceId = trimmed(raw.deviceId);
  if (!deviceId) errors.deviceId = "A device id is required.";

  const deviceSeq = toNumber(raw.deviceSeq);
  if (deviceSeq === null || deviceSeq < 0 || !Number.isInteger(deviceSeq)) {
    errors.deviceSeq = "A device sequence is required.";
  }

  // The cart: must be a non-empty array of well-formed lines.
  let lines: PosSaleLineInput[] = [];
  if (!Array.isArray(raw.lines) || raw.lines.length === 0) {
    errors.lines = "Add at least one item to the sale.";
  } else {
    const parsed = raw.lines.map(parseLine);
    if (parsed.some((l) => l === null)) {
      errors.lines = "Each item needs a product and a quantity greater than zero.";
    } else {
      lines = parsed as PosSaleLineInput[];
    }
  }

  const currency = trimmed(raw.currency) || "USD";

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      terminalCode,
      customerEmail,
      customerName,
      deviceId,
      deviceSeq: deviceSeq as number,
      lines,
      currency,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (the POS-NNNN folio text). */
interface RpcResult {
  data: string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method `record_pos_sale` needs. */
export interface RecordPosSaleStore {
  rpc(
    fn: "record_pos_sale",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the minted POS-NNNN folio, or friendly/labelled errors. */
export type RecordPosSaleResult =
  | { ok: true; saleNo: string }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `record_pos_sale` (or its delegates `create_order` /
 * `record_fg_movement`) onto a family-readable sentence — the data-layer guards are the
 * real wall, but a barista must never see raw PG text (constraint names, errcodes, the
 * `oversell guard:` engine prefix). Returns null for anything unrecognised so the caller
 * can fall back to a generic labelled message.
 */
export function friendlyRecordPosSaleError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();

  // The S11 finished-goods fail-closed guard — not enough stock to ring the sale.
  if (/oversell guard|available below zero|no finished_goods row/.test(m)) {
    return "There isn't enough stock to ring this sale. Check the shelf count and try again.";
  }
  // The terminal isn't registered or has been deactivated.
  if (/unknown or inactive pos terminal/.test(m)) {
    return "That POS terminal isn't registered or is no longer active. Pick an active till and try again.";
  }
  // One of the cart's SKUs/products couldn't be found.
  if (/unknown sku|unknown product/.test(m)) {
    return "One of the items couldn't be found. Refresh the products and try again.";
  }
  // The offline (device_id, device_seq) backstop — a key-regenerated re-sync.
  if (
    error.code === "23505" ||
    /duplicate key value|violates unique constraint/.test(m)
  ) {
    return "This sale was already recorded on this device — refresh the sales list before trying again.";
  }
  return null;
}

/**
 * Validate then ring: calls `record_pos_sale` exactly once with the snake_case argument
 * envelope (the cart lines as a `{sku_id, qty_units}[]` jsonb array). Bad input never
 * reaches the RPC (friendly errors); the data-layer guards (oversell, unknown/inactive
 * terminal, an offline collision) surface as CLEAN, family-readable sentences, any other
 * failure surfaces labelled. Exactly-once on `idempotencyKey` — a replay returns the same
 * POS-NNNN folio with no second charge, no second decrement.
 */
export async function recordPosSale(
  store: RecordPosSaleStore,
  raw: Record<string, unknown>,
): Promise<RecordPosSaleResult> {
  const parsed = validateRecordPosSale(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("record_pos_sale", {
    p_terminal_code: parsed.data.terminalCode,
    p_customer_email: parsed.data.customerEmail,
    p_customer_name: parsed.data.customerName,
    p_device_id: parsed.data.deviceId,
    p_device_seq: parsed.data.deviceSeq,
    p_lines: parsed.data.lines.map((l) => ({
      sku_id: l.skuId,
      qty_units: l.qtyUnits,
    })),
    p_currency: parsed.data.currency,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyRecordPosSaleError(error) ??
        "This sale couldn't be recorded right now. Please check the details and try again.",
    };
  }
  if (!data) {
    return {
      ok: false,
      message: "This sale couldn't be recorded right now. Please try again.",
    };
  }
  return { ok: true, saleNo: data };
}
