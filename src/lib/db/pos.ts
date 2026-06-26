import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/* ====================================================================== */
/* P3-S14 — Offline DGI farm-store/café POS READ-port (ADR-003 derived-read).*/
/* A POS sale IS an `order` with channel='pos': this slice does NOT          */
/* re-implement totals / ITBMS / oversell — it DELEGATES to the shipped S12  */
/* `create_order` + the S11 fail-closed finished_goods guard and layers the  */
/* POS concerns on top (a registered terminal, a human POS-NNNN folio, the   */
/* offline (device_id, device_seq) exactly-once coordinate, and the later    */
/* DGI fiscal stamp seam). The ONLY writers are the SECURITY DEFINER RPCs in  */
/* the command ports (`@/lib/db/commands/recordPosSale`,                      */
/* `registerPosTerminal`); this port only READS. Mirrors pricing.ts: `Row`   */
/* interface + pure `mapX` mapper + `cache()`'d getters; an un-stamped        */
/* `dgi_cufe` (pending fiscal stamp — the $0 non-fiscal recibo path) and a    */
/* walk-in's missing name are PRESERVED as null, never fabricated.            */
/* ====================================================================== */

/** The `order_status` enum — a POS order is 'paid' the moment it rings. */
export type OrderStatus =
  | "pending"
  | "paid"
  | "fulfilled"
  | "cancelled"
  | "refunded";

/** Coerce a nullable numeric (PostgREST may serialize as a string) to a number,
 *  PRESERVING null. POS cents columns are NOT NULL (defaulted in the order), so
 *  they round-trip through `Number()`; this helper guards the genuinely nullable
 *  seams without ever fabricating a 0. */
function num(v: number | string | null | undefined): number | null {
  return v == null ? null : Number(v);
}

/* ---------------- v_pos_sales_book ---------------- */

/** Shape of a `v_pos_sales_book` row as returned by PostgREST (snake_case).
 *  `dgi_cufe` is NULL until a (later) PAC stamp ($0 path keeps it NULL — a
 *  non-fiscal recibo). `customer_name` is nullable (a bare walk-in). The cents
 *  columns are the delegated order's server-computed totals. */
export interface PosSaleBookRow {
  id: number | string;
  sale_no: string;
  device_id: string;
  device_seq: number | string;
  dgi_cufe: string | null;
  created_at: string;
  terminal_code: string;
  terminal_name: string;
  order_id: number | string;
  status: OrderStatus | string;
  currency: string;
  subtotal_cents: number | string;
  dgi_tax_cents: number | string;
  total_cents: number | string;
  customer_email: string;
  customer_name: string | null;
  line_count: number | string;
}

/** One POS sale folio joined to its delegated order: the terminal, the
 *  server-computed subtotal / ITBMS / total (in cents), the offline
 *  (device_id, device_seq) coordinate and the fiscal-stamp status. */
export interface PosSaleBookEntry {
  id: number;
  saleNo: string;
  deviceId: string;
  deviceSeq: number;
  /** DGI fiscal folio (CUFE). NULL ⇒ pending stamp — the $0 non-fiscal recibo path. */
  dgiCufe: string | null;
  createdAt: string;
  terminalCode: string;
  terminalName: string;
  orderId: number;
  status: OrderStatus | string;
  currency: string;
  /** Goods subtotal, cents — the delegated `create_order`'s server-computed roll-up. */
  subtotalCents: number;
  /** ITBMS (Panama 7% sales tax), cents — server-computed, the client never sets it. */
  dgiTaxCents: number;
  /** Grand total, cents (subtotal + ITBMS). */
  totalCents: number;
  customerEmail: string;
  /** A bare walk-in has no name (the RPC defaults the email to walkin@pos.local). */
  customerName: string | null;
  lineCount: number;
}

/** Pure row → domain mapper for a POS sale folio (numeric coercion of the
 *  id/seq/cents columns; NULL dgi_cufe / customer name preserved). */
