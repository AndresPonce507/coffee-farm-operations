import {
  isISODate,
  toNumber,
  trimmed,
  type ValidationResult,
} from "@/lib/validation/shared";

/**
 * Write-side command for signing a por-obra (piece-rate) contract (ADR-002 — all
 * writes flow through a `SECURITY DEFINER` command RPC, one per business intent).
 *
 * A pure validator (`validatePorObra`, the friendly-error seam) plus a thin
 * command (`signPorObra`) that calls the *single write door*,
 * `sign_por_obra_contract`. The command takes only the one `.rpc()` method it
 * needs (the `PorObraStore` port) so it is testable against a fake store with no
 * database — the SQL CHECK/raise inside the RPC is the *real* enforcement. This
 * RPC returns a `bigint` contract id (number) rather than a uuid.
 *
 * Mirrors the established `@/lib/validation/*` `ValidationResult` contract.
 */

/** The recognised piece-rate bases — mirrors the SQL CHECK. */
const RATE_BASES = ["per-lata", "per-kg", "per-tarea", "per-tree"] as const;
type RateBasis = (typeof RATE_BASES)[number];

/** Validated, domain-shaped por-obra contract args (camelCase). */
export interface PorObraInput {
  workerId: string;
  taskKind: string;
  rateBasis: RateBasis;
  /** Piece rate in USD — `rate_usd`, must be finite and >= 0. */
  rateUsd: number;
  /** Contract start date — `effective_from` (ISO date, required). */
  effectiveFrom: string;
  /** Contract end date — `effective_to` (ISO date, nullable; >= from). */
  effectiveTo: string | null;
  /** Optional reference to the captured signature — `signature_ref`. */
  signatureRef: string | null;
  /** Exactly-once anchor — the DB dedupes on this (`idempotency_key`). */
  idempotencyKey: string;
}

/**
 * Pure validation of a raw por-obra record — mirrors the
 * `sign_por_obra_contract` DB constraints (including the cross-field
 * effective-range rule) so errors surface before the round-trip. The SQL
 * CHECK/raise is the actual enforcement (ADR-002).
 */
export function validatePorObra(
  raw: Record<string, unknown>,
): ValidationResult<PorObraInput> {
  const errors: Record<string, string> = {};

  const workerId = trimmed(raw.workerId);
  if (!workerId) errors.workerId = "Choose a worker.";

  const taskKind = trimmed(raw.taskKind);
  if (!taskKind) errors.taskKind = "A task kind is required.";

  const rateBasis = trimmed(raw.rateBasis) as RateBasis;
  if (!RATE_BASES.includes(rateBasis)) {
    errors.rateBasis = "Choose a rate basis.";
  }

  const rateUsd = toNumber(raw.rateUsd);
  if (rateUsd === null || rateUsd < 0) {
    errors.rateUsd = "Rate (USD) must be 0 or greater.";
  }

  const effectiveFrom = trimmed(raw.effectiveFrom);
  if (!isISODate(effectiveFrom)) {
    errors.effectiveFrom = "A valid start date is required.";
  }

  // effectiveTo is optional; when present it must be an ISO date on or after
  // effectiveFrom. Only run the cross-field comparison once both dates parse.
  const effectiveToRaw = trimmed(raw.effectiveTo);
  let effectiveTo: string | null = null;
  if (effectiveToRaw !== "") {
    if (!isISODate(effectiveToRaw)) {
      errors.effectiveTo = "A valid end date is required.";
    } else if (isISODate(effectiveFrom) && effectiveToRaw < effectiveFrom) {
      errors.effectiveTo = "End date must be on or after the start date.";
    } else {
      effectiveTo = effectiveToRaw;
    }
  }

  // signatureRef is optional.
  const signatureRefRaw = trimmed(raw.signatureRef);
  const signatureRef = signatureRefRaw === "" ? null : signatureRefRaw;

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) {
    errors.idempotencyKey = "An idempotency key is required.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      workerId,
      taskKind,
      rateBasis,
      rateUsd: rateUsd as number,
      effectiveFrom,
      effectiveTo,
      signatureRef,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint → number). */
interface RpcResult {
  data: number | null;
  error: { message: string } | null;
}

/**
 * The narrow write port the command depends on — exactly the one `.rpc()`
 * method `sign_por_obra_contract` needs. A Supabase client satisfies this
 * structurally; a hand-rolled stub satisfies it in pure-domain tests.
 */
export interface PorObraStore {
  rpc(fn: "sign_por_obra_contract", args: Record<string, unknown>): Promise<RpcResult>;
}

/** Outcome of the command: the contract id, or friendly/labelled errors. */
export type PorObraResult =
  | { ok: true; contractId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Validate then sign: calls `sign_por_obra_contract` exactly once with the
 * snake_case argument envelope the SECURITY DEFINER RPC expects. Bad input never
 * reaches the RPC (friendly errors); RPC failures surface labelled. The RPC is
 * exactly-once on `idempotencyKey` — a replay returns the originally minted
 * contract id, no second contract.
 */
export async function signPorObra(
  store: PorObraStore,
  raw: Record<string, unknown>,
): Promise<PorObraResult> {
  const parsed = validatePorObra(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("sign_por_obra_contract", {
    p_worker_id: parsed.data.workerId,
    p_task_kind: parsed.data.taskKind,
    p_rate_basis: parsed.data.rateBasis,
    p_rate_usd: parsed.data.rateUsd,
    p_effective_from: parsed.data.effectiveFrom,
    p_effective_to: parsed.data.effectiveTo,
    p_signature_ref: parsed.data.signatureRef,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return { ok: false, message: `sign_por_obra_contract: ${error.message}` };
  }
  if (data === null || data === undefined) {
    return { ok: false, message: "sign_por_obra_contract: no contract id returned" };
  }
  return { ok: true, contractId: data };
}
