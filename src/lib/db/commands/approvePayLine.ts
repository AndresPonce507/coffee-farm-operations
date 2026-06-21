import { toNumber, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for approving a calculated pay line (P2-S7 — THE PEOPLE-TRUNK
 * CAPSTONE; ADR-002: all writes flow through a single SECURITY DEFINER command RPC).
 *
 * A pure validator (`validateApprovePayLine`, the friendly-error seam) plus a thin
 * command (`approvePayLine`) that calls the single write door, `approve_pay_line`.
 * The command takes only the one `.rpc()` method it needs (the `ApprovePayLineStore`
 * port) so it is testable against a fake store with no database — the SQL CHECK/raise
 * inside the RPC (the calculated→approved status gate, policed by the append-only
 * block trigger) is the *real* enforcement; the validation here exists purely to
 * surface friendly errors before the round-trip.
 *
 * The RPC flips the one allowed narrow UPDATE (status only) and is idempotent — an
 * already-approved line returns its own id. It returns the pay_line id (a bigint →
 * number).
 */

/** Validated, domain-shaped approve-pay-line args (camelCase). */
export interface ApprovePayLineInput {
  /** The pay_line id — `p_pay_line_id` (a positive integer bigint). */
  payLineId: number;
}

/**
 * Pure validation of a raw approve-pay-line record — the id must be a positive
 * integer (a bigint identity). The SQL raise (unknown line / wrong status) is the
 * actual enforcement (ADR-002).
 */
export function validateApprovePayLine(
  raw: Record<string, unknown>,
): ValidationResult<ApprovePayLineInput> {
  const errors: Record<string, string> = {};

  const payLineId = toNumber(raw.payLineId);
  if (payLineId === null || payLineId <= 0 || !Number.isInteger(payLineId)) {
    errors.payLineId = "A pay line is required.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, data: { payLineId: payLineId as number } };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint → number). */
interface RpcResult {
  data: number | null;
  error: { message: string } | null;
}

/**
 * The narrow write port the command depends on — exactly the one `.rpc()` method
 * `approve_pay_line` needs. A Supabase client satisfies this structurally; a
 * hand-rolled stub satisfies it in pure-domain tests.
 */
export interface ApprovePayLineStore {
  rpc(fn: "approve_pay_line", args: Record<string, unknown>): Promise<RpcResult>;
}

/** Outcome of the command: the approved line id, or friendly/labelled errors. */
export type ApprovePayLineResult =
  | { ok: true; payLineId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Build the snake_case argument envelope the SECURITY DEFINER RPC expects from a
 * validated input. Exported so a caller can build the exact same envelope without
 * re-validating.
 */
export function approvePayLineRpcArgs(
  input: ApprovePayLineInput,
): Record<string, unknown> {
  return { p_pay_line_id: input.payLineId };
}

/**
 * Validate then approve: calls `approve_pay_line` exactly once with the snake_case
 * envelope. Bad input never reaches the RPC (friendly errors); RPC failures surface
 * labelled. The RPC is idempotent — approving an already-approved line returns its
 * own id, mutating nothing.
 */
export async function approvePayLine(
  store: ApprovePayLineStore,
  raw: Record<string, unknown>,
): Promise<ApprovePayLineResult> {
  const parsed = validateApprovePayLine(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc(
    "approve_pay_line",
    approvePayLineRpcArgs(parsed.data),
  );

  if (error) {
    return { ok: false, message: `approve_pay_line: ${error.message}` };
  }
  if (data === null || data === undefined) {
    return { ok: false, message: "approve_pay_line: no pay line id returned" };
  }
  return { ok: true, payLineId: data };
}
