"use server";

import { getTranslations } from "next-intl/server";

import { reactiveRefresh } from "@/lib/revalidate";
import { getSupabase } from "@/lib/supabase/server";

/**
 * /finance WRITE port — the AR mint/settle/void + sync-seam Server Actions (P3-S17).
 *
 * Server Actions are the one driving port (ADR-002: only ever invoked by an
 * authenticated human submitting a form — the injection invariant, rail §7). Each
 * validates the shape the DB enforces BEFORE the network hop, then appends through a
 * single SECURITY DEFINER command RPC:
 *   • issue_ar_doc      — mints the gap-free doc_number AND commits each line's kg by
 *     writing a lot_shipments row, so the EXISTING prevent_oversell rejects an invoice
 *     that would double-sell a scarce $30k/kg Geisha (the invoice + the inventory
 *     commitment are ONE atomic act — the money guarantee reused, never a counter).
 *   • settle_ar_payment — the MONEY-SHAPED, human-confirmed inbound-cash write; the S16
 *     cap + recompute triggers derive status, on 'paid' the two-rate FX is booked.
 *   • void_ar_doc       — reverses the revenue (negative rows, never a delete).
 *   • set_account_map   — maps our coffee-native ledger keys onto the buyer's chart of
 *     accounts (why we never rebuild bookkeeping).
 *   • the sync worker drain (claim_sync_batch → mark_sync_result) — the $0 MOCK Edge
 *     Function: it stamps a fake external id / CUFE in dev, which flips a dgi_pac doc
 *     to 'issued' (the fiscal gate). No real PAC bill until Janson transacts domestically.
 *
 * What is DELIBERATELY NOT a UI action: apply_sync_inbound. An external payment/void
 * pulled FROM QBO is applied server-side (the webhook/worker), never by a human click
 * in this surface — no untrusted inbound drives a write from the UI (rail §7).
 *
 * REVALIDATION: issue_ar_doc commits a lot_shipments row (green inventory / ATP moves),
 * so it fans out through reactiveRefresh, the RIPPLE SSOT. settle/void/sync move no
 * ATP, so they bust nothing (matching the pricing slice's discipline).
 */

interface PgError {
  message: string;
  code?: string;
}

/**
 * Map a Postgres error to family-readable copy. Our SECURITY DEFINER guards raise
 * author-written messages with these SQLSTATEs (export gate, oversell, off-book FX,
 * overpayment, void-with-payments) — all safe and clear, so they pass through
 * verbatim. Structural codes get canned guidance; nothing raw ever leaks.
 */
function friendlyError(error: PgError, generic: string): string {
  switch (error.code) {
    case "23514": // check_violation — author-written guard messages (export gate, overpayment)
    case "P0001": // raise_exception
    case "P0002": // no_data_found
    case "23503": // foreign_key_violation ("unknown ar_doc", "off-book FX")
      return error.message;
    case "42501": // insufficient_privilege
      return "You don't have access to that.";
    case "23505": // unique_violation — idempotent replay collided
      return "That was already recorded.";
    default:
      return generic;
  }
}

const isPositive = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;

/* ─────────────────────────────── issue_ar_doc ─────────────────────────────── */

export interface IssueLineInput {
  greenLotCode: string | null;
  description: string;
  kg: number | null;
  unitPriceDoc: number;
  amountDoc: number;
  sourceKind: string;
}

export interface IssueInvoiceInput {
  kind: string;
  currency: string;
  lines: IssueLineInput[];
  buyerRef: string;
  contractRef: string | null;
  incoterm: string | null;
  targets: string[];
  idempotencyKey: string;
}

export type IssueResult =
  | { ok: true; docId: number }
  | { ok: false; error: string };

