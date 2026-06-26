import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for closing roast→product (P3-S10 — roasting; ADR-002). The
 * single write door is `link_roast_sku`, which requires a FINALIZED batch and points a
 * SKU at the batch's roasted lot — the per-bag QR's load-bearing link the Storefront/
 * Provenance areas read; THIS slice OWNS it. The RPC appends a `roast_sku_linked`
 * lot_event and is idempotent on a tenant-qualified key (a replay returns the same SKU
 * id). `sku_code` is unique per tenant.
 *
 * Symmetric twin of the read ports: a pure validator (a real batch id, a sku code, a
 * positive bag size, optional price/GTIN) plus a thin command that calls the single
 * `.rpc()` it needs (the `LinkRoastSkuStore` port), testable against a fake store with
 * no database. The price + GTIN are OPTIONAL (blank forwards null); the idempotency key
 * is REQUIRED. Its load-bearing job is translating the not-finalized / duplicate-sku /
 * unknown-batch rejections into CLEAN, family-readable sentences.
 */

/** Validated, domain-shaped SKU-link args (camelCase). */
export interface LinkRoastSkuInput {
  /** The FINALIZED roast batch (`roast_batches.id`, positive integer). */
  batchId: number;
  /** The SKU code (unique per tenant). */
  skuCode: string;
  /** Bag size in grams (the `bag_size_g > 0` CHECK). */
  bagSizeG: number;
  /** Bag price in USD cents (≥ 0 integer); null ⇒ not priced yet. */
  priceUsdCents: number | null;
  /** Global trade item number; null ⇒ not assigned. */
  gtin: string | null;
  /** Exactly-once anchor — the DB dedupes on a tenant-qualified key. */
  idempotencyKey: string;
}

/** Is `v` blank (absent / empty after trim)? */
function isBlank(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "");
}

/**
 * Pure validation of a raw SKU link — mirrors the `roast_skus` constraints
 * (`bag_size_g > 0`, `price_usd_cents >= 0` integer) so errors surface before the
 * round-trip. The must-be-finalized gate + the unique sku_code + tenant clamp inside
 * the RPC are the actual enforcement (ADR-002).
 */
export function validateLinkRoastSku(
  raw: Record<string, unknown>,
): ValidationResult<LinkRoastSkuInput> {
  const errors: Record<string, string> = {};

  const batchId = toNumber(raw.batchId);
  if (batchId === null || !Number.isInteger(batchId) || batchId <= 0) {
    errors.batchId = "Choose a finalized roast batch.";
  }

  const skuCode = trimmed(raw.skuCode);
  if (!skuCode) errors.skuCode = "A SKU code is required.";

  const bagSizeG = toNumber(raw.bagSizeG);
  if (bagSizeG === null || !Number.isInteger(bagSizeG) || bagSizeG <= 0) {
    errors.bagSizeG = "Bag size (g) must be a whole number greater than 0.";
  }

  // Price is optional; if supplied it must be a non-negative integer (cents).
  let priceUsdCents: number | null = null;
  if (!isBlank(raw.priceUsdCents)) {
    const p = toNumber(raw.priceUsdCents);
    if (p === null || !Number.isInteger(p) || p < 0) {
      errors.priceUsdCents = "Price (cents) must be a whole number, 0 or more.";
    } else {
      priceUsdCents = p;
    }
  }

  // GTIN is optional; blank ⇒ null.
  const rawGtin = trimmed(raw.gtin);
  const gtin: string | null = rawGtin || null;

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      batchId: batchId as number,
      skuCode,
      bagSizeG: bagSizeG as number,
      priceUsdCents,
      gtin,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint sku id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method `link_roast_sku` needs. */
export interface LinkRoastSkuStore {
  rpc(
    fn: "link_roast_sku",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the linked SKU's id, or friendly/labelled errors. */
export type LinkRoastSkuResult =
  | { ok: true; skuId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `link_roast_sku` onto a family-readable sentence — the
 * must-be-finalized gate + unique sku_code are the real enforcement, but the family
 * must never see raw PG text (constraint names, errcodes). Always returns a clean
 * sentence.
 */
export function friendlyLinkRoastSkuError(error: {
  message: string;
  code?: string;
}): string {
  const m = error.message.toLowerCase();
  // The must-be-finalized gate.
  if (m.includes("not finalized") || m.includes("before linking")) {
    return "Finalize the roast batch before linking a SKU to it.";
  }
  // Duplicate SKU code (the unique constraint).
  if (error.code === "23505" || m.includes("duplicate key") || m.includes("unique constraint")) {
    return "That SKU code is already in use. Choose a different code.";
  }
  // Unknown batch.
  if (error.code === "23503" || m.includes("unknown roast batch") || m.includes("foreign key")) {
    return "That roast batch couldn't be found. Pick a finalized batch and try again.";
  }
  return "This SKU couldn't be linked right now. Please check the details and try again.";
}

/**
 * Validate then link: calls `link_roast_sku` exactly once with the snake_case argument
 * envelope. Bad input never reaches the RPC (friendly errors); the must-be-finalized /
 * duplicate-sku / unknown-batch rejections surface as CLEAN, family-readable sentences
 * — raw Postgres text never leaks. Exactly-once on `idempotencyKey` — a replay returns
 * the same SKU id with no second row.
 */
export async function linkRoastSku(
  store: LinkRoastSkuStore,
  raw: Record<string, unknown>,
): Promise<LinkRoastSkuResult> {
  const parsed = validateLinkRoastSku(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("link_roast_sku", {
    p_batch_id: parsed.data.batchId,
    p_sku_code: parsed.data.skuCode,
    p_bag_size_g: parsed.data.bagSizeG,
    p_price_usd_cents: parsed.data.priceUsdCents,
    p_gtin: parsed.data.gtin,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return { ok: false, message: friendlyLinkRoastSkuError(error) };
  }
  if (data == null) {
    return {
      ok: false,
      message: "This SKU couldn't be linked right now. Please try again.",
    };
  }
  return { ok: true, skuId: Number(data) };
}
