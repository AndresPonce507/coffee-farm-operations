"use server";

import { getTranslations } from "next-intl/server";

import { reactiveRefresh } from "@/lib/revalidate";
import { getSupabase } from "@/lib/supabase/server";

/**
 * /roast WRITE port — the roasting Server Actions (P3-S10).
 *
 * Six driving ports, every one invoked only by an authenticated human at the roast
 * console (rail §7 — no untrusted inbound ever fires these). Each validates the shape
 * the DB enforces BEFORE the network hop, then appends through a single SECURITY
 * DEFINER command RPC. The idempotency key is CLIENT-minted (rail §1) so an
 * exactly-once retry collapses to the same row.
 *
 *   • create_roast_profile — authors a DRAFT golden-curve profile (a re-author of the
 *     same name mints the NEXT version in the DB; versioning, never mutation). Moves no
 *     green inventory.
 *   • lock_roast_profile  — flips a draft → golden (approved), one-way. Status-only.
 *   • open_roast_batch    — THE golden gate. The DB RAISES unless the profile is golden;
 *     it also inserts a lot_shipments row so the prevent_oversell trigger is the hard
 *     wall on the green draw (rail: reuse the money guarantee, never a parallel counter).
 *     A successful open MOVES green ATP → ripples "inventory-update".
 *   • import_roast_alog   — records an Artisan .alog capture as evidence. Moves nothing.
 *   • finalize_roast_batch — mints the roasted lot, routes the conserved roast edge, and
 *     posts the roast cost to COGS. Moves mass + cost → ripples "inventory-update".
 *   • link_roast_sku      — links a bag SKU; USD dollars are converted to integer cents
 *     at the boundary (money is integer cents in the DB; a null price stays null).
 *
 * Author-written guard messages (with clean SQLSTATEs) surface verbatim; structural
 * Postgres codes get canned guidance, never a raw SQLSTATE leak.
 */

interface PgError {
  message: string;
  code?: string;
}

/**
 * Map a Postgres error to family-readable copy. The SECURITY DEFINER guards raise
 * author-written messages with these SQLSTATEs (the golden gate is a check_violation;
 * the oversell wall a check_violation too) — all safe and clear, so they pass through
 * verbatim. Structural codes get canned guidance.
 */
function friendlyError(error: PgError, generic: string): string {
  switch (error.code) {
    case "23514": // check_violation — golden gate / oversell wall (author message)
    case "P0001": // raise_exception
    case "P0002": // no_data_found
    case "23001": // restrict_violation — append-only immutability
    case "23503": // foreign_key_violation — unknown lot / profile / roaster
      return error.message;
    default:
      return generic;
  }
}

/* ───────────────────────────── create profile ───────────────────────────── */

export interface CreateRoastProfileInput {
  name: string;
  variety: string | null;
  roastLevel: string;
  chargeTempC: number;
  dropTempC: number;
  totalTimeS: number;
  dtrPct: number | null;
  idempotencyKey: string;
}

export type CreateRoastProfileResult =
  | { ok: true; profileId: number }
  | { ok: false; error: string };