export async function issueArDocAction(
  input: IssueInvoiceInput,
): Promise<IssueResult> {
  const t = await getTranslations("finance");

  if (!input.kind?.trim()) {
    return { ok: false, error: t("errors.kindRequired") };
  }
  if (!input.currency?.trim()) {
    return { ok: false, error: t("errors.currencyRequired") };
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    return { ok: false, error: t("errors.linesRequired") };
  }
  for (const line of input.lines) {
    if (!isPositive(line.amountDoc)) {
      return { ok: false, error: t("errors.amountPositive") };
    }
    if (line.kg != null && !(Number.isFinite(line.kg) && line.kg > 0)) {
      return { ok: false, error: t("errors.kgPositive") };
    }
  }
  // The export gate the DB also enforces — flag it early so the human fixes it here.
  if (
    input.kind === "commercial_invoice" &&
    (!input.contractRef?.trim() || !input.incoterm?.trim())
  ) {
    return { ok: false, error: t("errors.exportGate") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("issue_ar_doc", {
    p_kind: input.kind,
    p_currency: input.currency.trim(),
    p_lines: input.lines.map((l) => ({
      green_lot_code: l.greenLotCode,
      description: l.description,
      kg: l.kg,
      unit_price_doc: l.unitPriceDoc,
      amount_doc: l.amountDoc,
      source_kind: l.sourceKind,
    })),
    p_buyer_ref: input.buyerRef?.trim() || null,
    p_contract_ref: input.contractRef?.trim() || null,
    p_incoterm: input.incoterm?.trim() || null,
    p_targets: input.targets,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return { ok: false, error: friendlyError(error as PgError, t("errors.generic")) };
  }

  // The doc committed a lot_shipments row: green inventory / ATP moved.
  reactiveRefresh("inventory-update");
  return { ok: true, docId: Number(data) };
}

/* ──────────────────────────── settle_ar_payment ───────────────────────────── */

export interface SettlePaymentInput {
  arDocId: number;
  method: string;
  amountDoc: number;
  currency: string;
  idempotencyKey: string;
}

export type SettleResult =
  | { ok: true; paymentId: number }
  | { ok: false; error: string };

/** The money-shaped, human-confirmed inbound-cash write (rail §7). */
export async function settleArPaymentAction(
  input: SettlePaymentInput,
): Promise<SettleResult> {
  const t = await getTranslations("finance");

  if (!Number.isInteger(input.arDocId) || input.arDocId <= 0) {
    return { ok: false, error: t("errors.docRequired") };
  }
  if (!input.method?.trim()) {
    return { ok: false, error: t("errors.methodRequired") };
  }
  if (!isPositive(input.amountDoc)) {
    return { ok: false, error: t("errors.amountPositive") };
  }
  if (!input.currency?.trim()) {
    return { ok: false, error: t("errors.currencyRequired") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("settle_ar_payment", {
    p_ar_doc_id: input.arDocId,
    p_method: input.method.trim(),
    p_amount_doc: input.amountDoc,
    p_currency: input.currency.trim(),
    p_idempotency_key: input.idempotencyKey,
    p_enqueue_sync: true,
  });
  if (error) {
    return { ok: false, error: friendlyError(error as PgError, t("errors.generic")) };
  }
  return { ok: true, paymentId: Number(data) };
}

/* ─────────────────────────────── void_ar_doc ──────────────────────────────── */

export interface VoidInvoiceInput {
  arDocId: number;
  reason: string;
  idempotencyKey: string;
}

export type VoidResult =
  | { ok: true; docId: number }
  | { ok: false; error: string };

export async function voidArDocAction(
  input: VoidInvoiceInput,
): Promise<VoidResult> {
  const t = await getTranslations("finance");

  if (!Number.isInteger(input.arDocId) || input.arDocId <= 0) {
    return { ok: false, error: t("errors.docRequired") };
  }
  if (!input.reason?.trim()) {
    return { ok: false, error: t("errors.reasonRequired") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("void_ar_doc", {
    p_ar_doc_id: input.arDocId,
    p_reason: input.reason.trim(),
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return { ok: false, error: friendlyError(error as PgError, t("errors.generic")) };
  }
  return { ok: true, docId: Number(data) };
}

/* ────────────────────────────── set_account_map ───────────────────────────── */

export interface AccountMapInput {
  target: string;
  entryKind: string;
  matchKey: string;
  accountCode: string;
  accountName: string | null;
}

export type AccountMapResult =
  | { ok: true; id: number }
  | { ok: false; error: string };

export async function setAccountMapAction(
  input: AccountMapInput,
): Promise<AccountMapResult> {
  const t = await getTranslations("finance");

  if (!input.target?.trim()) {
    return { ok: false, error: t("errors.targetRequired") };
  }
  if (!input.entryKind?.trim()) {
    return { ok: false, error: t("errors.entryKindRequired") };
  }
  if (!input.matchKey?.trim()) {
    return { ok: false, error: t("errors.matchKeyRequired") };
  }
  if (!input.accountCode?.trim()) {
    return { ok: false, error: t("errors.accountCodeRequired") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("set_account_map", {
    p_target: input.target.trim(),
    p_entry_kind: input.entryKind.trim(),
    p_match_key: input.matchKey.trim(),
    p_account_code: input.accountCode.trim(),
    p_account_name: input.accountName?.trim() || null,
  });
  if (error) {
    return { ok: false, error: friendlyError(error as PgError, t("errors.generic")) };
  }
  return { ok: true, id: Number(data) };
}

/* ─────────────────── the $0 mock sync worker (drain to sandbox) ─────────────── */

interface ClaimedOutboxRow {
  id: number | string;
  target: string;
  entity_kind: string;
  entity_ref: string;
}

export interface RetrySyncInput {
  target: string;
  limit?: number;
}

export type RetrySyncResult =
  | { ok: true; processed: number }
  | { ok: false; error: string };

/**
 * The $0 mock worker drain: claim pending+failed posts for a target (FOR UPDATE SKIP
 * LOCKED in the DB), then stamp each with a fake external id / CUFE — exactly the
 * stubbed Edge Function the spec keeps in dev until a real PAC contract is justified.
 * Stamping a dgi_pac post flips its doc to 'issued' (the fiscal gate fires server-side).
 */
export async function retrySyncAction(
  input: RetrySyncInput,
): Promise<RetrySyncResult> {
  const t = await getTranslations("finance");
  if (!input.target?.trim()) {
    return { ok: false, error: t("errors.targetRequired") };
  }

  const sb = await getSupabase();
  const limit = Number.isInteger(input.limit) && input.limit! > 0 ? input.limit! : 25;

  const { data: claimed, error: claimErr } = await sb.rpc("claim_sync_batch", {
    p_target: input.target.trim(),
    p_limit: limit,
  });
  if (claimErr) {
    return { ok: false, error: friendlyError(claimErr as PgError, t("errors.generic")) };
  }

  const rows = (claimed as ClaimedOutboxRow[] | null) ?? [];
  let processed = 0;
  for (const row of rows) {
    // The mock external id: a CUFE-shaped stamp for dgi_pac, a doc id otherwise.
    const externalId =
      row.target === "dgi_pac"
        ? `CUFE-MOCK-${row.id}`
        : `${row.target.toUpperCase()}-${row.entity_ref}-${row.id}`;
    const { error: markErr } = await sb.rpc("mark_sync_result", {
      p_outbox_id: Number(row.id),
      p_success: true,
      p_external_id: externalId,
      p_error: null,
    });
    if (markErr) {
      return { ok: false, error: friendlyError(markErr as PgError, t("errors.generic")) };
    }
    processed += 1;
  }

  // A stamped dgi_pac post can flip a draft doc to 'issued' — bust the invoice reads.
  if (processed > 0) reactiveRefresh("inventory-update");
  return { ok: true, processed };
}
