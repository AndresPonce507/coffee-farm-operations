import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for PUBLISHING a per-lot provenance microsite page (P3-S13 —
 * THE security-critical slice; ADR-002 — all writes flow through a SECURITY DEFINER
 * command RPC). `publish_provenance` UPSERTS the curation record for a SKU, flips its
 * `is_published` gate to true (nothing reaches anon until the owner publishes), and
 * appends a `provenance_published` lot_event on the green lot's hash-chain in the same
 * txn. It is tenant-clamped (a page can never be minted for another tenant's bag) and
 * idempotent on a tenant-qualified key. `provenance_pages` has NO client UPDATE/DELETE
 * grant — this RPC is its only mutation door, exactly like `eudr_declare_plot`.
 *
 * Symmetric twin of the read port: a pure validator (`validatePublishProvenance`, the
 * friendly-error seam) plus a thin command (`publishProvenance`) that calls the single
 * `.rpc()` it needs (the `PublishProvenanceStore` port) so it is testable against a
 * fake store with no database. The idempotency key is REQUIRED — the action/form layer
 * mints a stable token (mirrors recordIceCQuote). A duplicate slug / unknown SKU
 * surfaces as a CLEAN, family-readable sentence, never raw Postgres text.
 */

/** Validated, domain-shaped publish args (camelCase). */
export interface PublishProvenanceInput {
  /** The `product_skus.id` whose bag the page curates (a positive integer). */
  skuId: number;
  /** The GS1 Digital Link path segment — globally unique; a URL slug (no spaces). */
  slug: string;
  /** The GS1 bag identity — optional (the $0 path uses unlicensed identifiers). */
  gtin: string | null;
  /** The owner's curated story; optional. */
  curatedStory: string | null;
  /** Exactly-once anchor — the DB dedupes on a tenant-qualified key. */
  idempotencyKey: string;
}

/**
 * Pure validation of a raw publish request — mirrors the `publish_provenance` /
 * `provenance_pages` preconditions (a real SKU id, a non-empty URL-safe slug) so
 * errors surface before the round-trip. The tenant clamp, the slug uniqueness and
 * the is_published gate are the actual enforcement (the migration's PGlite tests).
 */
export function validatePublishProvenance(
  raw: Record<string, unknown>,
): ValidationResult<PublishProvenanceInput> {
  const errors: Record<string, string> = {};

  const skuId = toNumber(raw.skuId);
  if (skuId === null || !Number.isInteger(skuId) || skuId <= 0) {
    errors.skuId = "Choose a bag (SKU) to publish.";
  }

  const slug = trimmed(raw.slug);
  if (!slug) {
    errors.slug = "A web address (slug) is required.";
  } else if (/\s/.test(slug)) {
    errors.slug = "The slug can't contain spaces — it's a web address.";
  }

  // gtin / curated story are optional — a blank means "not provided" → null.
  const gtin = trimmed(raw.gtin) || null;
  const curatedStory = trimmed(raw.curatedStory) || null;

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: { skuId: skuId as number, slug, gtin, curatedStory, idempotencyKey },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint page id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/**
 * The narrow write port the command depends on — exactly the one `.rpc()` method
 * `publish_provenance` needs. A Supabase client satisfies this structurally; a
 * hand-rolled stub satisfies it in pure-domain tests.
 */
export interface PublishProvenanceStore {
  rpc(
    fn: "publish_provenance",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the curation page's id, or friendly/labelled errors. */
export type PublishProvenanceResult =
  | { ok: true; pageId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `publish_provenance` onto a family-readable sentence
 * — the RPC/constraints are the real guard, but the owner must never see raw PG text.
 * Returns null for anything unrecognised so the caller falls back to a generic message.
 */
export function friendlyPublishProvenanceError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  // A different bag already owns this slug (the global provenance_pages_slug_ux).
  if (
    error.code === "23505" ||
    /duplicate key|provenance_pages_slug_ux|already exists/.test(m)
  ) {
    return "That web address (slug) is already taken by another bag. Choose a different one.";
  }
  // The SKU doesn't belong to this tenant (or doesn't exist).
  if (error.code === "23503" || /unknown sku|foreign key/.test(m)) {
    return "That bag (SKU) couldn't be found. Refresh and try again.";
  }
  // No tenant in session / RLS.
  if (/no tenant in session|insufficient_privilege|permission denied/.test(m)) {
    return "You don't have permission to publish this page. Sign in and try again.";
  }
  return null;
}

/**
 * Validate then publish: calls `publish_provenance` exactly once with the snake_case
 * argument envelope the SECURITY DEFINER RPC expects. Bad input never reaches the RPC
 * (friendly errors); a duplicate slug / unknown SKU surfaces as a CLEAN sentence, any
 * other failure surfaces labelled (raw Postgres text never leaks). Exactly-once on
 * `idempotencyKey` — a replay returns the same page id with no second write.
 */
export async function publishProvenance(
  store: PublishProvenanceStore,
  raw: Record<string, unknown>,
): Promise<PublishProvenanceResult> {
  const parsed = validatePublishProvenance(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("publish_provenance", {
    p_sku_id: parsed.data.skuId,
    p_slug: parsed.data.slug,
    p_gtin: parsed.data.gtin,
    p_curated_story: parsed.data.curatedStory,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyPublishProvenanceError(error) ??
        "This page couldn't be published right now. Please try again.",
    };
  }
  if (data == null) {
    return {
      ok: false,
      message: "This page couldn't be published right now. Please try again.",
    };
  }
  return { ok: true, pageId: Number(data) };
}
