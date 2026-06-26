import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for minting a lot-linked SKU (P3-S11; ADR-002 — all writes flow
 * through a SECURITY DEFINER command RPC). The single write door is `create_sku` —
 * tenant-clamped, idempotent on a tenant-qualified key. It VALIDATES the green lot
 * exists (invariant 5 — a SKU can NEVER claim a lot it isn't backed by; the composite
 * FK + the RPC's `SKU lot-backing guard` raise both enforce it), materializes the
 * finished_goods row at on_hand 0, and appends a `sku_created` lot_event on the green
 * lot's chain in the same txn.
 *
 * Symmetric twin of the read ports: a pure validator (mirrors the pack_format /
 * bag_size enums + the `price_usd_cents >= 0` integer CHECK) plus a thin command that
 * calls the single `.rpc()` it needs (the `CreateSkuStore` port), testable with no
 * database. The roast-SKU link / GTIN / Stripe-price are OPTIONAL (blank forwards
 * null); is_reserve_club defaults false; the idempotency key is REQUIRED.
 */

/** The `pack_format` enum — how the bag is ground. */
export const PACK_FORMATS = ["whole-bean", "ground"] as const;
export type PackFormat = (typeof PACK_FORMATS)[number];

/** The `bag_size` enum — the retail bag's net weight. */
export const BAG_SIZES = ["250g", "340g", "454g", "1kg", "12oz"] as const;
export type BagSize = (typeof BAG_SIZES)[number];

/** Validated, domain-shaped create-SKU args (camelCase). */
export interface CreateSkuInput {
  productId: number;
  /** The green lot backing this bag — the keystone traceability link. */
  greenLotCode: string;
  /** The P3-S10 roast→product link; null ⇒ not linked. */
  roastSkuId: number | null;
  packFormat: PackFormat;
  bagSize: BagSize;
  /** Retail price (USD cents, integer >= 0). */
  priceUsdCents: number;
  /** GS1 bag-label identity; null ⇒ not assigned. */
  gtin: string | null;
  /** Stripe price handle (P3-S12 seam); null ⇒ not synced. */
  stripePriceId: string | null;
  isReserveClub: boolean;
  idempotencyKey: string;
}

/** Is `v` blank (absent / empty after trim)? */
function isBlank(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "");
}

function isPackFormat(v: string): v is PackFormat {
  return (PACK_FORMATS as readonly string[]).includes(v);
}

function isBagSize(v: string): v is BagSize {
  return (BAG_SIZES as readonly string[]).includes(v);
}

/** Coerce a form value to a boolean (a checkbox/string-or-boolean). Blank ⇒ false. */
function toBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "on" || s === "1" || s === "yes";
  }
  return false;
}

/**
 * Pure validation of a raw create-SKU request — mirrors the `product_skus` constraints
 * (the pack_format / bag_size enums, `price_usd_cents >= 0` integer, the keystone
 * green-lot link) so errors surface before the round-trip. The lot-backing guard +
 * tenant clamp are the RPC's / data layer's job (invariant 5, ADR-002).
 */
