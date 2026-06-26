import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/* ====================================================================== */
/* P3-S12 — DTC orders + Stripe Checkout + Reserve-Club subscriptions       */
/* READ-port (ADR-003 derived-read). The consumer-trunk order book +        */
/* subscription board read here; the ONLY writers are the SECURITY DEFINER  */
/* RPCs in the command ports (`@/lib/db/commands/*`). This port only READS.  */
/* Mirrors the pricing.ts / greenlots.ts shape: `Row` interface + pure      */
/* `mapX` mapper + `cache()`'d getters. NULLs (unknown COGS via mv_lot_cost, */
/* an un-stamped fiscal folio `dgi_cufe`, an absent Stripe id) are          */
/* PRESERVED, never fabricated — the UI shows "—" instead of a misleading 0  */
/* or empty string. Money is integer cents end-to-end (the orders table's    */
/* CHECK-guarded columns); they may arrive from PostgREST as strings, so the */
/* mappers coerce with Number().                                            */
/* ====================================================================== */

/** Coerce a nullable numeric (PostgREST may serialize as a string) to a
 *  number, PRESERVING null — an unknown COGS stays null (never a fabricated 0). */
function num(v: number | string | null | undefined): number | null {
  return v == null ? null : Number(v);
}

/* ---------------- v_order_book ---------------- */

/** Shape of a `v_order_book` row as returned by PostgREST (snake_case). Money
 *  columns are CHECK-guarded integers; `dgi_cufe` / `stripe_payment_intent` are
 *  NULL until the order is paid / fiscally stamped. */
export interface OrderBookRow {
  id: number;
  channel: string;
  status: string;
  currency: string;
  subtotal_cents: number | string;
  dgi_tax_cents: number | string;
  total_cents: number | string;
  stripe_payment_intent: string | null;
  dgi_cufe: string | null;
  idempotency_key: string | null;
  created_at: string;
  customer_email: string;
  customer_name: string | null;
  line_count: number | string;
}

/** One row of the admin order book: its channel/status, server-computed money
 *  totals (cents), Stripe + fiscal stamps, and the customer it belongs to. */
export interface OrderBookEntry {
  id: number;
  channel: string;
  status: string;
  currency: string;
  subtotalCents: number;
  dgiTaxCents: number;
  totalCents: number;
  /** Stripe PaymentIntent id; NULL until `mark_order_paid` settles the order. */
  stripePaymentIntent: string | null;
  /** DGI fiscal folio (CUFE); NULL until `issue_dgi_cufe` stamps it. */
  dgiCufe: string | null;
  idempotencyKey: string | null;
  createdAt: string;
  customerEmail: string;
  customerName: string | null;
  lineCount: number;
}

/** Pure row → domain mapper for an order-book entry (cents/line-count coerced;
 *  NULL Stripe id / fiscal folio / customer name preserved). */
export function mapOrderBookEntry(r: OrderBookRow): OrderBookEntry {
  return {
    id: Number(r.id),
    channel: r.channel,
    status: r.status,
    currency: r.currency,
    subtotalCents: Number(r.subtotal_cents),
    dgiTaxCents: Number(r.dgi_tax_cents),
    totalCents: Number(r.total_cents),
    stripePaymentIntent: r.stripe_payment_intent,
    dgiCufe: r.dgi_cufe,
    idempotencyKey: r.idempotency_key,
    createdAt: r.created_at,
    customerEmail: r.customer_email,
    customerName: r.customer_name,
    lineCount: Number(r.line_count),
  };
}

/* ---------------- order_lines ---------------- */

/** Shape of an `order_lines` row (snake_case). Each line captures `green_lot_code`
 *  for provenance + COGS. */
export interface OrderLineRow {
  id: number;
  order_id: number;
  sku_id: number;
  green_lot_code: string;
  qty_units: number | string;
  unit_price_cents: number | string;
  line_total_cents: number | string;
  created_at: string;
}

/** One captured order line: the SKU, its backing green lot, qty + the
 *  server-side unit/line price (cents). */
export interface OrderLine {
  id: number;
  orderId: number;
  skuId: number;
  greenLotCode: string;
  qtyUnits: number;
  unitPriceCents: number;
  lineTotalCents: number;
  createdAt: string;
}

/** Pure row → domain mapper for an order line (qty/price coerced to numbers). */
export function mapOrderLine(r: OrderLineRow): OrderLine {
  return {
    id: Number(r.id),
    orderId: Number(r.order_id),
    skuId: Number(r.sku_id),
    greenLotCode: r.green_lot_code,
    qtyUnits: Number(r.qty_units),
    unitPriceCents: Number(r.unit_price_cents),
    lineTotalCents: Number(r.line_total_cents),
    createdAt: r.created_at,
  };
}

