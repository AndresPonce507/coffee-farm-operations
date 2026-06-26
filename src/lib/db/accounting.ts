import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/* ====================================================================== */
/* P3-S16 — Accounting spine READ-port (ADR-003 derived-read). The books'  */
/* financial sink every commerce slice drains into. This port only READS — */
/* the single write door for `fx_rate` is `record_fx_rate` (command port    */
/* `@/lib/db/commands/recordFxRate`); the AR mint/settle RPCs are P3-S17.    */
/* The append-only ledgers (`revenue_entry`, `ar_doc*`, `ar_payment`,        */
/* `fx_gain_loss_entry`, `fx_rate`) are immutable (UPDATE/DELETE rejected by  */
/* trigger); corrections are reversing/superseding rows. Mirrors the         */
/* pricing.ts / cogs.ts shape: `Row` interface + pure `mapX` mapper +        */
/* `cache()`'d getters. NULLs (an un-costed lot's margin, an un-FK'd green    */
/* lot, an optional incoterm/soft-ref) are PRESERVED, never fabricated to 0  */
/* — the UI shows "—" instead of a misleading number (the books invariant:   */
/* a fabricated margin is worse than an honest blank).                       */
/* ====================================================================== */

/** The `ar_doc_kind` enum — the AR instrument family. */
export type ArDocKind =
  | "proforma"
  | "commercial_invoice"
  | "credit_note"
  | "dtc_receipt";

/** The `ar_doc_status` enum — a DETERMINISTIC function of Σ payments (never manual). */
export type ArDocStatus =
  | "draft"
  | "issued"
  | "partially_paid"
  | "paid"
  | "void";

/** The `payment_method` enum — how inbound cash landed. */
export type PaymentMethod = "wire" | "ach" | "card" | "cash" | "yappy" | "check";

/** The `revenue_entry.source_kind` domain — which commerce slice booked the revenue. */
export type RevenueSourceKind =
  | "green_sale"
  | "auction"
  | "dtc_order"
  | "subscription"
  | "pos_sale"
  | "milling_service"
  | "tour";

/** Coerce a nullable numeric (PostgREST may serialize as a string) to a number,
 *  PRESERVING null — an un-costed lot's margin / a missing total stays null
 *  (never a fabricated 0). */
function num(v: number | string | null | undefined): number | null {
  return v == null ? null : Number(v);
}

/* ---------------- fx_rate (the canonical daily-rate SSOT) ---------------- */

/** Shape of an `fx_rate` row (snake_case) — one place a rate lives. */
export interface FxRateRow {
  id: number;
  as_of_date: string;
  base: string;
  quote: string;
  rate: number | string;
  source: string;
  created_at: string;
}

/** A daily base→quote FX rate — the SSOT a non-USD revenue/payment row traces to. */
export interface FxRate {
  id: number;
  asOfDate: string;
  base: string;
  quote: string;
  rate: number;
  source: string;
  createdAt: string;
}

/** Pure row → domain mapper for an FX rate (numeric coercion of the rate). */
export function mapFxRate(r: FxRateRow): FxRate {
  return {
    id: Number(r.id),
    asOfDate: r.as_of_date,
    base: r.base,
    quote: r.quote,
    rate: Number(r.rate),
    source: r.source,
    createdAt: r.created_at,
  };
}

/* ---------------- revenue_entry (the journal source) ---------------- */

/** Shape of a `revenue_entry` row (snake_case). `green_lot_code` is un-FK'd (like
 *  `cost_entry.target_code`) and may be NULL; a reversal carries a negative
 *  `amount_doc` + a `reverses_id`. */
export interface RevenueEntryRow {
  id: number;
  source_kind: RevenueSourceKind | string;
  green_lot_code: string | null;
  amount_doc: number | string;
  currency: string;
  amount_usd: number | string;
  fx_rate_used: number | string;
  reverses_id: number | string | null;
  memo: string | null;
  occurred_at: string;
  created_at: string;
}

/** The revenue-side mirror of `cost_entry` — the journal source + the per-lot
 *  margin half (`revenue_entry ⨝ mv_lot_cost`). Amounts are signed (a reversal is
 *  negative). */
