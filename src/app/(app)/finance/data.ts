import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/**
 * /finance read port (P3-S17 — AR docs + payments + the QBO/Xero/PAC sync seam).
 *
 * Co-located with the route on purpose: it binds DIRECTLY to the authoritative SQL
 * surface the P3-S16/S17 migrations shipped — the `v_ar_aging` / `v_lot_margin` /
 * `v_cash_runway` / `v_preharvest_finance` / `v_sync_health` security_invoker views
 * and the `ar_doc` / `ar_doc_line` / `ar_payment` / `account_map` / `sync_outbox`
 * tables — rather than a sibling `@/lib/db/accounting` port a parallel fan-out builds
 * (importing a not-yet-existent module hard-fails Vite's import-analysis at BOTH test
 * and build time). The Wiring pass can collapse this into `@/lib/db/accounting` once
 * that port lands. The only load-bearing contract here is the frozen view/column names.
 *
 * READ-ONLY. Every write goes through the SECURITY DEFINER command RPCs in
 * `actions.ts` (issue_ar_doc / settle_ar_payment / void_ar_doc / set_account_map).
 * NULL is PRESERVED, never fabricated to 0 — a missing COGS surfaces as "unknown
 * margin", never a faked floor (rail §5).
 */

/** Coerce a PostgREST numeric (which may arrive as a string) to number|null. */
const toNum = (v: number | string | null | undefined): number | null =>
  v == null ? null : Number(v);

/* ───────────────────────────── AR aging board ───────────────────────────── */

export interface AgingRow {
  arDocId: number;
  kind: string;
  docNumber: string;
  status: string;
  totalUsd: number;
  paidUsd: number;
  balanceUsd: number;
  issuedAt: string;
  daysOutstanding: number;
  agingBucket: string;
}

interface AgingViewRow {
  ar_doc_id: number | string;
  kind: string;
  doc_number: string;
  status: string;
  total_usd: number | string | null;
  paid_usd: number | string | null;
  balance_usd: number | string | null;
  issued_at: string;
  days_outstanding: number | string | null;
  aging_bucket: string;
}

function mapAging(r: AgingViewRow): AgingRow {
  return {
    arDocId: Number(r.ar_doc_id),
    kind: r.kind,
    docNumber: r.doc_number,
    status: r.status,
    totalUsd: toNum(r.total_usd) ?? 0,
    paidUsd: toNum(r.paid_usd) ?? 0,
    balanceUsd: toNum(r.balance_usd) ?? 0,
    issuedAt: r.issued_at,
    daysOutstanding: toNum(r.days_outstanding) ?? 0,
    agingBucket: r.aging_bucket,
  };
}

/** Every AR doc with its paid/balance/aging-bucket, newest first. */
export const getAging = cache(async (): Promise<AgingRow[]> => {
  const sb = await getSupabase();
  const { data, error } = await sb
    .from("v_ar_aging")
    .select("*")
    .order("issued_at", { ascending: false });
  if (error) throw new Error(`getAging: ${error.message}`);
  return (data as AgingViewRow[]).map(mapAging);
});

/* ─────────────────────────────── cash runway ─────────────────────────────── */

export interface CashRunway {
  arOutstandingUsd: number;
  committedCostUsd: number;
  netPositionUsd: number;
}

interface CashRunwayRow {
  ar_outstanding_usd: number | string | null;
  committed_cost_usd: number | string | null;
  net_position_usd: number | string | null;
}