export async function createRoastProfileAction(
  input: CreateRoastProfileInput,
): Promise<CreateRoastProfileResult> {
  const t = await getTranslations("roast");
  if (!input.name?.trim()) {
    return { ok: false, error: t("errors.nameRequired") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("create_roast_profile", {
    p_name: input.name.trim(),
    p_variety: input.variety,
    p_roast_level: input.roastLevel,
    p_target_charge_temp_c: input.chargeTempC,
    p_target_drop_temp_c: input.dropTempC,
    p_target_total_time_s: input.totalTimeS,
    p_target_dtr_pct: input.dtrPct,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return { ok: false, error: friendlyError(error as PgError, t("errors.generic")) };
  }
  // Authoring a draft moves NO green inventory — nothing ripples.
  return { ok: true, profileId: Number(data) };
}

/* ───────────────────────────── lock golden ───────────────────────────── */

export interface LockRoastProfileInput {
  profileId: number;
  idempotencyKey: string;
}

export type LockRoastProfileResult =
  | { ok: true; status: string }
  | { ok: false; error: string };

export async function lockRoastProfileAction(
  input: LockRoastProfileInput,
): Promise<LockRoastProfileResult> {
  const sb = await getSupabase();
  const { data, error } = await sb.rpc("lock_roast_profile", {
    p_profile_id: input.profileId,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    const t = await getTranslations("roast");
    return { ok: false, error: friendlyError(error as PgError, t("errors.generic")) };
  }
  // Locking is status-only — no inventory moves, so nothing ripples.
  return { ok: true, status: String(data) };
}

/* ───────────────────────────── open batch ───────────────────────────── */

export interface OpenRoastBatchInput {
  greenLotCode: string;
  profileId: number;
  roasterId: number;
  greenInKg: number;
  idempotencyKey: string;
}

export type OpenRoastBatchResult =
  | { ok: true; batchId: number }
  | { ok: false; error: string };

export async function openRoastBatchAction(
  input: OpenRoastBatchInput,
): Promise<OpenRoastBatchResult> {
  const sb = await getSupabase();
  const { data, error } = await sb.rpc("open_roast_batch", {
    p_green_lot_code: input.greenLotCode,
    p_profile_id: input.profileId,
    p_roaster_id: input.roasterId,
    p_green_in_kg: input.greenInKg,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    const t = await getTranslations("roast");
    return { ok: false, error: friendlyError(error as PgError, t("errors.generic")) };
  }
  // A green draw moved ATP (a lot_shipments claim) — ripple inventory.
  reactiveRefresh("inventory-update");
  return { ok: true, batchId: Number(data) };
}

/* ───────────────────────────── import .alog ───────────────────────────── */

export interface ImportRoastAlogInput {
  batchId: number;
  sourceFilename: string | null;
  payload: unknown;
  idempotencyKey: string;
}

export type ImportRoastAlogResult =
  | { ok: true; importId: number }
  | { ok: false; error: string };

export async function importRoastAlogAction(
  input: ImportRoastAlogInput,
): Promise<ImportRoastAlogResult> {
  const sb = await getSupabase();
  const { data, error } = await sb.rpc("import_roast_alog", {
    p_batch_id: input.batchId,
    p_source_filename: input.sourceFilename,
    p_alog_payload: input.payload,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    const t = await getTranslations("roast");
    return { ok: false, error: friendlyError(error as PgError, t("errors.generic")) };
  }
  // Recording capture evidence moves no inventory — nothing ripples.
  return { ok: true, importId: Number(data) };
}

/* ───────────────────────────── finalize batch ───────────────────────────── */

export interface FinalizeRoastBatchInput {
  batchId: number;
  roastedKgOut: number;
  roastCostUsd: number;
  location: string | null;
  idempotencyKey: string;
}

export type FinalizeRoastBatchResult =
  | { ok: true; roastedLotCode: string }
  | { ok: false; error: string };

export async function finalizeRoastBatchAction(
  input: FinalizeRoastBatchInput,
): Promise<FinalizeRoastBatchResult> {
  const sb = await getSupabase();
  const { data, error } = await sb.rpc("finalize_roast_batch", {
    p_batch_id: input.batchId,
    p_roasted_kg_out: input.roastedKgOut,
    p_roast_cost_usd: input.roastCostUsd,
    p_location: input.location,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    const t = await getTranslations("roast");
    return { ok: false, error: friendlyError(error as PgError, t("errors.generic")) };
  }
  // Finalize moved mass (roasted edge) + cost (COGS post) — ripple inventory.
  reactiveRefresh("inventory-update");
  return { ok: true, roastedLotCode: String(data) };
}

/* ───────────────────────────── link SKU ───────────────────────────── */

export interface LinkRoastSkuInput {
  batchId: number;
  skuCode: string;
  bagSizeG: number;
  /** Price per bag in USD dollars; null ⇒ no price (stays null, never 0 cents). */
  priceUsd: number | null;
  gtin: string | null;
  idempotencyKey: string;
}

export type LinkRoastSkuResult =
  | { ok: true; skuId: number }
  | { ok: false; error: string };

export async function linkRoastSkuAction(
  input: LinkRoastSkuInput,
): Promise<LinkRoastSkuResult> {
  // Money is integer cents in the DB — convert at the boundary; null price stays null.
  const priceCents =
    input.priceUsd == null ? null : Math.round(input.priceUsd * 100);

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("link_roast_sku", {
    p_batch_id: input.batchId,
    p_sku_code: input.skuCode,
    p_bag_size_g: input.bagSizeG,
    p_price_usd_cents: priceCents,
    p_gtin: input.gtin,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    const t = await getTranslations("roast");
    return { ok: false, error: friendlyError(error as PgError, t("errors.generic")) };
  }
  return { ok: true, skuId: Number(data) };
}