export interface RevenueEntry {
  id: number;
  sourceKind: RevenueSourceKind | string;
  greenLotCode: string | null;
  amountDoc: number;
  currency: string;
  amountUsd: number;
  fxRateUsed: number;
  reversesId: number | null;
  memo: string | null;
  occurredAt: string;
  createdAt: string;
}

/** Pure row → domain mapper for a revenue entry (numeric coercion; null green lot /
 *  memo / reverses_id preserved; signed amounts kept as-is). */
export function mapRevenueEntry(r: RevenueEntryRow): RevenueEntry {
  return {
    id: Number(r.id),
    sourceKind: r.source_kind,
    greenLotCode: r.green_lot_code,
    amountDoc: Number(r.amount_doc),
    currency: r.currency,
    amountUsd: Number(r.amount_usd),
    fxRateUsed: Number(r.fx_rate_used),
    reversesId: r.reverses_id == null ? null : Number(r.reverses_id),
    memo: r.memo,
    occurredAt: r.occurred_at,
    createdAt: r.created_at,
  };
}

/* ---------------- v_lot_margin (THE number that closes the loop) ---------------- */

/** Shape of a `v_lot_margin` row (snake_case). Every cost-derived field is NULL
 *  when the lot has no booked COGS (an honest blank, never a fabricated margin). */
export interface LotMarginRow {
  green_lot_code: string;
  revenue_usd: number | string;
  green_kg: number | string | null;
  total_cost: number | string | null;
  cost_per_kg_green: number | string | null;
  revenue_per_kg_green: number | string | null;
  margin_per_kg_green: number | string | null;
  margin_usd: number | string | null;
}

/** Realized $/kg-green margin per lot — THE number that closes the Phase-1 loop:
 *  Phase-1 gave true cost-per-kg-green, this gives true margin-per-kg-green. NULL
 *  margin ⇒ the lot's COGS isn't booked yet (flagged, never faked). */
export interface LotMargin {
  greenLotCode: string;
  revenueUsd: number;
  greenKg: number | null;
  totalCost: number | null;
  costPerKgGreen: number | null;
  revenuePerKgGreen: number | null;
  marginPerKgGreen: number | null;
  marginUsd: number | null;
}

/** Pure row → domain mapper for a lot's realized margin (numeric coercion; every
 *  cost-derived NULL preserved — an un-costed lot shows "—", never a fake number). */
export function mapLotMargin(r: LotMarginRow): LotMargin {
  return {
    greenLotCode: r.green_lot_code,
    revenueUsd: Number(r.revenue_usd),
    greenKg: num(r.green_kg),
    totalCost: num(r.total_cost),
    costPerKgGreen: num(r.cost_per_kg_green),
    revenuePerKgGreen: num(r.revenue_per_kg_green),
    marginPerKgGreen: num(r.margin_per_kg_green),
    marginUsd: num(r.margin_usd),
  };
}

/* ---------------- v_ar_aging (per-doc balance + aging bucket) ---------------- */

/** An aging bucket band (days outstanding since issue). */
export type AgingBucket = "0-30" | "31-60" | "61-90" | "90+";

/** Shape of a `v_ar_aging` row (snake_case). */
export interface ArAgingRow {
  ar_doc_id: number;
  kind: ArDocKind | string;
  doc_number: string;
  status: ArDocStatus | string;
  total_usd: number | string;
  paid_usd: number | string;
  balance_usd: number | string;
  issued_at: string;
  days_outstanding: number | string;
  aging_bucket: AgingBucket | string;
}

/** Per AR doc: total, paid, balance, days outstanding, aging bucket — the AR board. */
export interface ArAging {
  arDocId: number;
  kind: ArDocKind | string;
  docNumber: string;
  status: ArDocStatus | string;
  totalUsd: number;
  paidUsd: number;
  balanceUsd: number;
  issuedAt: string;
  daysOutstanding: number;
  agingBucket: AgingBucket | string;
}

/** Pure row → domain mapper for an aging row (numeric coercion of totals/days). */
export function mapArAging(r: ArAgingRow): ArAging {
  return {
    arDocId: Number(r.ar_doc_id),
    kind: r.kind,
    docNumber: r.doc_number,
    status: r.status,
    totalUsd: Number(r.total_usd),
    paidUsd: Number(r.paid_usd),
    balanceUsd: Number(r.balance_usd),
    issuedAt: r.issued_at,
    daysOutstanding: Number(r.days_outstanding),
    agingBucket: r.aging_bucket,
  };
}