/* ---------------- v_order_cogs ---------------- */

/** Shape of a `v_order_cogs` row (snake_case). `cost_per_kg_green` is NULL when
 *  no cost is booked for the line's green lot (flagged, never fabricated). */
export interface OrderCogsRow {
  order_id: number;
  sku_id: number;
  green_lot_code: string;
  qty_units: number | string;
  line_total_cents: number | string;
  cost_per_kg_green: number | string | null;
}

/** Per-order-line COGS: the line's revenue (cents) against the green lot's
 *  cost-per-kg-green from `mv_lot_cost`. NULL cost ⇒ "margin unknown". */
export interface OrderCogsLine {
  orderId: number;
  skuId: number;
  greenLotCode: string;
  qtyUnits: number;
  lineTotalCents: number;
  /** cost_per_kg_green from mv_lot_cost_secure; NULL ⇒ COGS unknown (flagged). */
  costPerKgGreen: number | null;
}

/** Pure row → domain mapper for a COGS line (NULL cost preserved, never 0). */
export function mapOrderCogsLine(r: OrderCogsRow): OrderCogsLine {
  return {
    orderId: Number(r.order_id),
    skuId: Number(r.sku_id),
    greenLotCode: r.green_lot_code,
    qtyUnits: Number(r.qty_units),
    lineTotalCents: Number(r.line_total_cents),
    costPerKgGreen: num(r.cost_per_kg_green),
  };
}

/* ---------------- v_subscription_board ---------------- */

/** Shape of a `v_subscription_board` row (snake_case). `allocated_kg` is the
 *  coalesced sum of this subscription's claims; `dunning_count` its dunning events. */
export interface SubscriptionBoardRow {
  id: number;
  cadence: string;
  status: string;
  stripe_subscription_id: string | null;
  started_at: string;
  customer_email: string;
  customer_name: string | null;
  allocated_kg: number | string;
  dunning_count: number | string;
}

/** One Reserve-Club subscription on the admin board: cadence/status, the
 *  customer, the kg allocated to it so far, and how many dunning events it has. */
export interface SubscriptionBoardEntry {
  id: number;
  cadence: string;
  status: string;
  stripeSubscriptionId: string | null;
  startedAt: string;
  customerEmail: string;
  customerName: string | null;
  allocatedKg: number;
  dunningCount: number;
}

/** Pure row → domain mapper for a subscription-board entry (kg/count coerced;
 *  NULL Stripe id / customer name preserved). */
export function mapSubscriptionBoardEntry(
  r: SubscriptionBoardRow,
): SubscriptionBoardEntry {
  return {
    id: Number(r.id),
    cadence: r.cadence,
    status: r.status,
    stripeSubscriptionId: r.stripe_subscription_id,
    startedAt: r.started_at,
    customerEmail: r.customer_email,
    customerName: r.customer_name,
    allocatedKg: Number(r.allocated_kg),
    dunningCount: Number(r.dunning_count),
  };
}

/* ---------------- sub_events ---------------- */

/** Shape of a `sub_events` row (snake_case). The append-only lifecycle ledger;
 *  `payload` is free-form jsonb. */
export interface SubEventRow {
  id: number;
  subscription_id: number;
  kind: string;
  payload: Record<string, unknown> | null;
  occurred_at: string;
  created_at: string;
}

/** One subscription lifecycle event (created/paused/.../allocated/dunning). */
export interface SubEvent {
  id: number;
  subscriptionId: number;
  kind: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  createdAt: string;
}

/** Pure row → domain mapper for a lifecycle event (null payload → {}). */
export function mapSubEvent(r: SubEventRow): SubEvent {
  return {
    id: Number(r.id),
    subscriptionId: Number(r.subscription_id),
    kind: r.kind,
    payload: r.payload ?? {},
    occurredAt: r.occurred_at,
    createdAt: r.created_at,
  };
}

/* ---------------- sub_allocations ---------------- */

/** Shape of a `sub_allocations` row (snake_case). The append-only claim linking a
 *  subscription cycle to the `lot_reservations` row that fired `prevent_oversell`. */
export interface SubAllocationRow {
  id: number;
  subscription_id: number;
  green_lot_code: string;
  kg: number | string;
  reservation_id: number;
  cycle_label: string;
  created_at: string;
}