export function validateCreateSku(
  raw: Record<string, unknown>,
): ValidationResult<CreateSkuInput> {
  const errors: Record<string, string> = {};

  const productId = toNumber(raw.productId);
  if (productId === null || !Number.isInteger(productId) || productId <= 0) {
    errors.productId = "Choose a product.";
  }

  const greenLotCode = trimmed(raw.greenLotCode);
  if (!greenLotCode) errors.greenLotCode = "Choose a green lot.";

  // roast SKU link: optional; if supplied must be a positive integer.
  let roastSkuId: number | null = null;
  if (!isBlank(raw.roastSkuId)) {
    const rs = toNumber(raw.roastSkuId);
    if (rs === null || !Number.isInteger(rs) || rs <= 0) {
      errors.roastSkuId = "Pick a valid roast SKU.";
    } else {
      roastSkuId = rs;
    }
  }

  const rawPack = trimmed(raw.packFormat);
  if (!rawPack) errors.packFormat = "Choose a pack format.";
  else if (!isPackFormat(rawPack)) errors.packFormat = "Choose a valid pack format.";

  const rawSize = trimmed(raw.bagSize);
  if (!rawSize) errors.bagSize = "Choose a bag size.";
  else if (!isBagSize(rawSize)) errors.bagSize = "Choose a valid bag size.";

  const priceUsdCents = toNumber(raw.priceUsdCents);
  if (
    priceUsdCents === null ||
    !Number.isInteger(priceUsdCents) ||
    priceUsdCents < 0
  ) {
    errors.priceUsdCents = "Price (in cents) must be a whole number of 0 or more.";
  }

  // Optional nullable text columns: blank ⇒ null.
  const gtin = trimmed(raw.gtin) || null;
  const stripePriceId = trimmed(raw.stripePriceId) || null;

  const isReserveClub = toBool(raw.isReserveClub);

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      productId: productId as number,
      greenLotCode,
      roastSkuId,
      packFormat: rawPack as PackFormat,
      bagSize: rawSize as BagSize,
      priceUsdCents: priceUsdCents as number,
      gtin,
      stripePriceId,
      isReserveClub,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint SKU id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method `create_sku` needs. */
export interface CreateSkuStore {
  rpc(fn: "create_sku", args: Record<string, unknown>): PromiseLike<RpcResult>;
}

/** Outcome of the command: the new SKU's id, or friendly/labelled errors. */
export type CreateSkuResult =
  | { ok: true; skuId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `create_sku` onto a family-readable sentence — the FK
 * + the RPC's guards are the real wall, but the family must never see raw PG text
 * (the `SKU lot-backing guard:` engine prefix, constraint names, errcodes). Returns
 * null for anything unrecognised so the caller can fall back to a generic message.
 */
export function friendlyCreateSkuError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  // INVARIANT 5: a SKU can't claim a green lot it isn't backed by.
  if (/lot-backing guard|green lot .* does not exist|product_skus_green_lot_tfk/.test(m)) {
    return "That green lot couldn't be found — a bag can only be linked to a lot you actually have. Pick a lot from the list and try again.";
  }
  if (/unknown product/.test(m)) {
    return "That product couldn't be found. Pick a product from the list and try again.";
  }
  if (/unknown roast_sku/.test(m)) {
    return "That roast SKU couldn't be found. Pick a roast SKU from the list (or leave it blank).";
  }
  if (/invalid input value for enum/.test(m) || error.code === "22P02") {
    return "Choose a valid pack format and bag size, then try again.";
  }
  return null;
}

/**
 * Validate then create: calls `create_sku` exactly once with the snake_case argument
 * envelope (arg order matches the RPC signature). Bad input never reaches the RPC
 * (friendly errors); the data-layer lot-backing guard (invariant 5) surfaces as a
 * CLEAN, family-readable sentence, any other failure surfaces a generic clean message.
 * Exactly-once on `idempotencyKey`.
 */
export async function createSku(
  store: CreateSkuStore,
  raw: Record<string, unknown>,
): Promise<CreateSkuResult> {
  const parsed = validateCreateSku(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("create_sku", {
    p_product_id: parsed.data.productId,
    p_green_lot_code: parsed.data.greenLotCode,
    p_roast_sku_id: parsed.data.roastSkuId,
    p_pack_format: parsed.data.packFormat,
    p_bag_size: parsed.data.bagSize,
    p_price_usd_cents: parsed.data.priceUsdCents,
    p_gtin: parsed.data.gtin,
    p_stripe_price_id: parsed.data.stripePriceId,
    p_is_reserve_club: parsed.data.isReserveClub,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyCreateSkuError(error) ??
        "This SKU couldn't be created right now. Please check the details and try again.",
    };
  }
  if (data == null) {
    return {
      ok: false,
      message: "This SKU couldn't be created right now. Please try again.",
    };
  }
  return { ok: true, skuId: Number(data) };
}