/** The single place both ledgers net: AR due − committed cost. Zeros when empty. */
export const getCashRunway = cache(async (): Promise<CashRunway> => {
  const sb = await getSupabase();
  const { data, error } = await sb
    .from("v_cash_runway")
    .select("*")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getCashRunway: ${error.message}`);
  const r = (data as CashRunwayRow | null) ?? null;
  return {
    arOutstandingUsd: toNum(r?.ar_outstanding_usd) ?? 0,
    committedCostUsd: toNum(r?.committed_cost_usd) ?? 0,
    netPositionUsd: toNum(r?.net_position_usd) ?? 0,
  };
});

/* ────────────────────────────── pre-harvest finance ─────────────────────── */

export interface Preharvest {
  presoldKg: number;
  activePorObraContracts: number;
  indicativeLaborRateUsd: number;
}

interface PreharvestRow {
  presold_kg: number | string | null;
  active_por_obra_contracts: number | string | null;
  indicative_labor_rate_usd: number | string | null;
}

/** The financing gap BEFORE the picking crew shows up: pre-sold kg vs labour. */
export const getPreharvest = cache(async (): Promise<Preharvest> => {
  const sb = await getSupabase();
  const { data, error } = await sb
    .from("v_preharvest_finance")
    .select("*")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getPreharvest: ${error.message}`);
  const r = (data as PreharvestRow | null) ?? null;
  return {
    presoldKg: toNum(r?.presold_kg) ?? 0,
    activePorObraContracts: toNum(r?.active_por_obra_contracts) ?? 0,
    indicativeLaborRateUsd: toNum(r?.indicative_labor_rate_usd) ?? 0,
  };
});

/* ─────────────────────────────── sync health ─────────────────────────────── */

export interface SyncHealthRow {
  target: string;
  pending: number;
  inFlight: number;
  failed: number;
  synced: number;
  maxAttemptsFailed: number | null;
  oldestUnsyncedAt: string | null;
}

interface SyncHealthViewRow {
  target: string;
  pending: number | string | null;
  in_flight: number | string | null;
  failed: number | string | null;
  synced: number | string | null;
  max_attempts_failed: number | string | null;
  oldest_unsynced_at: string | null;
}

function mapHealth(r: SyncHealthViewRow): SyncHealthRow {
  return {
    target: r.target,
    pending: toNum(r.pending) ?? 0,
    inFlight: toNum(r.in_flight) ?? 0,
    failed: toNum(r.failed) ?? 0,
    synced: toNum(r.synced) ?? 0,
    maxAttemptsFailed: toNum(r.max_attempts_failed),
    oldestUnsyncedAt: r.oldest_unsynced_at,
  };
}

/** Outbox depth/failures per target — the dead-guard alarm. */
export const getSyncHealth = cache(async (): Promise<SyncHealthRow[]> => {
  const sb = await getSupabase();
  const { data, error } = await sb.from("v_sync_health").select("*").order("target");
  if (error) throw new Error(`getSyncHealth: ${error.message}`);
  return (data as SyncHealthViewRow[]).map(mapHealth);
});

/* ─────────────────────────────── account map ─────────────────────────────── */

export interface AccountMapRow {
  id: number;
  target: string;
  entryKind: string;
  matchKey: string;
  accountCode: string;
  accountName: string | null;
}

interface AccountMapViewRow {
  id: number | string;
  target: string;
  entry_kind: string;
  match_key: string;
  account_code: string;
  account_name: string | null;
}

/** Our-ledger-key → buyer-account-code mappings (why we never rebuild bookkeeping). */
export const getAccountMap = cache(async (): Promise<AccountMapRow[]> => {
  const sb = await getSupabase();
  const { data, error } = await sb
    .from("account_map")
    .select("id, target, entry_kind, match_key, account_code, account_name")
    .order("target")
    .order("match_key");
  if (error) throw new Error(`getAccountMap: ${error.message}`);
  return (data as AccountMapViewRow[]).map((r) => ({
    id: Number(r.id),
    target: r.target,
    entryKind: r.entry_kind,
    matchKey: r.match_key,
    accountCode: r.account_code,
    accountName: r.account_name,
  }));
});

/* ───────────────────────────── failed sync rows ──────────────────────────── */