/** One Reserve-Club allocation: the kg of a green lot promised to a subscription
 *  cycle, and the reservation id that backs it (the money-guarantee link). */
export interface SubAllocation {
  id: number;
  subscriptionId: number;
  greenLotCode: string;
  kg: number;
  reservationId: number;
  cycleLabel: string;
  createdAt: string;
}

/** Pure row → domain mapper for an allocation (kg/reservation id coerced). */
export function mapSubAllocation(r: SubAllocationRow): SubAllocation {
  return {
    id: Number(r.id),
    subscriptionId: Number(r.subscription_id),
    greenLotCode: r.green_lot_code,
    kg: Number(r.kg),
    reservationId: Number(r.reservation_id),
    cycleLabel: r.cycle_label,
    createdAt: r.created_at,
  };
}

/* ---------------- getters (request-scoped cache) ---------------- */

/**
 * The admin order book (`v_order_book`), newest order first — every order's
 * channel/status, server-computed money totals (cents), Stripe + fiscal stamps
 * and the customer it belongs to. The COGS-per-order panel reads `getOrderCogs`.
 */
export const getOrderBook = cache(async (): Promise<OrderBookEntry[]> => {
  const { data, error } = await (await getSupabase())
    .from("v_order_book")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`getOrderBook: ${error.message}`);
  return (data as OrderBookRow[]).map(mapOrderBookEntry);
});

/**
 * One order's captured lines (`order_lines`) — the SKU, its backing green lot,
 * qty and the server-side unit/line price (cents). The order-detail surface.
 */
export const getOrderLines = cache(
  async (orderId: number): Promise<OrderLine[]> => {
    const { data, error } = await (await getSupabase())
      .from("order_lines")
      .select("*")
      .eq("order_id", orderId)
      .order("id");
    if (error) throw new Error(`getOrderLines: ${error.message}`);
    return (data as OrderLineRow[]).map(mapOrderLine);
  },
);

/**
 * One order's per-line COGS (`v_order_cogs`) — revenue (cents) against each line's
 * green-lot cost-per-kg-green from `mv_lot_cost_secure`. `costPerKgGreen` is NULL
 * when no cost is booked (margin unknown — flagged in the UI, never fabricated).
 */
export const getOrderCogs = cache(
  async (orderId: number): Promise<OrderCogsLine[]> => {
    const { data, error } = await (await getSupabase())
      .from("v_order_cogs")
      .select("*")
      .eq("order_id", orderId);
    if (error) throw new Error(`getOrderCogs: ${error.message}`);
    return (data as OrderCogsRow[]).map(mapOrderCogsLine);
  },
);

/**
 * The Reserve-Club subscription board (`v_subscription_board`), newest first —
 * each subscription's cadence/status, the customer, kg allocated so far and the
 * dunning-event count (the allocation board + dunning queue source).
 */
export const getSubscriptionBoard = cache(
  async (): Promise<SubscriptionBoardEntry[]> => {
    const { data, error } = await (await getSupabase())
      .from("v_subscription_board")
      .select("*")
      .order("started_at", { ascending: false });
    if (error) throw new Error(`getSubscriptionBoard: ${error.message}`);
    return (data as SubscriptionBoardRow[]).map(mapSubscriptionBoardEntry);
  },
);

/**
 * One subscription's append-only lifecycle ledger (`sub_events`), newest first —
 * created/paused/resumed/skipped/swapped/cancelled/allocated/dunning. Corrections
 * are superseding rows; the ledger is immutable.
 */
export const getSubscriptionEvents = cache(
  async (subscriptionId: number): Promise<SubEvent[]> => {
    const { data, error } = await (await getSupabase())
      .from("sub_events")
      .select("*")
      .eq("subscription_id", subscriptionId)
      .order("occurred_at", { ascending: false });
    if (error) throw new Error(`getSubscriptionEvents: ${error.message}`);
    return (data as SubEventRow[]).map(mapSubEvent);
  },
);

/**
 * One subscription's append-only green-lot claims (`sub_allocations`) — each cycle's
 * kg of a green lot and the `lot_reservations` id that backs it (the reused
 * money-guarantee link). The allocation history on the subscription detail.
 */
export const getSubAllocations = cache(
  async (subscriptionId: number): Promise<SubAllocation[]> => {
    const { data, error } = await (await getSupabase())
      .from("sub_allocations")
      .select("*")
      .eq("subscription_id", subscriptionId)
      .order("created_at");
    if (error) throw new Error(`getSubAllocations: ${error.message}`);
    return (data as SubAllocationRow[]).map(mapSubAllocation);
  },
);
