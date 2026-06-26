import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/**
 * /pos read port (P3-S14 offline DGI farm-store/café POS).
 *
 * Co-located with the route on purpose: it binds DIRECTLY to the authoritative SQL
 * surface the P3-S14 migration shipped — `pos_terminals` (the registered tills),
 * `finished_goods_atp` (the S11 sellable-SKU ATP view), and `v_pos_sales_book` (the
 * S14 history projection) — rather than to a sibling `@/lib/db` port. Two reasons:
 * (1) a parallel fan-out builds those ports in sibling files, and importing a
 * not-yet-existent module hard-fails Vite's import-analysis at BOTH test and build
 * time; (2) the only load-bearing contract here is the view/column names, which are
 * frozen. The Wiring pass can collapse this once those ports land.
 *
 * READ-ONLY. Every write goes through the `record_pos_sale` SECURITY DEFINER RPC in
 * `actions.ts`. Money lives in integer cents on the wire (the orders/finished_goods
 * schema) and is formatted to USD at the edge — never re-derived here.
 */

/** A registered till. */
export interface PosTerminal {
  id: number;
  code: string;
  name: string;
  location: string | null;
  isActive: boolean;
}

/** One sellable SKU on the shelf (mirrors `finished_goods_atp`, active rows). */
export interface SellableSku {
  skuId: number;
  productName: string;
  productSlug: string;
  greenLotCode: string;
  packFormat: string;
  bagSize: string;
  priceUsdCents: number;
  isReserveClub: boolean;
  availableUnits: number;
}

/** One recorded POS sale (mirrors `v_pos_sales_book`). */
export interface PosSaleRow {
  id: number;
  saleNo: string;
  terminalCode: string;
  terminalName: string;
  status: string;
  currency: string;
  subtotalCents: number;
  dgiTaxCents: number;
  totalCents: number;
  customerName: string | null;
  lineCount: number;
  /** NULL on the $0 non-fiscal path (an internal recibo); a CUFE once a PAC stamps it. */
  dgiCufe: string | null;
  createdAt: string;
}

interface TerminalRow {
  id: number;
  code: string;
  name: string;
  location: string | null;
  is_active: boolean;
}

interface SkuRow {
  sku_id: number;
  product_name: string;
  product_slug: string;
  green_lot_code: string;
  pack_format: string;
  bag_size: string;
  price_usd_cents: number | string;
  is_reserve_club: boolean;
  available_units: number | string | null;
}

interface SaleViewRow {
  id: number;
  sale_no: string;
  terminal_code: string;
  terminal_name: string;
  status: string;
  currency: string;
  subtotal_cents: number | string;
  dgi_tax_cents: number | string;
  total_cents: number | string;
  customer_name: string | null;
  line_count: number | string | null;
  dgi_cufe: string | null;
  created_at: string;
}

/** Coerce a PostgREST integer (which may arrive as a string) to a number. */
const i = (v: number | string | null | undefined): number =>
  v == null ? 0 : Number(v);

export function mapTerminal(r: TerminalRow): PosTerminal {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    location: r.location,
    isActive: r.is_active,
  };
}

export function mapSku(r: SkuRow): SellableSku {
  return {
    skuId: r.sku_id,
    productName: r.product_name,
    productSlug: r.product_slug,
    greenLotCode: r.green_lot_code,
    packFormat: r.pack_format,
    bagSize: r.bag_size,
    priceUsdCents: i(r.price_usd_cents),
    isReserveClub: r.is_reserve_club,
    availableUnits: i(r.available_units),
  };
}

export function mapSale(r: SaleViewRow): PosSaleRow {
  return {
    id: r.id,
    saleNo: r.sale_no,
    terminalCode: r.terminal_code,
    terminalName: r.terminal_name,
    status: r.status,
    currency: r.currency,
    subtotalCents: i(r.subtotal_cents),
    dgiTaxCents: i(r.dgi_tax_cents),
    totalCents: i(r.total_cents),
    customerName: r.customer_name,
    lineCount: i(r.line_count),
    dgiCufe: r.dgi_cufe,
    createdAt: r.created_at,
  };
}

/** The active tills the cashier can ring up against. */
export const getPosTerminals = cache(async (): Promise<PosTerminal[]> => {
  const sb = await getSupabase();
  const { data, error } = await sb
    .from("pos_terminals")
    .select("id, code, name, location, is_active")
    .eq("is_active", true)
    .order("code");
  if (error) throw new Error(`getPosTerminals: ${error.message}`);
  return (data as TerminalRow[]).map(mapTerminal);
});

/** Every active, on-the-shelf SKU (the big-touch product tiles). */
export const getSellableSkus = cache(async (): Promise<SellableSku[]> => {
  const sb = await getSupabase();
  const { data, error } = await sb
    .from("finished_goods_atp")
    .select(
      "sku_id, product_name, product_slug, green_lot_code, pack_format, bag_size, price_usd_cents, is_reserve_club, available_units, is_active",
    )
    .eq("is_active", true)
    .order("product_name");
  if (error) throw new Error(`getSellableSkus: ${error.message}`);
  return (data as SkuRow[]).map(mapSku);
});

/** The recent POS sales book (newest first) for the history surface. */
export const getPosSalesBook = cache(async (): Promise<PosSaleRow[]> => {
  const sb = await getSupabase();
  const { data, error } = await sb
    .from("v_pos_sales_book")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`getPosSalesBook: ${error.message}`);
  return (data as SaleViewRow[]).map(mapSale);
});