export interface SyncOutboxRow {
  id: number;
  target: string;
  entityKind: string;
  entityRef: string;
  state: string;
  externalId: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

interface SyncOutboxViewRow {
  id: number | string;
  target: string;
  entity_kind: string;
  entity_ref: string;
  state: string;
  external_id: string | null;
  attempts: number | string | null;
  last_error: string | null;
  created_at: string;
}

function mapOutbox(r: SyncOutboxViewRow): SyncOutboxRow {
  return {
    id: Number(r.id),
    target: r.target,
    entityKind: r.entity_kind,
    entityRef: r.entity_ref,
    state: r.state,
    externalId: r.external_id,
    attempts: toNum(r.attempts) ?? 0,
    lastError: r.last_error,
    createdAt: r.created_at,
  };
}

/** The currently-failed posts (the red rows on the sync console). */
export const getFailedSyncs = cache(async (): Promise<SyncOutboxRow[]> => {
  const sb = await getSupabase();
  const { data, error } = await sb
    .from("sync_outbox")
    .select(
      "id, target, entity_kind, entity_ref, state, external_id, attempts, last_error, created_at",
    )
    .eq("state", "failed")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`getFailedSyncs: ${error.message}`);
  return (data as SyncOutboxViewRow[]).map(mapOutbox);
});

/* ─────────────────────────────── invoice detail ──────────────────────────── */

export interface InvoiceDoc {
  id: number;
  kind: string;
  docNumber: string;
  status: string;
  incoterm: string | null;
  buyerRef: string | null;
  contractRef: string | null;
  totalDoc: number;
  currency: string;
  totalUsd: number;
  fxRateAtIssue: number;
  issuedAt: string;
}

export interface InvoiceLine {
  id: number;
  greenLotCode: string | null;
  description: string;
  kg: number | null;
  unitPriceDoc: number;
  amountDoc: number;
}

export interface InvoicePayment {
  id: number;
  method: string;
  amountDoc: number;
  currency: string;
  amountUsdAtReceipt: number;
  fxRateAtReceipt: number;
  receivedAt: string;
}

export interface LotMargin {
  greenLotCode: string;
  revenueUsd: number | null;
  greenKg: number | null;
  costPerKgGreen: number | null;
  revenuePerKgGreen: number | null;
  marginPerKgGreen: number | null;
  marginUsd: number | null;
}

export interface InvoiceDetail {
  doc: InvoiceDoc;
  lines: InvoiceLine[];
  payments: InvoicePayment[];
  margins: LotMargin[];
  paidUsd: number;
  balanceUsd: number;
}

interface DocRow {
  id: number | string;
  kind: string;
  doc_number: string;
  status: string;
  incoterm: string | null;
  buyer_ref: string | null;
  contract_ref: string | null;
  total_doc: number | string | null;
  currency: string;
  total_usd: number | string | null;
  fx_rate_at_issue: number | string | null;
  issued_at: string;
}

interface LineRow {
  id: number | string;
  green_lot_code: string | null;
  description: string;
  kg: number | string | null;
  unit_price_doc: number | string | null;
  amount_doc: number | string | null;
}

interface PaymentRow {
  id: number | string;
  method: string;
  amount_doc: number | string | null;
  currency: string;
  amount_usd_at_receipt: number | string | null;
  fx_rate_at_receipt: number | string | null;
  received_at: string;
}

interface MarginRow {
  green_lot_code: string;
  revenue_usd: number | string | null;
  green_kg: number | string | null;
  cost_per_kg_green: number | string | null;
  revenue_per_kg_green: number | string | null;
  margin_per_kg_green: number | string | null;
  margin_usd: number | string | null;
}

/**
 * One AR doc's full story: the instrument, its lines (each carrying its
 * green_lot_code provenance), the inbound-cash timeline, and a per-lot realized
 * margin strip (NULL cost ⇒ NULL margin, flagged not faked). Returns null on an
 * unknown doc_number so the route 404s — never a fabricated invoice.
 */
