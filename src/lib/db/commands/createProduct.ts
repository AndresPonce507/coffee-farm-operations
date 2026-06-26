import { trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for minting a roasted-SKU master (P3-S11 — catalog + lot-linked
 * SKUs; ADR-002 — all writes flow through a SECURITY DEFINER command RPC). The single
 * write door is `create_product` — tenant-clamped, idempotent on a tenant-qualified
 * key. A product is the catalog parent behind one or more lot-linked SKUs; its slug
 * is unique per tenant.
 *
 * Symmetric twin of the read ports: a pure validator (`validateCreateProduct`) plus a
 * thin command (`createProduct`) that calls the single `.rpc()` it needs (the
 * `CreateProductStore` port), testable against a fake store with no database. The
 * variety / process / tasting-notes are OPTIONAL (blank forwards null — a blend may
 * span varieties, notes are optional); the idempotency key is REQUIRED (the action/
 * form layer mints a stable token).
 */

/** Validated, domain-shaped create-product args (camelCase). */
export interface CreateProductInput {
  slug: string;
  name: string;
  /** Target variety; null ⇒ a blend / house style (nullable column). */
  variety: string | null;
  /** Process; null ⇒ not declared (nullable column). */
  process: string | null;
  /** Tasting notes; null ⇒ none yet (nullable column). */
  tastingNotes: string | null;
  idempotencyKey: string;
}

/**
 * Pure validation of a raw create-product request — mirrors the `products`
 * constraints (slug + name NOT NULL) so errors surface before the round-trip. The
 * tenant clamp + the unique-slug constraint are the RPC's / data layer's job (ADR-002).
 */
export function validateCreateProduct(
  raw: Record<string, unknown>,
): ValidationResult<CreateProductInput> {
  const errors: Record<string, string> = {};

  const slug = trimmed(raw.slug);
  if (!slug) errors.slug = "A product slug is required.";

  const name = trimmed(raw.name);
  if (!name) errors.name = "Name the product.";

  // Optional nullable text columns: blank ⇒ null.
  const variety = trimmed(raw.variety) || null;
  const process = trimmed(raw.process) || null;
  const tastingNotes = trimmed(raw.tastingNotes) || null;

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: { slug, name, variety, process, tastingNotes, idempotencyKey },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint product id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method `create_product` needs. */
export interface CreateProductStore {
  rpc(
    fn: "create_product",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the new product's id, or friendly/labelled errors. */
export type CreateProductResult =
  | { ok: true; productId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `create_product` onto a family-readable sentence —
 * the family must never see raw PG text (constraint names, errcodes). A duplicate
 * slug (the `products_tenant_slug_ux` unique constraint) is the one expected failure.
 * Always returns a clean sentence.
 */
export function friendlyCreateProductError(error: {
  message: string;
  code?: string;
}): string {
  const m = error.message.toLowerCase();
  if (error.code === "23505" || m.includes("unique") || m.includes("duplicate")) {
    return "A product with that slug already exists. Choose a different slug.";
  }
  return "This product couldn't be created right now. Please check the details and try again.";
}

/**
 * Validate then create: calls `create_product` exactly once with the snake_case
 * argument envelope. Bad input never reaches the RPC (friendly errors); an RPC failure
 * surfaces as a clean, family-readable sentence (raw Postgres text never leaks).
 * Exactly-once on `idempotencyKey` — a replay returns the same product id.
 */
export async function createProduct(
  store: CreateProductStore,
  raw: Record<string, unknown>,
): Promise<CreateProductResult> {
  const parsed = validateCreateProduct(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("create_product", {
    p_slug: parsed.data.slug,
    p_name: parsed.data.name,
    p_variety: parsed.data.variety,
    p_process: parsed.data.process,
    p_tasting_notes: parsed.data.tastingNotes,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return { ok: false, message: friendlyCreateProductError(error) };
  }
  if (data == null) {
    return {
      ok: false,
      message: "This product couldn't be created right now. Please try again.",
    };
  }
  return { ok: true, productId: Number(data) };
}