/* ---------------- ar_doc (the AR instrument) ---------------- */

/** Shape of an `ar_doc` row (snake_case). `incoterm`/`buyer_ref`/`contract_ref`
 *  are optional soft-refs (NULL until a B2B contract is bound). */
export interface ArDocRow {
  id: number;
  kind: ArDocKind | string;
  doc_number: string;
  status: ArDocStatus | string;
  incoterm: string | null;
  buyer_ref: string | null;
  contract_ref: string | null;
  total_doc: number | string;
  currency: string;
  total_usd: number | string;
  fx_rate_at_issue: number | string;
  issued_at: string;
  created_at: string;
}

/** An AR instrument (proforma / commercial invoice / credit note / DTC receipt).
 *  `status` is a deterministic function of Σ payments — never a manual flip. */
export interface ArDoc {
  id: number;
  kind: ArDocKind | string;
  docNumber: string;
  status: ArDocStatus | string;
  incoterm: string | null;
  buyerRef: string | null;
  contractRef: string | null;
  totalDoc: number;
  currency: string;
  totalUsd: number;
  fxRateAtIssue: number;
  issuedAt: string;
  createdAt: string;
}

/** Pure row → domain mapper for an AR doc (numeric coercion; null soft-refs/
 *  incoterm preserved). */
export function mapArDoc(r: ArDocRow): ArDoc {
  return {
    id: Number(r.id),
    kind: r.kind,
    docNumber: r.doc_number,
    status: r.status,
    incoterm: r.incoterm,
    buyerRef: r.buyer_ref,
    contractRef: r.contract_ref,
    totalDoc: Number(r.total_doc),
    currency: r.currency,
    totalUsd: Number(r.total_usd),
    fxRateAtIssue: Number(r.fx_rate_at_issue),
    issuedAt: r.issued_at,
    createdAt: r.created_at,
  };
}

/* ---------------- ar_doc_line (the line items) ---------------- */

/** Shape of an `ar_doc_line` row (snake_case). `kg`/`green_lot_code` may be NULL
 *  (a non-lot line, e.g. freight). */
export interface ArDocLineRow {
  id: number;
  ar_doc_id: number;
  green_lot_code: string | null;
  description: string;
  kg: number | string | null;
  unit_price_doc: number | string;
  amount_doc: number | string;
  created_at: string;
}

/** One AR doc line — links its amount to a `green_lot_code` provenance trail. */
export interface ArDocLine {
  id: number;
  arDocId: number;
  greenLotCode: string | null;
  description: string;
  kg: number | null;
  unitPriceDoc: number;
  amountDoc: number;
  createdAt: string;
}

/** Pure row → domain mapper for a doc line (numeric coercion; null kg/lot preserved). */
export function mapArDocLine(r: ArDocLineRow): ArDocLine {
  return {
    id: Number(r.id),
    arDocId: Number(r.ar_doc_id),
    greenLotCode: r.green_lot_code,
    description: r.description,
    kg: num(r.kg),
    unitPriceDoc: Number(r.unit_price_doc),
    amountDoc: Number(r.amount_doc),
    createdAt: r.created_at,
  };
}

/* ---------------- ar_payment (append-only inbound cash) ---------------- */

/** Shape of an `ar_payment` row (snake_case). `amount_usd_at_receipt` snapshots
 *  the rate the day the cash landed. */
export interface ArPaymentRow {
  id: number;
  ar_doc_id: number;
  method: PaymentMethod | string;
  amount_doc: number | string;
  currency: string;
  amount_usd_at_receipt: number | string;
  fx_rate_at_receipt: number | string;
  received_at: string;
  created_at: string;
}

/** One inbound cash receipt against an AR doc — the payment timeline. */
export interface ArPayment {
  id: number;
  arDocId: number;
  method: PaymentMethod | string;
  amountDoc: number;
  currency: string;
  amountUsdAtReceipt: number;
  fxRateAtReceipt: number;
  receivedAt: string;
  createdAt: string;
}

/** Pure row → domain mapper for a payment (numeric coercion of doc/usd/rate). */
export function mapArPayment(r: ArPaymentRow): ArPayment {
  return {
    id: Number(r.id),
    arDocId: Number(r.ar_doc_id),
    method: r.method,
    amountDoc: Number(r.amount_doc),
    currency: r.currency,
    amountUsdAtReceipt: Number(r.amount_usd_at_receipt),
    fxRateAtReceipt: Number(r.fx_rate_at_receipt),
    receivedAt: r.received_at,
    createdAt: r.created_at,
  };
}

