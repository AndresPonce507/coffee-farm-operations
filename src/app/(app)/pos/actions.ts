"use server";

import { getTranslations } from "next-intl/server";

import { reactiveRefresh } from "@/lib/revalidate";
import { getSupabase } from "@/lib/supabase/server";

/**
 * /pos WRITE port — the record-sale Server Action (P3-S14).
 *
 * The ONE driving port for ringing up a sale (ADR-002 + rail §7: only ever invoked by
 * an authenticated human — a barista — tapping "Charge"; no untrusted inbound fires it).
 * It validates the shape the DB enforces BEFORE the network hop, then appends through a
 * single SECURITY DEFINER command RPC, `record_pos_sale`, which:
 *   • DELEGATES to the shipped `create_order` (channel='pos') for the server-computed
 *     subtotal / ITBMS 7% / total AND the S11 fail-closed finished_goods decrement — the
 *     money guarantee is REUSED, never rebuilt here (no parallel counter, no client total);
 *   • mints the human POS-NNNN folio and writes the `pos_sales` row carrying the offline
 *     (device_id, device_seq) exactly-once coordinate;
 *   • is idempotent on the client-minted `idempotency_key` (a replay — a queued
 *     re-sync or a double-tap — returns the SAME folio, never a second charge).
 *
 * The client supplies NO total: the till computes it. The DB guard messages (oversell,
 * unknown SKU, inactive terminal) are author-written + family-readable, so they surface
 * verbatim; structural Postgres codes get canned copy — a raw SQLSTATE never leaks.
 *
 * REVALIDATION: a sale decrements `finished_goods` (green→bag inventory moved), so it
 * fans out through reactiveRefresh, the RIPPLE SSOT (never a hand-rolled revalidatePath).
 * It currently rides the existing "inventory-update" kind; the Wiring pass can add a
 * dedicated "pos-sale" EventKind whose ripple also lights /pos.
 *
 * OFFLINE (rail §9): the client island queues a sale locally when offline and replays it
 * through THIS action on reconnect; exactly-once is guaranteed by the `idempotency_key`
 * the DB dedupes on, so a queued replay collapses to the one folio.
 */

export interface PosSaleLine {
  skuId: number;
  qtyUnits: number;
}

export interface RecordPosSaleInput {
  terminalCode: string;
  customerName: string | null;
  customerEmail: string | null;
  deviceId: string;
  deviceSeq: number;
  lines: PosSaleLine[];
  currency: string;
  idempotencyKey: string;
}

export type RecordPosSaleResult =
  | { ok: true; saleNo: string }
  | { ok: false; error: string };

interface PgError {
  message: string;
  code?: string;
}

/**
 * Map a Postgres error to family-readable copy. The record_pos_sale stack raises
 * author-written messages with these SQLSTATEs (the finished-goods oversell guard, an
 * unknown SKU, an inactive terminal, the no-tenant clamp) — all safe + clear, so they
 * pass through verbatim. Structural codes get canned guidance; nothing raw ever leaks.
 */
function friendlyError(error: PgError, generic: string): string {
  switch (error.code) {
    case "23514": // check_violation — the oversell / qty guard messages
    case "P0001": // raise_exception
    case "23503": // foreign_key_violation — unknown sku / inactive terminal
      return error.message;
    case "42501": // insufficient_privilege — no tenant in session
      return "You don't have access to this register.";
    case "23505": // unique_violation — a device-coordinate replay collided (fail-closed)
      return "That sale was already recorded.";
    default:
      return generic;
  }
}

export async function recordPosSaleAction(
  input: RecordPosSaleInput,
): Promise<RecordPosSaleResult> {
  const t = await getTranslations("pos");

  if (!input.terminalCode?.trim()) {
    return { ok: false, error: t("register.errors.noTerminal") };
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    return { ok: false, error: t("register.errors.emptyCart") };
  }
  for (const line of input.lines) {
    if (
      !Number.isInteger(line.skuId) ||
      line.skuId <= 0 ||
      !Number.isInteger(line.qtyUnits) ||
      line.qtyUnits <= 0
    ) {
      return { ok: false, error: t("register.errors.emptyCart") };
    }
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("record_pos_sale", {
    p_terminal_code: input.terminalCode.trim(),
    p_customer_email: input.customerEmail?.trim() || null,
    p_customer_name: input.customerName?.trim() || null,
    p_device_id: input.deviceId,
    p_device_seq: input.deviceSeq,
    p_lines: input.lines.map((l) => ({ sku_id: l.skuId, qty_units: l.qtyUnits })),
    p_currency: input.currency?.trim() || "USD",
    p_idempotency_key: input.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      error: friendlyError(error as PgError, t("register.errors.generic")),
    };
  }

  // The delegate decremented finished_goods (green→bag inventory moved); ripple it.
  reactiveRefresh("inventory-update");
  return { ok: true, saleNo: String(data) };
}
