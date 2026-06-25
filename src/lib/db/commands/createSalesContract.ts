import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for minting a standards-based sales contract (P3-S1; ADR-002 —
 * all writes flow through a SECURITY DEFINER command RPC). The single write door is
 * `create_sales_contract` — tenant-clamped, idempotent on a tenant-qualified key, and
 * it mints a gap-free monotonic `JC-K-NNNN` under an advisory lock. `incoterm` is
 * CHECK-constrained to Incoterms 2020; `pricing_basis` to fixed/differential/auction;
 * `contract_standard` to GCA/ECF/custom. The contract is born `status='draft'`.
 *
 * Symmetric twin of the read ports: a pure validator plus a thin command that calls
 * the one `.rpc()` it needs (the `CreateSalesContractStore` port), testable with no DB.
 */

/** The Incoterms 2020 CHECK set (the `sales_contracts.incoterm` constraint). */
export const INCOTERMS_2020 = [
  "EXW",
  "FCA",
  "CPT",
  "CIP",
  "DAP",
  "DPU",
  "DDP",
  "FAS",
  "FOB",
  "CFR",
  "CIF",
] as const;
export type Incoterm2020 = (typeof INCOTERMS_2020)[number];

/** The `pricing_basis` CHECK set. */
export const PRICING_BASES = ["fixed", "differential", "auction"] as const;
export type PricingBasis = (typeof PRICING_BASES)[number];

/** The `contract_standard` CHECK set. */
export const CONTRACT_STANDARDS = ["GCA", "ECF", "custom"] as const;
export type ContractStandard = (typeof CONTRACT_STANDARDS)[number];

/** Validated, domain-shaped contract args (camelCase). */
export interface CreateSalesContractInput {
  buyerId: number;
  incoterm: Incoterm2020;
  /** Named place for the Incoterm (e.g. "Balboa, PA"); null ⇒ unset. */
  incotermNamedPlace: string | null;
  /** GCA | ECF | custom; null ⇒ unset. */
  contractStandard: ContractStandard | null;
  pricingBasis: PricingBasis;
  /** Settlement currency — defaults to 'USD'. */
  currency: string;
  idempotencyKey: string;
}

function isIncoterm(v: string): v is Incoterm2020 {
  return (INCOTERMS_2020 as readonly string[]).includes(v);
}
function isPricingBasis(v: string): v is PricingBasis {
  return (PRICING_BASES as readonly string[]).includes(v);
}
function isContractStandard(v: string): v is ContractStandard {
  return (CONTRACT_STANDARDS as readonly string[]).includes(v);
}

/**
 * Pure validation of a raw contract — mirrors the `sales_contracts` CHECK constraints
 * (Incoterms 2020, pricing_basis, contract_standard, buyer FK) so errors surface
 * before the round-trip. The minter + clamp + CHECKs are the real enforcement.
 */
export function validateCreateSalesContract(
  raw: Record<string, unknown>,
): ValidationResult<CreateSalesContractInput> {
  const errors: Record<string, string> = {};

  const buyerId = toNumber(raw.buyerId);
  if (buyerId === null || !Number.isInteger(buyerId) || buyerId <= 0) {
    errors.buyerId = "Choose a buyer.";
  }

  const rawIncoterm = trimmed(raw.incoterm).toUpperCase();
  if (!rawIncoterm || !isIncoterm(rawIncoterm)) {
    errors.incoterm = "Choose a valid Incoterm (e.g. FOB, CIF, EXW).";
  }

  const incotermNamedPlace = trimmed(raw.incotermNamedPlace) || null;

  const rawBasis = trimmed(raw.pricingBasis);
  if (!rawBasis || !isPricingBasis(rawBasis)) {
    errors.pricingBasis = "Choose a pricing basis (fixed, differential, or auction).";
  }

  // contract_standard: optional, but a supplied value must be in the CHECK set.
  const rawStandard = trimmed(raw.contractStandard);
  let contractStandard: ContractStandard | null = null;
  if (rawStandard) {
    if (!isContractStandard(rawStandard)) {
      errors.contractStandard = "Choose a valid standard (GCA, ECF, or custom).";
    } else {
      contractStandard = rawStandard;
    }
  }

  const currency = trimmed(raw.currency) || "USD";

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      buyerId: buyerId as number,
      incoterm: rawIncoterm as Incoterm2020,
      incotermNamedPlace,
      contractStandard,
      pricingBasis: rawBasis as PricingBasis,
      currency,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint contract id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method `create_sales_contract` needs. */
export interface CreateSalesContractStore {
  rpc(
    fn: "create_sales_contract",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the contract id, or friendly/labelled errors. */
export type CreateSalesContractResult =
  | { ok: true; contractId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Validate then create: calls `create_sales_contract` exactly once with the snake_case
 * argument envelope. Bad input never reaches the RPC (friendly errors); a failure
 * surfaces as a labelled message (raw Postgres text never leaks). Exactly-once on
 * `idempotencyKey` — a replay returns the same contract id with no second mint.
 */
export async function createSalesContract(
  store: CreateSalesContractStore,
  raw: Record<string, unknown>,
): Promise<CreateSalesContractResult> {
  const parsed = validateCreateSalesContract(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("create_sales_contract", {
    p_buyer_id: parsed.data.buyerId,
    p_incoterm: parsed.data.incoterm,
    p_incoterm_named_place: parsed.data.incotermNamedPlace,
    p_contract_standard: parsed.data.contractStandard,
    p_pricing_basis: parsed.data.pricingBasis,
    p_currency: parsed.data.currency,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    const m = error.message.toLowerCase();
    if (error.code === "23503" || /unknown buyer|foreign key/.test(m)) {
      return {
        ok: false,
        message: "That buyer couldn't be found. Pick a buyer from the list and try again.",
      };
    }
    return {
      ok: false,
      message: "This contract couldn't be created right now. Please check the details and try again.",
    };
  }
  if (data == null) {
    return { ok: false, message: "This contract couldn't be created right now. Please try again." };
  }
  return { ok: true, contractId: Number(data) };
}
