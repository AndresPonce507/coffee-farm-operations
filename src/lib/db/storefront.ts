import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/* ====================================================================== */
/* P3-S11 — DTC Storefront READ-port (catalog + lot-linked SKUs + finished- */
/* goods inventory). The first consumer-trunk slice: a `products` roasted-   */
/* SKU master, a `product_skus` table whose load-bearing composite FK to     */
/* green_lots makes every retail bag traceable back to its green lot (and its */
/* full lot_edges ancestry), an append-only `fg_ledger` whose trigger rolls   */
/* signed movements into the `finished_goods` aggregate (available = on_hand  */
/* − allocated, mirroring green_lots_atp), and the `finished_goods_atp` read   */
/* view the /shop catalog manager reads. This port only READS; the only       */
/* writers are the SECURITY DEFINER RPCs in the command ports                 */
/* (`@/lib/db/commands/createProduct`, `createSku`, `recordFgMovement`).       */
/* Mirrors the pricing.ts / roasting.ts shape: `Row` interface + pure `mapX`   */
/* mapper + `cache()`'d getters; NULLs (an un-set variety/process/notes, an    */
/* un-linked roast SKU, an un-assigned GTIN / Stripe price) are PRESERVED,     */
/* never fabricated — the UI shows "—" instead of a misleading value.          */
/* ====================================================================== */

/** The `pack_format` enum — how the retail bag is ground. */
export type PackFormat = "whole-bean" | "ground";

/** The `bag_size` enum — the retail bag's net weight. */
export type BagSize = "250g" | "340g" | "454g" | "1kg" | "12oz";

/** The `fg_ledger.reason` CHECK — the movement's cause. */
export type FgReason =
  | "roast-in"
  | "sale"
  | "subscription-fulfill"
  | "adjust"
  | "return";

/** Coerce a nullable numeric (PostgREST may serialize bigint/integer as a string)
 *  to a number, PRESERVING null — an un-linked roast_sku_id stays null (never a
 *  fabricated 0). */
function num(v: number | string | null | undefined): number | null {
  return v == null ? null : Number(v);
}

/* ---------------- products ---------------- */

/** Shape of a `products` row (snake_case). `variety` / `process` / `tasting_notes`
 *  are NULL until set (a house blend may span varieties; notes are optional). */
export interface ProductRow {
  id: number | string;
  slug: string;
  name: string;
  variety: string | null;
  process: string | null;
  tasting_notes: string | null;
  is_active: boolean;
  created_at: string;
}

/** One roasted-SKU master (the catalog product behind one or more lot-linked SKUs). */
export interface Product {
  id: number;
  slug: string;
  name: string;
  /** NULL ⇒ a blend / house style spanning varieties. */
  variety: string | null;
  /** NULL ⇒ process not declared. */
  process: string | null;
  /** NULL ⇒ no tasting notes yet. */
  tastingNotes: string | null;
  isActive: boolean;
  createdAt: string;
}

/** Pure row → domain mapper for a product (numeric id coercion; NULL variety /
 *  process / notes preserved, never fabricated). */
export function mapProduct(r: ProductRow): Product {
  return {
    id: Number(r.id),
    slug: r.slug,
    name: r.name,
    variety: r.variety,
    process: r.process,
    tastingNotes: r.tasting_notes,
    isActive: r.is_active,
    createdAt: r.created_at,
  };
}

/* ---------------- product_skus ---------------- */

/** Shape of a `product_skus` row (snake_case). `roast_sku_id` / `stripe_price_id` /
 *  `gtin` may be NULL (un-linked roast / un-priced in Stripe / un-assigned GTIN).
 *  `price_usd_cents` is NOT NULL (the `>= 0` CHECK guards it). */
export interface ProductSkuRow {
  id: number | string;
  product_id: number | string;
  green_lot_code: string;
  roast_sku_id: number | string | null;
  pack_format: PackFormat | string;
  bag_size: BagSize | string;
  price_usd_cents: number | string;
  stripe_price_id: string | null;
  gtin: string | null;
  is_reserve_club: boolean;
  is_active: boolean;
  created_at: string;
}

/** One lot-linked sellable unit — the keystone traceability link
 *  (`greenLotCode` → green_lots → the full lot_edges ancestry). */