export function mapPosSaleBookEntry(r: PosSaleBookRow): PosSaleBookEntry {
  return {
    id: Number(r.id),
    saleNo: r.sale_no,
    deviceId: r.device_id,
    deviceSeq: Number(r.device_seq),
    dgiCufe: r.dgi_cufe,
    createdAt: r.created_at,
    terminalCode: r.terminal_code,
    terminalName: r.terminal_name,
    orderId: Number(r.order_id),
    status: r.status,
    currency: r.currency,
    subtotalCents: Number(r.subtotal_cents),
    dgiTaxCents: Number(r.dgi_tax_cents),
    totalCents: Number(r.total_cents),
    customerEmail: r.customer_email,
    customerName: r.customer_name,
    lineCount: Number(r.line_count),
  };
}

/* ---------------- pos_terminals ---------------- */

/** Shape of a `pos_terminals` row (snake_case) — the registered tills. */
export interface PosTerminalRow {
  id: number | string;
  code: string;
  name: string;
  location: string | null;
  is_active: boolean;
  created_at: string;
}

/** A registered POS terminal (Janson Farm Store / Lagunas Café) — the till the
 *  /pos surface rings sales against. */
export interface PosTerminal {
  id: number;
  code: string;
  name: string;
  location: string | null;
  isActive: boolean;
  createdAt: string;
}

/** Pure row → domain mapper for a terminal (numeric coercion of id; null
 *  location passthrough). */
export function mapPosTerminal(r: PosTerminalRow): PosTerminal {
  return {
    id: Number(r.id),
    code: r.code,
    name: r.name,
    location: r.location,
    isActive: r.is_active,
    createdAt: r.created_at,
  };
}

/* ---------------- getters (request-scoped cache) ---------------- */

/**
 * The day's POS sales book (`v_pos_sales_book`), newest folio first — every
 * POS-NNNN sale joined to its delegated order's server-computed totals + the
 * fiscal-stamp status. The /pos history surface reads this. `dgiCufe` is NULL
 * for an un-stamped (non-fiscal recibo) sale — surfaced as a "pending stamp"
 * badge, never a fabricated folio.
 */
export const getPosSalesBook = cache(async (): Promise<PosSaleBookEntry[]> => {
  const { data, error } = await (await getSupabase())
    .from("v_pos_sales_book")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`getPosSalesBook: ${error.message}`);
  return (data as PosSaleBookRow[]).map(mapPosSaleBookEntry);
});

/**
 * One POS sale folio (`v_pos_sales_book` filtered to the folio), or `null` when
 * the folio has no row yet (notFound() territory for a /pos/[sale] receipt page).
 * Same totals / fiscal-stamp semantics as `getPosSalesBook`.
 */
export const getPosSale = cache(
  async (saleNo: string): Promise<PosSaleBookEntry | null> => {
    const { data, error } = await (await getSupabase())
      .from("v_pos_sales_book")
      .select("*")
      .eq("sale_no", saleNo);
    if (error) throw new Error(`getPosSale: ${error.message}`);
    const rows = (data as PosSaleBookRow[] | null) ?? [];
    return rows.length > 0 ? mapPosSaleBookEntry(rows[0]) : null;
  },
);

/**
 * The registered POS terminals (`pos_terminals`), ordered by code — the tills the
 * /pos surface lets a barista pick from (Janson Farm Store / Lagunas Café).
 * `isActive` is surfaced so the picker disables a decommissioned till (the RPC
 * rejects a sale against an inactive terminal as the real wall).
 */
export const getPosTerminals = cache(async (): Promise<PosTerminal[]> => {
  const { data, error } = await (await getSupabase())
    .from("pos_terminals")
    .select("*")
    .order("code");
  if (error) throw new Error(`getPosTerminals: ${error.message}`);
  return (data as PosTerminalRow[]).map(mapPosTerminal);
});