/* ---------------- fx_gain_loss_entry (realized FX P&L) ---------------- */

/** Shape of an `fx_gain_loss_entry` row (snake_case). The gain traces to two
 *  rates (issue vs receipt) — a CHECK, not an honor system. */
export interface FxGainLossRow {
  id: number;
  ar_doc_id: number;
  amount_doc: number | string;
  fx_rate_at_issue: number | string;
  fx_rate_at_receipt: number | string;
  gain_usd: number | string;
  occurred_at: string;
  created_at: string;
}

/** A realized FX gain/loss line — the distinct P&L line, traceable to two rates. */
export interface FxGainLoss {
  id: number;
  arDocId: number;
  amountDoc: number;
  fxRateAtIssue: number;
  fxRateAtReceipt: number;
  gainUsd: number;
  occurredAt: string;
  createdAt: string;
}

/** Pure row → domain mapper for a realized-FX line (numeric coercion of rates/gain). */
export function mapFxGainLoss(r: FxGainLossRow): FxGainLoss {
  return {
    id: Number(r.id),
    arDocId: Number(r.ar_doc_id),
    amountDoc: Number(r.amount_doc),
    fxRateAtIssue: Number(r.fx_rate_at_issue),
    fxRateAtReceipt: Number(r.fx_rate_at_receipt),
    gainUsd: Number(r.gain_usd),
    occurredAt: r.occurred_at,
    createdAt: r.created_at,
  };
}

/* ---------------- fx_attribution(from, to) (realized FX over a window) ---------------- */

/** Shape of an `fx_attribution(p_from, p_to)` RPC row (snake_case). */
export interface FxAttributionRow {
  period_from: string;
  period_to: string;
  realized_fx_gain_usd: number | string;
  entries: number | string;
}

/** Realized FX P&L over a date window — total gain + the contributing entry count. */
export interface FxAttribution {
  periodFrom: string;
  periodTo: string;
  realizedFxGainUsd: number;
  entries: number;
}

/** Pure row → domain mapper for an attribution window (numeric coercion of gain/count). */
export function mapFxAttribution(r: FxAttributionRow): FxAttribution {
  return {
    periodFrom: r.period_from,
    periodTo: r.period_to,
    realizedFxGainUsd: Number(r.realized_fx_gain_usd),
    entries: Number(r.entries),
  };
}

/* ---------------- getters (request-scoped cache) ---------------- */

/**
 * The canonical FX-rate ledger (`fx_rate`), newest day first — the daily-rate SSOT
 * every non-USD revenue/payment row traces to. Append-only: a correction is a new
 * rate for the same day (the immutability triggers reject edits).
 */
export const getFxRates = cache(async (): Promise<FxRate[]> => {
  const { data, error } = await (await getSupabase())
    .from("fx_rate")
    .select("*")
    .order("as_of_date", { ascending: false });
  if (error) throw new Error(`getFxRates: ${error.message}`);
  return (data as FxRateRow[]).map(mapFxRate);
});

/**
 * The append-only revenue ledger (`revenue_entry`), newest first — the journal
 * source every commerce slice posts through (the revenue-side mirror of
 * `cost_entry`). A reversal is a negative-amount superseding row, never an edit.
 */
export const getRevenueEntries = cache(async (): Promise<RevenueEntry[]> => {
  const { data, error } = await (await getSupabase())
    .from("revenue_entry")
    .select("*")
    .order("occurred_at", { ascending: false });
  if (error) throw new Error(`getRevenueEntries: ${error.message}`);
  return (data as RevenueEntryRow[]).map(mapRevenueEntry);
});

/**
 * The realized per-lot margin board (`v_lot_margin`) — THE number that closes the
 * Phase-1 loop. Ordered by lot. NULL margin ⇒ the lot's COGS isn't booked yet
 * (flagged, never faked).
 */
export const getLotMargin = cache(async (): Promise<LotMargin[]> => {
  const { data, error } = await (await getSupabase())
    .from("v_lot_margin")
    .select("*")
    .order("green_lot_code");
  if (error) throw new Error(`getLotMargin: ${error.message}`);
  return (data as LotMarginRow[]).map(mapLotMargin);
});