export interface ProductSku {
  id: number;
  productId: number;
  /** The green lot backing this bag (the FK + create_sku guard enforce it exists). */
  greenLotCode: string;
  /** The P3-S10 roast→product link. NULL ⇒ not linked to a roast SKU. */
  roastSkuId: number | null;
  packFormat: PackFormat | string;
  bagSize: BagSize | string;
  /** Retail price (USD cents). */
  priceUsdCents: number;
  /** Stripe price handle (P3-S12 seam). NULL ⇒ not synced to Stripe. */
  stripePriceId: string | null;
  /** GS1 bag-label identity. NULL ⇒ not assigned. */
  gtin: string | null;
  isReserveClub: boolean;
  isActive: boolean;
  createdAt: string;
}

/** Pure row → domain mapper for a SKU (numeric coercion; NULL roast link / Stripe /
 *  GTIN preserved; the keystone greenLotCode carried verbatim). */
export function mapProductSku(r: ProductSkuRow): ProductSku {
  return {
    id: Number(r.id),
    productId: Number(r.product_id),
    greenLotCode: r.green_lot_code,
    roastSkuId: num(r.roast_sku_id),
    packFormat: r.pack_format,
    bagSize: r.bag_size,
    priceUsdCents: Number(r.price_usd_cents),
    stripePriceId: r.stripe_price_id,
    gtin: r.gtin,
    isReserveClub: r.is_reserve_club,
    isActive: r.is_active,
    createdAt: r.created_at,
  };
}

/* ---------------- fg_ledger ---------------- */

/** Shape of an `fg_ledger` row (snake_case) — one signed finished-goods movement. */
export interface FgLedgerRow {
  id: number | string;
  sku_id: number | string;
  qty_units: number | string;
  reason: FgReason | string;
  created_at: string;
}

/** One append-only finished-goods movement (roast-in / sale / subscription-fulfill /
 *  adjust / return). Corrections are reversing rows, never edits. */
export interface FgLedgerEntry {
  id: number;
  skuId: number;
  /** Signed on-hand delta (positive = stock in, negative = stock out). */
  qtyUnits: number;
  reason: FgReason | string;
  createdAt: string;
}

/** Pure row → domain mapper for a ledger movement (numeric coercion; signed qty
 *  carried verbatim). */
export function mapFgLedgerEntry(r: FgLedgerRow): FgLedgerEntry {
  return {
    id: Number(r.id),
    skuId: Number(r.sku_id),
    qtyUnits: Number(r.qty_units),
    reason: r.reason,
    createdAt: r.created_at,
  };
}

/* ---------------- finished_goods_atp ---------------- */

/** Shape of a `finished_goods_atp` view row (snake_case) — the /shop board read
 *  model: per-SKU on_hand/allocated/available + its product + the keystone lot.
 *  `roast_sku_id` may be NULL. Unit columns may serialize as strings. */
export interface FinishedGoodsAtpRow {
  sku_id: number | string;
  product_id: number | string;
  green_lot_code: string;
  roast_sku_id: number | string | null;
  pack_format: PackFormat | string;
  bag_size: BagSize | string;
  price_usd_cents: number | string;
  is_reserve_club: boolean;
  is_active: boolean;
  product_slug: string;
  product_name: string;
  on_hand_units: number | string;
  allocated_units: number | string;
  available_units: number | string;
}

/** Per-SKU available-to-promise finished goods (the /shop catalog manager's board:
 *  available = on_hand − allocated, the fail-closed retail-inventory mirror of
 *  green_lots_atp). */
export interface FinishedGoodsAtp {
  skuId: number;
  productId: number;
  greenLotCode: string;
  roastSkuId: number | null;
  packFormat: PackFormat | string;
  bagSize: BagSize | string;
  priceUsdCents: number;
  isReserveClub: boolean;
  isActive: boolean;
  productSlug: string;
  productName: string;
  onHandUnits: number;
  allocatedUnits: number;
  /** on_hand − allocated (DB-GENERATED). The fail-closed sellable count. */
  availableUnits: number;
}

/** Pure row → domain mapper for an ATP row (numeric coercion of units/price; NULL
 *  roast link preserved). */