export const getInvoice = cache(
  async (docNumber: string): Promise<InvoiceDetail | null> => {
    const sb = await getSupabase();

    const { data: docData, error: docErr } = await sb
      .from("ar_doc")
      .select(
        "id, kind, doc_number, status, incoterm, buyer_ref, contract_ref, total_doc, currency, total_usd, fx_rate_at_issue, issued_at",
      )
      .eq("doc_number", docNumber)
      .maybeSingle();
    if (docErr) throw new Error(`getInvoice: ${docErr.message}`);
    if (!docData) return null;

    const dr = docData as DocRow;
    const docId = Number(dr.id);

    const [linesRes, paymentsRes] = await Promise.all([
      sb
        .from("ar_doc_line")
        .select("id, green_lot_code, description, kg, unit_price_doc, amount_doc")
        .eq("ar_doc_id", docId)
        .order("id"),
      sb
        .from("ar_payment")
        .select(
          "id, method, amount_doc, currency, amount_usd_at_receipt, fx_rate_at_receipt, received_at",
        )
        .eq("ar_doc_id", docId)
        .order("received_at", { ascending: true }),
    ]);
    if (linesRes.error) throw new Error(`getInvoice(lines): ${linesRes.error.message}`);
    if (paymentsRes.error)
      throw new Error(`getInvoice(payments): ${paymentsRes.error.message}`);

    const lines: InvoiceLine[] = (linesRes.data as LineRow[]).map((l) => ({
      id: Number(l.id),
      greenLotCode: l.green_lot_code,
      description: l.description,
      kg: toNum(l.kg),
      unitPriceDoc: toNum(l.unit_price_doc) ?? 0,
      amountDoc: toNum(l.amount_doc) ?? 0,
    }));

    const payments: InvoicePayment[] = (paymentsRes.data as PaymentRow[]).map((p) => ({
      id: Number(p.id),
      method: p.method,
      amountDoc: toNum(p.amount_doc) ?? 0,
      currency: p.currency,
      amountUsdAtReceipt: toNum(p.amount_usd_at_receipt) ?? 0,
      fxRateAtReceipt: toNum(p.fx_rate_at_receipt) ?? 1,
      receivedAt: p.received_at,
    }));

    // Per-lot realized margin for the distinct green lots on this doc.
    const lotCodes = Array.from(
      new Set(lines.map((l) => l.greenLotCode).filter((c): c is string => !!c)),
    );
    let margins: LotMargin[] = [];
    if (lotCodes.length > 0) {
      const { data: marginData, error: marginErr } = await sb
        .from("v_lot_margin")
        .select(
          "green_lot_code, revenue_usd, green_kg, cost_per_kg_green, revenue_per_kg_green, margin_per_kg_green, margin_usd",
        )
        .in("green_lot_code", lotCodes);
      if (marginErr) throw new Error(`getInvoice(margin): ${marginErr.message}`);
      margins = (marginData as MarginRow[]).map((m) => ({
        greenLotCode: m.green_lot_code,
        revenueUsd: toNum(m.revenue_usd),
        greenKg: toNum(m.green_kg),
        costPerKgGreen: toNum(m.cost_per_kg_green),
        revenuePerKgGreen: toNum(m.revenue_per_kg_green),
        marginPerKgGreen: toNum(m.margin_per_kg_green),
        marginUsd: toNum(m.margin_usd),
      }));
    }

    const totalUsd = toNum(dr.total_usd) ?? 0;
    const paidUsd = payments.reduce((acc, p) => acc + p.amountUsdAtReceipt, 0);

    return {
      doc: {
        id: docId,
        kind: dr.kind,
        docNumber: dr.doc_number,
        status: dr.status,
        incoterm: dr.incoterm,
        buyerRef: dr.buyer_ref,
        contractRef: dr.contract_ref,
        totalDoc: toNum(dr.total_doc) ?? 0,
        currency: dr.currency,
        totalUsd,
        fxRateAtIssue: toNum(dr.fx_rate_at_issue) ?? 1,
        issuedAt: dr.issued_at,
      },
      lines,
      payments,
      margins,
      paidUsd,
      balanceUsd: totalUsd - paidUsd,
    };
  },
);
