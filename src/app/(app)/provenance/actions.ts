"use server";

import { getTranslations } from "next-intl/server";

import { getSupabase } from "@/lib/supabase/server";

/**
 * /(app)/provenance WRITE port — the owner curation Server Actions (P3-S13).
 *
 * The ONE write door for the public microsite: publish/unpublish flow through the
 * SECURITY DEFINER, tenant-clamped, idempotent RPCs (`publish_provenance` /
 * `unpublish_provenance`). They append a `provenance_published` / `_unpublished`
 * lot_event on the green lot's chain in the same txn, so `verify_chain` covers the
 * bag's public life too. There is NO client UPDATE/DELETE grant on `provenance_pages`
 * — these actions, invoked only by an authenticated owner submitting a form, are the
 * sole mutation path (ADR-002 / rail §7: untrusted inbound never drives this write).
 *
 * Validation mirrors the DB shape BEFORE the network hop; the DB guards are the real
 * wall. `friendlyError` maps known Postgres codes to family-readable copy — a raw
 * SQLSTATE or constraint string never surfaces. The idempotency_key is CLIENT-minted
 * and forwarded as-is so an exactly-once retry collapses to the same page row.
 *
 * REVALIDATION SEAM (out of this slice's file scope — `src/lib/revalidate.ts` is a
 * shared, single-author Wiring contract, and the ripple-actions-wired guard owns the
 * KIND_TO_ACTION_FILES map): a publish/unpublish moves the OWNER board (re-read on
 * navigation under the `(app)` `force-dynamic`) and the PUBLIC `/p/[slug]` page.
 * Wiring should add a dedicated `"provenance-published"` EventKind whose RIPPLE route
 * set covers `/provenance` and the public `/p/[slug]` segment, register this file in
 * the guard map, and call `reactiveRefresh` here. Until then the client island
 * reflects the new state optimistically, so the owner flow is correct — and this file
 * deliberately routes NO cache-busting of its own (the guard bans a hand-rolled call).
 */

export interface PublishInput {
  skuId: number;
  slug: string;
  /** Optional GS1 bag identity; "" / missing ⇒ null. */
  gtin: string;
  curatedStory: string;
  idempotencyKey: string;
}

export interface UnpublishInput {
  skuId: number;
  idempotencyKey: string;
}

export type CurationResult =
  | { ok: true; pageId: number }
  | { ok: false; error: string };

interface PgError {
  message: string;
  code?: string;
}

/**
 * Map a Postgres error to family-readable copy. The provenance writers raise a
 * unique-violation when a slug is already taken and a foreign-key-violation for an
 * unknown SKU; structural codes get canned guidance. Nothing raw ever leaks.
 */
async function friendlyError(error: PgError): Promise<string> {
  const t = await getTranslations("provenance");
  switch (error.code) {
    case "23505": // unique_violation — the slug (globally unique) is taken
      return t("admin.errors.exists");
    case "23503": // foreign_key_violation — unknown SKU for this tenant
      return t("admin.errors.unknownSku");
    default:
      return t("admin.errors.generic");
  }
}

const isPositiveInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v > 0;

export async function publishProvenanceAction(
  input: PublishInput,
): Promise<CurationResult> {
  const t = await getTranslations("provenance");
  if (!isPositiveInt(input.skuId)) {
    return { ok: false, error: t("admin.errors.skuRequired") };
  }
  if (!input.slug?.trim()) {
    return { ok: false, error: t("admin.errors.slugRequired") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("publish_provenance", {
    p_sku_id: input.skuId,
    p_slug: input.slug.trim(),
    p_gtin: input.gtin?.trim() ? input.gtin.trim() : null,
    p_curated_story: input.curatedStory?.trim() ? input.curatedStory.trim() : null,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return { ok: false, error: await friendlyError(error as PgError) };
  }
  return { ok: true, pageId: Number(data) };
}

export async function unpublishProvenanceAction(
  input: UnpublishInput,
): Promise<CurationResult> {
  const t = await getTranslations("provenance");
  if (!isPositiveInt(input.skuId)) {
    return { ok: false, error: t("admin.errors.skuRequired") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("unpublish_provenance", {
    p_sku_id: input.skuId,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return { ok: false, error: await friendlyError(error as PgError) };
  }
  return { ok: true, pageId: Number(data) };
}