export function mapFinishedGoodsAtp(r: FinishedGoodsAtpRow): FinishedGoodsAtp {
  return {
    skuId: Number(r.sku_id),
    productId: Number(r.product_id),
    greenLotCode: r.green_lot_code,
    roastSkuId: num(r.roast_sku_id),
    packFormat: r.pack_format,
    bagSize: r.bag_size,
    priceUsdCents: Number(r.price_usd_cents),
    isReserveClub: r.is_reserve_club,
    isActive: r.is_active,
    productSlug: r.product_slug,
    productName: r.product_name,
    onHandUnits: Number(r.on_hand_units),
    allocatedUnits: Number(r.allocated_units),
    availableUnits: Number(r.available_units),
  };
}

/* ---------------- getters (request-scoped cache) ---------------- */

/**
 * The roasted-SKU master (`products`), ordered by name — the /shop catalog
 * manager's product list. `is_active` carries the publish toggle.
 */
export const getProducts = cache(async (): Promise<Product[]> => {
  const { data, error } = await (await getSupabase())
    .from("products")
    .select("*")
    .order("name");
  if (error) throw new Error(`getProducts: ${error.message}`);
  return (data as ProductRow[]).map(mapProduct);
});

/**
 * Every lot-linked SKU (`product_skus`), newest first — the full catalogue of
 * sellable units (each carrying its keystone `greenLotCode` traceability link).
 */
export const listProductSkus = cache(async (): Promise<ProductSku[]> => {
  const { data, error } = await (await getSupabase())
    .from("product_skus")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listProductSkus: ${error.message}`);
  return (data as ProductSkuRow[]).map(mapProductSku);
});

/**
 * A product's SKUs (`product_skus` filtered to one product), newest first — the
 * /shop product-detail "Variants" panel.
 */
export const getProductSkusForProduct = cache(
  async (productId: number): Promise<ProductSku[]> => {
    const { data, error } = await (await getSupabase())
      .from("product_skus")
      .select("*")
      .eq("product_id", productId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`getProductSkusForProduct: ${error.message}`);
    return (data as ProductSkuRow[]).map(mapProductSku);
  },
);

/**
 * The finished-goods board (`finished_goods_atp`), ordered by product then SKU —
 * the /shop catalog manager's inventory board (on_hand / allocated / available per
 * SKU, with its product + keystone lot). The lot picker reads green_lots_atp; this
 * is the retail-inventory mirror.
 */
export const getFinishedGoodsAtp = cache(
  async (): Promise<FinishedGoodsAtp[]> => {
    const { data, error } = await (await getSupabase())
      .from("finished_goods_atp")
      .select("*")
      .order("product_name")
      .order("sku_id");
    if (error) throw new Error(`getFinishedGoodsAtp: ${error.message}`);
    return (data as FinishedGoodsAtpRow[]).map(mapFinishedGoodsAtp);
  },
);

/**
 * One SKU's finished-goods row (`finished_goods_atp` filtered to the SKU), or `null`
 * when it has no row — the /shop/[sku] detail panel + the movement form's live ATP.
 */
export const getFinishedGoodsAtpForSku = cache(
  async (skuId: number): Promise<FinishedGoodsAtp | null> => {
    const { data, error } = await (await getSupabase())
      .from("finished_goods_atp")
      .select("*")
      .eq("sku_id", skuId);
    if (error) throw new Error(`getFinishedGoodsAtpForSku: ${error.message}`);
    const rows = (data as FinishedGoodsAtpRow[] | null) ?? [];
    return rows.length > 0 ? mapFinishedGoodsAtp(rows[0]) : null;
  },
);

/**
 * The append-only finished-goods movement ledger (`fg_ledger`), newest first — the
 * full audit trail behind every finished_goods aggregate (the provenance source).
 */
export const listFgLedger = cache(async (): Promise<FgLedgerEntry[]> => {
  const { data, error } = await (await getSupabase())
    .from("fg_ledger")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listFgLedger: ${error.message}`);
  return (data as FgLedgerRow[]).map(mapFgLedgerEntry);
});

/**
 * One SKU's movement history (`fg_ledger` filtered to the SKU), newest first — the
 * /shop/[sku] "Movements" panel.
 */
export const getFgLedgerForSku = cache(
  async (skuId: number): Promise<FgLedgerEntry[]> => {
    const { data, error } = await (await getSupabase())
      .from("fg_ledger")
      .select("*")
      .eq("sku_id", skuId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`getFgLedgerForSku: ${error.message}`);
    return (data as FgLedgerRow[]).map(mapFgLedgerEntry);
  },
);
