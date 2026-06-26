/**
 * /shop shared constants (P3-S11 catalog).
 *
 * The retail SKU dimensions + finished-goods movement reasons, mirrored EXACTLY from
 * the migration's enums + CHECK constraint (20260706090000_storefront_skus.sql):
 *   - pack_format enum  → PACK_FORMATS
 *   - bag_size enum     → BAG_SIZES
 *   - fg_ledger.reason CHECK → FG_REASONS
 *
 * Kept in a plain (non-"use server", non-data-port) module so BOTH the Server Action
 * validator and the client island can import them — a "use server" file may only
 * export async functions, and the read port pulls server-only `getSupabase`, so a
 * shared literal home is the clean seam.
 */

export const PACK_FORMATS = ["whole-bean", "ground"] as const;
export type PackFormat = (typeof PACK_FORMATS)[number];

export const BAG_SIZES = ["250g", "340g", "454g", "1kg", "12oz"] as const;
export type BagSize = (typeof BAG_SIZES)[number];

export const FG_REASONS = [
  "roast-in",
  "sale",
  "subscription-fulfill",
  "adjust",
  "return",
] as const;
export type FgReason = (typeof FG_REASONS)[number];

/**
 * Reason → inventory direction. Inbound reasons add stock, outbound reasons draw it
 * down; `adjust` carries its own human-chosen direction. The client island uses this
 * to sign the (positive) units the owner types, so a "sale" is recorded as a negative
 * fg_ledger delta — the trigger's fail-closed guard then refuses a below-zero result.
 */
export const FG_INBOUND_REASONS: readonly FgReason[] = ["roast-in", "return"];
export const FG_OUTBOUND_REASONS: readonly FgReason[] = ["sale", "subscription-fulfill"];

export function isPackFormat(v: unknown): v is PackFormat {
  return typeof v === "string" && (PACK_FORMATS as readonly string[]).includes(v);
}
export function isBagSize(v: unknown): v is BagSize {
  return typeof v === "string" && (BAG_SIZES as readonly string[]).includes(v);
}
export function isFgReason(v: unknown): v is FgReason {
  return typeof v === "string" && (FG_REASONS as readonly string[]).includes(v);
}
