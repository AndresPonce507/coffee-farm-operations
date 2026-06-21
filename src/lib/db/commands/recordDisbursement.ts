import {
  toNumber,
  trimmed,
  type ValidationResult,
} from "@/lib/validation/shared";

/**
 * Write-side command for recording a payroll disbursement (P2-S7 — THE PEOPLE-TRUNK
 * CAPSTONE; ADR-002: all writes flow through a single SECURITY DEFINER command RPC).
 *
 * ⚠️ RECORD-ONLY (DESIGN §4.3 flag, dormant): this does NOT integrate a real payment
 * API. It records a payment that a human has already moved (Yappy / Nequi / ACH /
 * signed-cash) and writes the matching Phase-1 COGS cost_entry — moving money is a
 * confirmed human action; NO automation path disburses. A real payment-rail
 * integration is a flagged, dormant later option.
 *
 * A pure validator (`validateRecordDisbursement`, the friendly-error seam) plus a thin
 * command (`recordDisbursement`) that calls the single write door, `record_disbursement`.
 * The command takes only the one `.rpc()` method it needs (the `RecordDisbursementStore`
 * port) so it is testable against a fake store with no database — the SQL CHECK/raise
 * inside the RPC (amount >= 0, the cash-signed-needs-signature rule, the line-must-be-
 * approved gate, exactly-once on the idempotency key) is the *real* enforcement; the
 * validation here exists purely to surface friendly errors before the round-trip.
 *
 * The RPC is exactly-once on `idempotencyKey` (carried as the disbursement ref) — a
 * retry returns the original disbursement. It returns the disbursement id (bigint →
 * number).
 */

/** The recognised disbursement rails — mirrors the SQL `method` CHECK. */
export const DISBURSEMENT_METHODS = [
  "yappy",
  "nequi",
  "ach",
  "cash-signed",
] as const;
export type DisbursementMethod = (typeof DISBURSEMENT_METHODS)[number];

/** Validated, domain-shaped record-disbursement args (camelCase). */
export interface RecordDisbursementInput {
  /** The period key — `p_pay_period_id`, non-blank. */
  payPeriodId: string;
  /** The worker — `p_worker_id`, non-blank. */
  workerId: string;
  /** Amount in USD — `p_amount_usd`, must be finite and >= 0. */
  amountUsd: number;
  /** The rail used — `p_method` (one of the recognised methods). */
  method: DisbursementMethod;
  /** External transfer ref / receipt no. — `p_ref` (nullable). */
  ref: string | null;
  /**
   * For cash-signed: the worker's signature capture — `p_signature_ref` (nullable,
   * but REQUIRED when method is 'cash-signed' — the unbanked-crew dignity + audit rule).
   */
  signatureRef: string | null;
  /** Exactly-once anchor — the DB dedupes on this (`idempotency_key`). */
  idempotencyKey: string;
}

/**
 * Pure validation of a raw disbursement record — mirrors the `record_disbursement`
 * DB constraints (amount >= 0, the recognised methods, the cash-signed-needs-signature
 * cross-field rule) so errors surface before the round-trip. The SQL CHECK/raise (and
 * the line-must-be-approved gate, which lives only in the RPC) is the actual
 * enforcement (ADR-002).
 */
export function validateRecordDisbursement(
  raw: Record<string, unknown>,
): ValidationResult<RecordDisbursementInput> {
  const errors: Record<string, string> = {};

  const payPeriodId = trimmed(raw.payPeriodId);
  if (!payPeriodId) errors.payPeriodId = "A pay period is required.";

  const workerId = trimmed(raw.workerId);
  if (!workerId) errors.workerId = "Choose a worker.";

  const amountUsd = toNumber(raw.amountUsd);
  if (amountUsd === null || amountUsd < 0) {
    errors.amountUsd = "Amount (USD) must be 0 or greater.";
  }

  const method = trimmed(raw.method) as DisbursementMethod;
  if (!DISBURSEMENT_METHODS.includes(method)) {
    errors.method = "Choose a disbursement method.";
  }

  // ref is optional.
  const refRaw = trimmed(raw.ref);
  const ref = refRaw === "" ? null : refRaw;

  // signatureRef is optional in general, but REQUIRED for a cash-signed payment (the
  // unbanked-crew dignity + audit requirement — mirrors the SQL CHECK).
  const signatureRefRaw = trimmed(raw.signatureRef);
  const signatureRef = signatureRefRaw === "" ? null : signatureRefRaw;
  if (method === "cash-signed" && signatureRef === null) {
    errors.signatureRef = "A signed-cash payment needs the worker's signature.";
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) {
    errors.idempotencyKey = "An idempotency key is required.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      payPeriodId,
      workerId,
      amountUsd: amountUsd as number,
      method,
      ref,
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
 * The narrow write port the command depends on — exactly the one `.rpc()` method
 * `record_disbursement` needs. A Supabase client satisfies this structurally; a
 * hand-rolled stub satisfies it in pure-domain tests.
 */
export interface RecordDisbursementStore {
  rpc(
    fn: "record_disbursement",
    args: Record<string, unknown>,
  ): Promise<RpcResult>;
}

/** Outcome of the command: the disbursement id, or friendly/labelled errors. */
export type RecordDisbursementResult =
  | { ok: true; disbursementId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Build the snake_case argument envelope the SECURITY DEFINER RPC expects from a
 * validated input. Exported so a caller can build the exact same envelope without
 * re-validating.
 */
export function recordDisbursementRpcArgs(
  input: RecordDisbursementInput,
): Record<string, unknown> {
  return {
    p_pay_period_id: input.payPeriodId,
    p_worker_id: input.workerId,
    p_amount_usd: input.amountUsd,
    p_method: input.method,
    p_ref: input.ref,
    p_signature_ref: input.signatureRef,
    p_idempotency_key: input.idempotencyKey,
  };
}

/**
 * Validate then record: calls `record_disbursement` exactly once with the snake_case
 * envelope. Bad input never reaches the RPC (friendly errors); RPC failures surface
 * labelled. RECORD-ONLY — no money moves here (DESIGN §4.3, dormant); this only logs a
 * payment a human already made. The RPC is exactly-once on `idempotencyKey` — a retry
 * returns the original disbursement id, writing no second record.
 */
export async function recordDisbursement(
  store: RecordDisbursementStore,
  raw: Record<string, unknown>,
): Promise<RecordDisbursementResult> {
  const parsed = validateRecordDisbursement(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc(
    "record_disbursement",
    recordDisbursementRpcArgs(parsed.data),
  );

  if (error) {
    return { ok: false, message: `record_disbursement: ${error.message}` };
  }
  if (data === null || data === undefined) {
    return { ok: false, message: "record_disbursement: no disbursement id returned" };
  }
  return { ok: true, disbursementId: data };
}
