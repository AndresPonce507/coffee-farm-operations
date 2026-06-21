"use server";

import { revalidatePath } from "next/cache";

import {
  computePayPeriod,
  type ComputePayPeriodResult,
  type ComputePayPeriodStore,
} from "@/lib/db/commands/computePayPeriod";
import {
  approvePayLine,
  type ApprovePayLineResult,
  type ApprovePayLineStore,
} from "@/lib/db/commands/approvePayLine";
import {
  recordDisbursement,
  type RecordDisbursementResult,
  type RecordDisbursementStore,
} from "@/lib/db/commands/recordDisbursement";
import { getSupabase } from "@/lib/supabase/server";
import { formToRecord } from "@/lib/validation/shared";
import type { PayrollActionState } from "./state";

/**
 * Server Actions for the P2-S7 payroll cockpit (ADR-002 — Server Actions are the
 * driving port, only ever invoked by an authenticated human submitting a form).
 * Each delegates to its already-tested command port whose single write door is a
 * SECURITY DEFINER RPC. The make-whole guard, statutory math, append-only ledgers,
 * and the disbursement→COGS write all live in the database — these actions only
 * marshal the form and surface a friendly result.
 *
 * ⚠️ MONEY-SHAPED ACTIONS ARE NEVER AUTOMATIC. `record_disbursement` is the
 * irreversible action; it fires ONLY from this explicit human-submitted form. No
 * automation path reaches it (DESIGN §S7 invariant + the global irreversible-action
 * rule). A real payment API is NOT integrated — disbursement is record-only.
 */

/** Read the form value if a non-blank string, else `undefined`. */
function str(raw: Record<string, unknown>, key: string): string | undefined {
  const v = raw[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** A freshly-minted uuid when the form carries no idempotency key. */
function idempotencyKeyOrNew(raw: Record<string, unknown>): string {
  return str(raw, "idempotencyKey") ?? crypto.randomUUID();
}

function toState(
  result:
    | ComputePayPeriodResult
    | ApprovePayLineResult
    | RecordDisbursementResult,
  successMessage: string,
): PayrollActionState {
  if (result.ok) return { status: "success", message: successMessage };
  return { status: "error", errors: result.errors, message: result.message };
}

/** Calculate (freeze the snapshot for) a pay period. */
export async function computePayPeriodAction(
  formData: FormData,
): Promise<PayrollActionState> {
  const raw = formToRecord(formData);
  const sb = await getSupabase();
  const result = await computePayPeriod(sb as unknown as ComputePayPeriodStore, {
    ...raw,
    hourlyRateSource: str(raw, "hourlyRateSource") ?? "daily",
  });
  if (result.ok) {
    revalidatePath("/payroll");
    revalidatePath("/costing");
  }
  return toState(result, "Pay period calculated.");
}

/** Approve one frozen pay line (the review gate before disbursing). */
export async function approvePayLineAction(
  formData: FormData,
): Promise<PayrollActionState> {
  const raw = formToRecord(formData);
  const sb = await getSupabase();
  const result = await approvePayLine(sb as unknown as ApprovePayLineStore, raw);
  if (result.ok) revalidatePath("/payroll");
  return toState(result, "Pay line approved.");
}

/**
 * Record a disbursement against a worker+period. THE irreversible money-shaped
 * action — deliberate, human-confirmed, record-only (no payment API). Writes the
 * matching Phase-1 COGS cost_entry so payroll IS labor cost with no double-keying.
 */
export async function recordDisbursementAction(
  formData: FormData,
): Promise<PayrollActionState> {
  const raw = formToRecord(formData);
  const sb = await getSupabase();
  const result = await recordDisbursement(
    sb as unknown as RecordDisbursementStore,
    { ...raw, idempotencyKey: idempotencyKeyOrNew(raw) },
  );
  if (result.ok) {
    revalidatePath("/payroll");
    revalidatePath("/costing");
  }
  return toState(result, "Disbursement recorded.");
}
