import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/**
 * /orders read port (P3-S12 DTC orders + Stripe Checkout).
 *
 * Co-located with the route on purpose: it binds DIRECTLY to the authoritative SQL
 * surface the P3-S12 migration shipped — the `v_order_book` and `v_order_cogs`
 * security_invoker views — rather than a sibling `@/lib/db/orders` port (which a
 * parallel fan-out may build; importing a not-yet-existent module hard-fails Vite's
 * import-analysis at both test and build time). The Wiring pass can collapse this
 * into the shared port with one import swap once it lands.
 *
 * READ-ONLY. Every order write goes through the SECURITY DEFINER RPCs (create_order
 * is the storefront checkout door; mark_order_paid / issue_dgi_cufe are service_role
 * only — the Stripe webhook and the PAC stamp, never a browser). This admin board
 * only reads. COGS is the per-lot cost FLOOR (`mv_lot_cost.cost_per_kg_green`); it is
 * NULL when cost was never booked — flagged here, NEVER fabricated (rail §5).
 */

export type OrderChannel = "web" | "pos" | "wholesale";
export type OrderStatus =
  | "pending"
  | "paid"
  | "fulfilled"
  | "cancelled"
  | "refunded";

/** One row of `v_order_book` — an order with its server-computed money + fiscal state. */
export interface OrderRow {
  id: number;
  channel: OrderChannel;
  status: OrderStatus;
  currency: string;
  subtotalCents: number;
  dgiTaxCents: number;
  totalCents: number;
  /** Internal/fiscal folio; NULL ⇒ pending fiscal stamp (the $0 non-fiscal path). */
  dgiCufe: string | null;
  stripePaymentIntent: string | null;
  customerEmail: string | null;
  customerName: string | null;
  lineCount: number;
  createdAt: string;
}

/** One line of `v_order_cogs` — the per-lot cost floor behind an order line. */
export interface OrderCogsRow {
  orderId: number;
  greenLotCode: string;
  qtyUnits: number;
  lineTotalCents: number;
  /** cost-per-kg-green floor; NULL ⇒ COGS not booked ("cost unknown"). */
  costPerKgGreen: number | null;
}

interface OrderBookViewRow {
  id: number | string;
  channel: string;
  status: string;
  currency: string | null;
  subtotal_cents: number | string;
  dgi_tax_cents: number | string;
  total_cents: number | string;
  dgi_cufe: string | null;
  stripe_payment_intent: string | null;
  customer_email: string | null;
  customer_name: string | null;
  line_count: number | string;
  created_at: string;
}

interface OrderCogsViewRow {
  order_id: number | string;
  green_lot_code: string;
  qty_units: number | string;
  line_total_cents: number | string;
  cost_per_kg_green: number | string | null;
}

/** Coerce a PostgREST numeric (which may arrive as a string) to a number. */
const i = (v: number | string | null | undefined): number =>
  v == null ? 0 : Number(v);
/** Coerce while PRESERVING null (never fabricate a 0 for unknown COGS). */
const n = (v: number | string | null | undefined): number | null =>
  v == null ? null : Number(v);

/** Every order, newest first, with its server-computed totals + fiscal state. */
export const getOrderBook = cache(async (): Promise<OrderRow[]> => {
  const { data, error } = await (await getSupabase())
    .from("v_order_book")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`getOrderBook: ${error.message}`);
  return (data as OrderBookViewRow[]).map((r) => ({
    id: i(r.id),
    channel: (["web", "pos", "wholesale"].includes(r.channel)
      ? r.channel
      : "web") as OrderChannel,
    status: r.status as OrderStatus,
    currency: r.currency ?? "USD",
    subtotalCents: i(r.subtotal_cents),
    dgiTaxCents: i(r.dgi_tax_cents),
    totalCents: i(r.total_cents),
    dgiCufe: r.dgi_cufe,
    stripePaymentIntent: r.stripe_payment_intent,
    customerEmail: r.customer_email,
    customerName: r.customer_name,
    lineCount: i(r.line_count),
    createdAt: r.created_at,
  }));
});

/** Every order line's per-lot cost floor (NULL ⇒ flagged, never fabricated). */
export const getOrderCogs = cache(async (): Promise<OrderCogsRow[]> => {
  const { data, error } = await (await getSupabase())
    .from("v_order_cogs")
    .select("*")
    .order("order_id", { ascending: false });
  if (error) throw new Error(`getOrderCogs: ${error.message}`);
  return (data as OrderCogsViewRow[]).map((r) => ({
    orderId: i(r.order_id),
    greenLotCode: r.green_lot_code,
    qtyUnits: i(r.qty_units),
    lineTotalCents: i(r.line_total_cents),
    costPerKgGreen: n(r.cost_per_kg_green),
  }));
});
