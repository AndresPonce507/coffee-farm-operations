"use server";

import { getTranslations } from "next-intl/server";

import { getSupabase } from "@/lib/supabase/server";
import { isBagSize, isFgReason, isPackFormat } from "./constants";

/**
 * /shop WRITE port — the catalog Server Actions (P3-S11).
 *
 * Server Actions are the one driving port (rail §7: only ever invoked by an
 * authenticated human submitting a form; nothing here is driven by untrusted inbound).
 * Each validates the shape the DB CHECKs enforce BEFORE the network hop, then appends
 * through a single SECURITY DEFINER command RPC — the only write door:
 *   • create_product       — mint a roasted-SKU master.
 *   • create_sku           — mint a lot-linked bag; the DB VALIDATES the green lot is
 *     one this tenant actually holds (invariant 5 — a SKU can't claim a lot it isn't
 *     backed by), then materializes the finished_goods row + appends a lot_event.
 *   • record_fg_movement   — append a signed finished-goods movement; the fg_ledger
 *     trigger rolls it into finished_goods and FAILS CLOSED if available would go below
 *     zero (the prevent_oversell pattern reused for retail bags — invariant 2). A
 *     'sale' is the money-shaped path; the client island routes it through an explicit
 *     human confirm, never an untrusted trigger.
 *
 * The lot-backing guard, the oversell guard, and tenancy all live in the database;
 * these actions surface the author-written guard messages verbatim (they are
 * family-readable) and map structural Postgres errors to clean copy — never a raw
 * SQLSTATE leak. The idempotency_key is CLIENT-minted (rail §1) and passed through so
 * an exactly-once retry collapses to the same row.
 *
 * REVALIDATION: there is no `/shop` EventKind in the reactiveRefresh RIPPLE map yet,
 * and src/lib/revalidate.ts is a shared single-author Wiring file (out of this slice's
 * file scope), so these actions intentionally bust nothing here — the client island
 * calls router.refresh() for same-session freshness (the /shop route is force-dynamic,
 * so the refresh re-runs getCatalog). WIRING SEAM: add a "storefront-catalog" EventKind
 * whose RIPPLE includes /shop (and, for a movement, the P3-S12 /orders COGS read), then
 * repoint these calls.
 */

export interface CreateProductInput {
  slug: string;
  name: string;
  variety: string | null;
  process: string | null;
  tastingNotes: string | null;
  idempotencyKey: string;
}

export interface CreateSkuInput {
  productId: number;
  greenLotCode: string;
  roastSkuId: number | null;
  packFormat: string;
  bagSize: string;
  priceUsdCents: number;
  gtin: string | null;
  stripePriceId: string | null;
  isReserveClub: boolean;
  idempotencyKey: string;
}

export interface RecordMovementInput {
  skuId: number;
  /** SIGNED unit delta (negative for a sale/fulfil); the DB CHECK requires it non-zero. */
  qtyUnits: number;
  reason: string;
  idempotencyKey: string;
}

export type ProductResult =
  | { ok: true; productId: number }
  | { ok: false; error: string };

export type SkuResult = { ok: true; skuId: number } | { ok: false; error: string };

export type MovementResult =
  | { ok: true; ledgerId: number }
  | { ok: false; error: string };

interface PgError {
  message: string;
  code?: string;
}

/**
 * Map a Postgres error to family-readable copy. Our SECURITY DEFINER guards raise
 * author-written messages with these SQLSTATEs (lot-backing, finished-goods oversell,
 * unknown product/roast-sku) — all safe and clear, so they pass through verbatim.
 * Structural codes get canned guidance; nothing raw ever leaks.
 */
function friendlyError(
  error: PgError,
  generic: string,
  access: string,
  duplicate: string,
): string {
  switch (error.code) {
    case "23514": // check_violation — oversell + other author-written guards
    case "P0001": // raise_exception
    case "P0002": // no_data_found
    case "23503": // foreign_key_violation — "green lot … does not exist" lot-backing guard
      return error.message;
    case "42501": // insufficient_privilege
      return access;
    case "23505": // unique_violation — idempotent replay collided
      return duplicate;
    default:
      return generic;
  }
}

const nonEmpty = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;
const positiveInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v > 0;

export async function createProductAction(
  input: CreateProductInput,
): Promise<ProductResult> {
  const t = await getTranslations("shop");
  if (!nonEmpty(input.slug)) return { ok: false, error: t("errors.slugRequired") };
  if (!nonEmpty(input.name)) return { ok: false, error: t("errors.nameRequired") };

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("create_product", {
    p_slug: input.slug.trim(),
    p_name: input.name.trim(),
    p_variety: input.variety,
    p_process: input.process,
    p_tasting_notes: input.tastingNotes,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return {
      ok: false,
      error: friendlyError(
        error as PgError,
        t("errors.generic"),
        t("errors.access"),
        t("errors.duplicate"),
      ),
    };
  }
  return { ok: true, productId: Number(data) };
}

export async function createSkuAction(input: CreateSkuInput): Promise<SkuResult> {
  const t = await getTranslations("shop");
  if (!positiveInt(input.productId)) {
    return { ok: false, error: t("errors.productRequired") };
  }
  if (!nonEmpty(input.greenLotCode)) {
    return { ok: false, error: t("errors.lotRequired") };
  }
  if (!isPackFormat(input.packFormat)) {
    return { ok: false, error: t("errors.packInvalid") };
  }
  if (!isBagSize(input.bagSize)) {
    return { ok: false, error: t("errors.bagInvalid") };
  }
  if (
    !Number.isInteger(input.priceUsdCents) ||
    input.priceUsdCents < 0
  ) {
    return { ok: false, error: t("errors.priceInvalid") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("create_sku", {
    p_product_id: input.productId,
    p_green_lot_code: input.greenLotCode.trim(),
    p_roast_sku_id: input.roastSkuId,
    p_pack_format: input.packFormat,
    p_bag_size: input.bagSize,
    p_price_usd_cents: input.priceUsdCents,
    p_gtin: input.gtin,
    p_stripe_price_id: input.stripePriceId,
    p_is_reserve_club: input.isReserveClub,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return {
      ok: false,
      error: friendlyError(
        error as PgError,
        t("errors.generic"),
        t("errors.access"),
        t("errors.duplicate"),
      ),
    };
  }
  return { ok: true, skuId: Number(data) };
}

export async function recordFgMovementAction(
  input: RecordMovementInput,
): Promise<MovementResult> {
  const t = await getTranslations("shop");
  if (!positiveInt(input.skuId)) {
    return { ok: false, error: t("errors.skuRequired") };
  }
  if (!Number.isInteger(input.qtyUnits) || input.qtyUnits === 0) {
    return { ok: false, error: t("errors.qtyInvalid") };
  }
  if (!isFgReason(input.reason)) {
    return { ok: false, error: t("errors.reasonInvalid") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("record_fg_movement", {
    p_sku_id: input.skuId,
    p_qty_units: input.qtyUnits,
    p_reason: input.reason,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return {
      ok: false,
      error: friendlyError(
        error as PgError,
        t("errors.generic"),
        t("errors.access"),
        t("errors.duplicate"),
      ),
    };
  }
  return { ok: true, ledgerId: Number(data) };
}