/**
 * The AR aging board (`v_ar_aging`) — per doc balance + days outstanding + aging
 * bucket, oldest issue first (the most-overdue surface to the top).
 */
export const getArAging = cache(async (): Promise<ArAging[]> => {
  const { data, error } = await (await getSupabase())
    .from("v_ar_aging")
    .select("*")
    .order("issued_at");
  if (error) throw new Error(`getArAging: ${error.message}`);
  return (data as ArAgingRow[]).map(mapArAging);
});

/**
 * The AR instruments (`ar_doc`), newest issue first — the invoice register.
 */
export const getArDocs = cache(async (): Promise<ArDoc[]> => {
  const { data, error } = await (await getSupabase())
    .from("ar_doc")
    .select("*")
    .order("issued_at", { ascending: false });
  if (error) throw new Error(`getArDocs: ${error.message}`);
  return (data as ArDocRow[]).map(mapArDoc);
});

/**
 * One AR doc by its `doc_number` (`ar_doc` filtered), or `null` when absent
 * (notFound() territory for the `/finance/invoices/[number]` detail page).
 */
export const getArDocByNumber = cache(
  async (docNumber: string): Promise<ArDoc | null> => {
    const { data, error } = await (await getSupabase())
      .from("ar_doc")
      .select("*")
      .eq("doc_number", docNumber);
    if (error) throw new Error(`getArDocByNumber: ${error.message}`);
    const rows = (data as ArDocRow[] | null) ?? [];
    return rows.length > 0 ? mapArDoc(rows[0]) : null;
  },
);

/**
 * The line items for one AR doc (`ar_doc_line` filtered to `ar_doc_id`), in
 * insertion order — each line links to a `green_lot_code` provenance trail.
 */
export const getArDocLines = cache(
  async (arDocId: number): Promise<ArDocLine[]> => {
    const { data, error } = await (await getSupabase())
      .from("ar_doc_line")
      .select("*")
      .eq("ar_doc_id", arDocId)
      .order("id");
    if (error) throw new Error(`getArDocLines: ${error.message}`);
    return (data as ArDocLineRow[]).map(mapArDocLine);
  },
);

/**
 * The cash timeline for one AR doc (`ar_payment` filtered to `ar_doc_id`), newest
 * receipt first — the payment history behind the doc's deterministic status.
 */
export const getArPaymentsForDoc = cache(
  async (arDocId: number): Promise<ArPayment[]> => {
    const { data, error } = await (await getSupabase())
      .from("ar_payment")
      .select("*")
      .eq("ar_doc_id", arDocId)
      .order("received_at", { ascending: false });
    if (error) throw new Error(`getArPaymentsForDoc: ${error.message}`);
    return (data as ArPaymentRow[]).map(mapArPayment);
  },
);

/**
 * The realized FX gain/loss ledger (`fx_gain_loss_entry`), newest first — the
 * distinct P&L line, each row traceable to its issue-vs-receipt rate pair.
 */
export const getFxGainLossEntries = cache(async (): Promise<FxGainLoss[]> => {
  const { data, error } = await (await getSupabase())
    .from("fx_gain_loss_entry")
    .select("*")
    .order("occurred_at", { ascending: false });
  if (error) throw new Error(`getFxGainLossEntries: ${error.message}`);
  return (data as FxGainLossRow[]).map(mapFxGainLoss);
});

/**
 * The realized FX P&L over a `[from, to]` window (`fx_attribution(p_from, p_to)`).
 * The set-returning RPC always yields exactly one window row (`sum`/`count` over the
 * range); a defensive zero-attribution is returned if the result is ever empty.
 */
export const getFxAttribution = cache(
  async (from: string, to: string): Promise<FxAttribution> => {
    const { data, error } = await (await getSupabase()).rpc("fx_attribution", {
      p_from: from,
      p_to: to,
    });
    if (error) throw new Error(`getFxAttribution: ${error.message}`);
    const rows = (data as FxAttributionRow[] | null) ?? [];
    if (rows.length === 0) {
      return { periodFrom: from, periodTo: to, realizedFxGainUsd: 0, entries: 0 };
    }
    return mapFxAttribution(rows[0]);
  },
);
