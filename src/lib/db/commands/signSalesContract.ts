import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for signing a sales contract (P3-S1; ADR-002 — all writes flow
 * through a SECURITY DEFINER command RPC). The single write door is
 * `sign_sales_contract(p_contract_id bigint, p_idempotency_key text)` — tenant-clamped,
 * idempotent on a tenant-qualified key. The RPC requires the contract in `status='draft'`
 * with >= 1 line, flips it to 'signed', and appends a `'contract_signed'` lot_event per
 * distinct green lot (so `verify_chain` covers offer→signed).
 *
 * KEYSTONE SEAM: P3-S2 RE-CREATES this RPC with the SAME `(bigint, text)` signature,
 * adding the reserve-contract prereq — a reserve lot requires an APPROVED pre-shipment
 * sample or the sign is rejected. This command binds to the stable name + envelope and
 * maps that future rejection forward, so the message is ready the moment S2 lands.
 *
 * Symmetric twin of the read ports: a pure validator plus a thin command that calls
 * the one `.rpc()` it needs (the `SignSalesContractStore` port), testable with no DB.
 */

/** Validated, domain-shaped sign args (camelCase). */
export interface SignSalesContractInput {
  contractId: number;
  idempotencyKey: string;
}

/**
 * Pure validation of a raw sign request — a real contract id + an idempotency key.
 * The >=1-line / draft-only / reserve-sample gates are the RPC's job (the real
 * enforcement); this is the friendly pre-check.
 */
export function validateSignSalesContract(
  raw: Record<string, unknown>,
): ValidationResult<SignSalesContractInput> {
  const errors: Record<string, string> = {};

  const contractId = toNumber(raw.contractId);
  if (contractId === null || !Number.isInteger(contractId) || contractId <= 0) {
    errors.contractId = "Choose a contract to sign.";
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: { contractId: contractId as number, idempotencyKey },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint contract id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method `sign_sales_contract` needs. */
export interface SignSalesContractStore {
  rpc(
    fn: "sign_sales_contract",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the signed contract id, or friendly/labelled errors. */
export type SignSalesContractResult =
  | { ok: true; contractId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `sign_sales_contract` onto a family-readable sentence.
 * Covers the >=1-line gate, the draft-only / already-signed gate, and the P3-S2
 * reserve approved-sample prereq. Returns null for anything unrecognised so the caller
 * can fall back to a generic labelled message.
 */
export function friendlySignSalesContractError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  // The P3-S2 reserve prereq — an approved pre-shipment sample is required.
  if (/sample/.test(m)) {
    return "This reserve contract needs an approved pre-shipment sample before it can be signed. Log the sample's approval first.";
  }
  // The >= 1-line gate.
  if (/at least one line|no lines|requires.*line|needs.*line|one line/.test(m)) {
    return "Add at least one line before signing this contract.";
  }
  // The draft-only / already-signed gate.
  if (/draft|already signed|status|cannot be signed/.test(m)) {
    return "This contract can't be signed — it may already be signed, closed, or cancelled.";
  }
  // Unknown contract.
  if (error.code === "23503" || /unknown contract|foreign key|not found/.test(m)) {
    return "That contract couldn't be found. Refresh and try again.";
  }
  return null;
}

/**
 * Validate then sign: calls `sign_sales_contract` exactly once with the snake_case
 * argument envelope. Bad input never reaches the RPC (friendly errors); the gates
 * (no lines, not a draft, missing reserve sample) surface as CLEAN sentences, any
 * other failure surfaces labelled. Exactly-once on `idempotencyKey`.
 */
export async function signSalesContract(
  store: SignSalesContractStore,
  raw: Record<string, unknown>,
): Promise<SignSalesContractResult> {
  const parsed = validateSignSalesContract(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("sign_sales_contract", {
    p_contract_id: parsed.data.contractId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlySignSalesContractError(error) ??
        "This contract couldn't be signed right now. Please try again.",
    };
  }
  if (data == null) {
    return { ok: false, message: "This contract couldn't be signed right now. Please try again." };
  }
  return { ok: true, contractId: Number(data) };
}
