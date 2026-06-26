import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for UNPUBLISHING a per-lot provenance microsite page (P3-S13 —
 * THE security-critical slice; ADR-002 — all writes flow through a SECURITY DEFINER
 * command RPC). `unpublish_provenance` flips a page's `is_published` gate back to
 * false (the bag's public page vanishes from both the curated view and the anon
 * resolver) and appends a `provenance_unpublished` lot_event on the green lot's
 * hash-chain in the same txn. Tenant-clamped + idempotent on a tenant-qualified key;
 * `provenance_pages` has NO client UPDATE/DELETE grant — this RPC is the only door.
 *
 * Symmetric twin of the read port: a pure validator plus a thin command that calls
 * the one `.rpc()` it needs (the `UnpublishProvenanceStore` port), testable with no
 * database. The idempotency key is REQUIRED. A "no page for this bag" failure surfaces
 * as a CLEAN, family-readable sentence, never raw Postgres text.
 */

/** Validated, domain-shaped unpublish args (camelCase). */
export interface UnpublishProvenanceInput {
  /** The `product_skus.id` whose page is taken down (a positive integer). */
  skuId: number;
  /** Exactly-once anchor — the DB dedupes on a tenant-qualified key. */
  idempotencyKey: string;
}

/**
 * Pure validation of a raw unpublish request — mirrors the `unpublish_provenance`
 * preconditions (a real SKU id) so errors surface before the round-trip. The tenant
 * clamp + the "page must exist" guard are the actual enforcement (PGlite tests).
 */
export function validateUnpublishProvenance(
  raw: Record<string, unknown>,
): ValidationResult<UnpublishProvenanceInput> {
  const errors: Record<string, string> = {};

  const skuId = toNumber(raw.skuId);
  if (skuId === null || !Number.isInteger(skuId) || skuId <= 0) {
    errors.skuId = "Choose a bag (SKU) to unpublish.";
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, data: { skuId: skuId as number, idempotencyKey } };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint page id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method `unpublish_provenance` needs. */
export interface UnpublishProvenanceStore {
  rpc(
    fn: "unpublish_provenance",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the curation page's id, or friendly/labelled errors. */
export type UnpublishProvenanceResult =
  | { ok: true; pageId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `unpublish_provenance` onto a family-readable
 * sentence. Returns null for anything unrecognised so the caller falls back to a
 * generic message (raw Postgres text never reaches the owner).
 */
export function friendlyUnpublishProvenanceError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  // There's no curation page for that bag yet (nothing to take down).
  if (error.code === "23503" || /no provenance page|foreign key|unknown sku/.test(m)) {
    return "There's no provenance page for that bag yet. Publish one first.";
  }
  // No tenant in session / RLS.
  if (/no tenant in session|insufficient_privilege|permission denied/.test(m)) {
    return "You don't have permission to update this page. Sign in and try again.";
  }
  return null;
}

/**
 * Validate then unpublish: calls `unpublish_provenance` exactly once with the
 * snake_case argument envelope. Bad input never reaches the RPC (friendly errors);
 * a "no page" failure surfaces as a CLEAN sentence, any other failure surfaces
 * labelled. Exactly-once on `idempotencyKey` — a replay returns the same page id.
 */
export async function unpublishProvenance(
  store: UnpublishProvenanceStore,
  raw: Record<string, unknown>,
): Promise<UnpublishProvenanceResult> {
  const parsed = validateUnpublishProvenance(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("unpublish_provenance", {
    p_sku_id: parsed.data.skuId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyUnpublishProvenanceError(error) ??
        "This page couldn't be unpublished right now. Please try again.",
    };
  }
  if (data == null) {
    return {
      ok: false,
      message: "This page couldn't be unpublished right now. Please try again.",
    };
  }
  return { ok: true, pageId: Number(data) };
}
