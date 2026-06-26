import { trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for creating a B2B green-buyer master record (P3-S1 — the
 * contract-to-cash trade trunk; ADR-002 — all writes flow through a SECURITY DEFINER
 * command RPC). The single write door is `create_b2b_buyer` — tenant-clamped,
 * idempotent on a tenant-qualified key. `b2b_buyers` is the green-buyer CRM root
 * (P3-S18 extends it additively). `buyer_type` is CHECK-constrained to
 * roaster/importer/agent; country_code drives the consignee block; the
 * incoterm/currency defaults pre-fill a new contract. Optional fields forward null.
 *
 * Symmetric twin of the read ports: a pure validator plus a thin command that calls
 * the one `.rpc()` it needs (the `CreateB2bBuyerStore` port), testable with no DB.
 */

/** The `buyer_type` CHECK set. */
export const B2B_BUYER_TYPES = ["roaster", "importer", "agent"] as const;
export type B2bBuyerType = (typeof B2B_BUYER_TYPES)[number];

/** Validated, domain-shaped buyer args (camelCase). */
export interface CreateB2bBuyerInput {
  name: string;
  /** ISO country code (drives the consignee block); null ⇒ unset. */
  countryCode: string | null;
  /** roaster | importer | agent; null ⇒ unset. */
  buyerType: B2bBuyerType | null;
  /** Default Incoterm pre-fill for new contracts; null ⇒ unset. */
  defaultIncoterm: string | null;
  /** Default settlement currency — defaults to 'USD'. */
  defaultCurrency: string;
  idempotencyKey: string;
}

/** Is `v` one of the recognised buyer types? (mirrors the CHECK) */
function isBuyerType(v: string): v is B2bBuyerType {
  return (B2B_BUYER_TYPES as readonly string[]).includes(v);
}

/**
 * Pure validation of a raw buyer — mirrors the `b2b_buyers` constraints (name
 * required, buyer_type CHECK) so errors surface before the round-trip. The tenant
 * clamp + CHECK are the actual enforcement (ADR-002). Optional fields forward null.
 */
export function validateCreateB2bBuyer(
  raw: Record<string, unknown>,
): ValidationResult<CreateB2bBuyerInput> {
  const errors: Record<string, string> = {};

  const name = trimmed(raw.name);
  if (!name) errors.name = "A buyer name is required.";

  const countryCode = trimmed(raw.countryCode) || null;
  const defaultIncoterm = trimmed(raw.defaultIncoterm) || null;
  const defaultCurrency = trimmed(raw.defaultCurrency) || "USD";

  // buyer_type: optional, but a supplied value must be one of the CHECK set.
  const rawType = trimmed(raw.buyerType);
  let buyerType: B2bBuyerType | null = null;
  if (rawType) {
    if (!isBuyerType(rawType)) {
      errors.buyerType = "Choose roaster, importer, or agent.";
    } else {
      buyerType = rawType;
    }
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      name,
      countryCode,
      buyerType,
      defaultIncoterm,
      defaultCurrency,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint buyer id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method `create_b2b_buyer` needs. */
export interface CreateB2bBuyerStore {
  rpc(
    fn: "create_b2b_buyer",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the buyer id, or friendly/labelled errors. */
export type CreateB2bBuyerResult =
  | { ok: true; buyerId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Validate then create: calls `create_b2b_buyer` exactly once with the snake_case
 * argument envelope. Bad input never reaches the RPC (friendly errors); a failure
 * surfaces as a labelled message (raw Postgres text never leaks). Exactly-once on
 * `idempotencyKey` — a replay returns the same buyer id with no second insert.
 */
export async function createB2bBuyer(
  store: CreateB2bBuyerStore,
  raw: Record<string, unknown>,
): Promise<CreateB2bBuyerResult> {
  const parsed = validateCreateB2bBuyer(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("create_b2b_buyer", {
    p_name: parsed.data.name,
    p_country_code: parsed.data.countryCode,
    p_buyer_type: parsed.data.buyerType,
    p_default_incoterm: parsed.data.defaultIncoterm,
    p_default_currency: parsed.data.defaultCurrency,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message: "This buyer couldn't be saved right now. Please check the details and try again.",
    };
  }
  if (data == null) {
    return { ok: false, message: "This buyer couldn't be saved right now. Please try again." };
  }
  return { ok: true, buyerId: Number(data) };
}
