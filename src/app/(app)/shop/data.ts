import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/**
 * /shop read port (P3-S11 catalog + lot-linked SKUs + finished-goods inventory).
 *
 * Co-located with the route: it binds DIRECTLY to the authoritative SQL surface the
 * P3-S11 migration shipped (20260706090000_storefront_skus.sql) —
 *   • `finished_goods_atp` (security_invoker) — the per-SKU board read: product + lot
 *     link + live on_hand/allocated/available units (mirrors green_lots_atp).
 *   • `product_skus` — read raw ONLY for the columns the view does not project (gtin),
 *     keyed by sku_id; tenant-clamped by its own RLS read policy.
 *   • `products` — the roasted-SKU master, for the create-SKU picker AND to enrich each
 *     card with its variety (the view carries the product name/slug, not the variety).
 *   • `green_lots_atp` — the lot picker source: every green lot with its ATP kg, so the
 *     owner backs a bag against real, available inventory.
 *
 * READ-ONLY. Every write goes through the SECURITY DEFINER RPCs in `actions.ts`
 * (create_product / create_sku / record_fg_movement) — the one write door.
 */

const num = (v: number | string | null | undefined): number | null =>
  v == null ? null : Number(v);
const int = (v: number | string | null | undefined): number =>
  v == null ? 0 : Math.trunc(Number(v));

/* ───────────────────────────── catalog board ───────────────────────────── */

export interface CatalogSku {
  skuId: number;
  productId: number;
  productSlug: string;
  productName: string;
  /** Enriched from `products`; the ATP view does not carry the variety. */
  variety: string | null;
  /** The keystone traceability link: every bag → its green lot's lot_edges chain. */
  greenLotCode: string;
  roastSkuId: number | null;
  packFormat: string;
  bagSize: string;
  priceUsdCents: number;
  gtin: string | null;
  isReserveClub: boolean;
  isActive: boolean;
  onHandUnits: number;
  allocatedUnits: number;
  availableUnits: number;
}

interface AtpViewRow {
  sku_id: number | string;
  product_id: number | string;
  product_slug: string;
  product_name: string;
  green_lot_code: string;
  roast_sku_id: number | string | null;
  pack_format: string;
  bag_size: string;
  price_usd_cents: number | string;
  is_reserve_club: boolean;
  is_active: boolean;
  on_hand_units: number | string;
  allocated_units: number | string;
  available_units: number | string;
}

export const getCatalog = cache(async (): Promise<CatalogSku[]> => {
  const sb = await getSupabase();
  const [atp, skus, products] = await Promise.all([
    sb.from("finished_goods_atp").select("*").order("product_name"),
    sb.from("product_skus").select("id, gtin"),
    sb.from("products").select("id, variety"),
  ]);

  if (atp.error) throw new Error(`getCatalog: ${atp.error.message}`);
  if (skus.error) throw new Error(`getCatalog(gtin): ${skus.error.message}`);
  if (products.error) throw new Error(`getCatalog(variety): ${products.error.message}`);

  const gtinBySku = new Map<number, string | null>(
    (skus.data as { id: number | string; gtin: string | null }[]).map((s) => [
      Number(s.id),
      s.gtin,
    ]),
  );
  const varietyByProduct = new Map<number, string | null>(
    (products.data as { id: number | string; variety: string | null }[]).map((p) => [
      Number(p.id),
      p.variety,
    ]),
  );

  return (atp.data as AtpViewRow[]).map((r) => {
    const skuId = Number(r.sku_id);
    const productId = Number(r.product_id);
    return {
      skuId,
      productId,
      productSlug: r.product_slug,
      productName: r.product_name,
      variety: varietyByProduct.get(productId) ?? null,
      greenLotCode: r.green_lot_code,
      roastSkuId: num(r.roast_sku_id),
      packFormat: r.pack_format,
      bagSize: r.bag_size,
      priceUsdCents: int(r.price_usd_cents),
      gtin: gtinBySku.get(skuId) ?? null,
      isReserveClub: r.is_reserve_club,
      isActive: r.is_active,
      onHandUnits: int(r.on_hand_units),
      allocatedUnits: int(r.allocated_units),
      availableUnits: int(r.available_units),
    };
  });
});

/* ─────────────────────────── product master picker ─────────────────────── */

export interface CatalogProduct {
  id: number;
  slug: string;
  name: string;
  variety: string | null;
  process: string | null;
  tastingNotes: string | null;
  isActive: boolean;
}

interface ProductRow {
  id: number | string;
  slug: string;
  name: string;
  variety: string | null;
  process: string | null;
  tasting_notes: string | null;
  is_active: boolean;
}

export const getProducts = cache(async (): Promise<CatalogProduct[]> => {
  const sb = await getSupabase();
  const { data, error } = await sb
    .from("products")
    .select("id, slug, name, variety, process, tasting_notes, is_active")
    .order("name");
  if (error) throw new Error(`getProducts: ${error.message}`);
  return (data as ProductRow[]).map((p) => ({
    id: Number(p.id),
    slug: p.slug,
    name: p.name,
    variety: p.variety,
    process: p.process,
    tastingNotes: p.tasting_notes,
    isActive: p.is_active,
  }));
});

/* ───────────────────────────── green-lot picker ────────────────────────── */

export interface LotPick {
  greenLotCode: string;
  scaGrade: string | null;
  location: string | null;
  currentKg: number | null;
  reservedKg: number | null;
  shippedKg: number | null;
  /** Available-to-promise kg (current − reserved − shipped), straight off the view. */
  atpKg: number | null;
}

interface LotAtpRow {
  green_lot_code: string;
  sca_grade: string | null;
  location: string | null;
  current_kg: number | string | null;
  reserved_kg: number | string | null;
  shipped_kg: number | string | null;
  atp: number | string | null;
}

export const getLotPicks = cache(async (): Promise<LotPick[]> => {
  const sb = await getSupabase();
  const { data, error } = await sb
    .from("green_lots_atp")
    .select("green_lot_code, sca_grade, location, current_kg, reserved_kg, shipped_kg, atp")
    .order("green_lot_code");
  if (error) throw new Error(`getLotPicks: ${error.message}`);
  return (data as LotAtpRow[]).map((l) => ({
    greenLotCode: l.green_lot_code,
    scaGrade: l.sca_grade,
    location: l.location,
    currentKg: num(l.current_kg),
    reservedKg: num(l.reserved_kg),
    shippedKg: num(l.shipped_kg),
    atpKg: num(l.atp),
  }));
});
