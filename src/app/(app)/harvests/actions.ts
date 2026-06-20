"use server";

import { revalidatePath } from "next/cache";

import {
  recordCherryIntake,
  type CherryIntakeResult,
  type CherryIntakeStore,
} from "@/lib/db/commands/recordCherryIntake";
import { getSupabase } from "@/lib/supabase/server";
import { formToRecord } from "@/lib/validation/shared";

/**
 * Server Action for the first real write the family makes that the *system*,
 * not a human, numbers and audits: a picker's lata of cherry recorded as a
 * gap-free monotonic `JC-NNN` lot (ADR-002 — Server Actions are the driving
 * port; a Server Action is only ever invoked by an authenticated human
 * submitting a form). It builds the offline-ready event envelope server-side
 * (D5: synthetic `device_id`, dual clocks) and delegates to the command, whose
 * single write door is the `record_cherry_intake` SECURITY DEFINER RPC.
 */

export type IntakeActionState =
  | { status: "idle" }
  | { status: "success"; message: string; lotCode: string }
  | { status: "error"; message?: string; errors?: Record<string, string> };

export const INTAKE_IDLE: IntakeActionState = { status: "idle" };

function refresh() {
  revalidatePath("/harvests");
  revalidatePath("/");
}

/** Map the command's friendly/labelled result onto the form's action state. */
function toState(result: CherryIntakeResult): IntakeActionState {
  if (result.ok) {
    return {
      status: "success",
      message: `Lot ${result.lotCode} minted.`,
      lotCode: result.lotCode,
    };
  }
  return { status: "error", errors: result.errors, message: result.message };
}

export async function recordCherryIntakeAction(
  _prev: IntakeActionState,
  formData: FormData,
): Promise<IntakeActionState> {
  const raw = formToRecord(formData);

  // Build the offline-ready event envelope server-side (D5). For the single
  // online writer today, the synthetic `device_id` + a fresh idempotency key
  // fill the columns that are unrecoverable if added later; an explicit
  // `idempotencyKey` from the form (retry-safe submit) wins when present.
  const occurredAt =
    typeof raw.occurredAt === "string" && raw.occurredAt.trim()
      ? raw.occurredAt.trim()
      : new Date().toISOString();
  const idempotencyKey =
    typeof raw.idempotencyKey === "string" && raw.idempotencyKey.trim()
      ? raw.idempotencyKey.trim()
      : crypto.randomUUID();

  const sb = await getSupabase();
  const result = await recordCherryIntake(sb as unknown as CherryIntakeStore, {
    ...raw,
    occurredAt,
    deviceId: "server",
    deviceSeq: 0,
    idempotencyKey,
  });

  if (result.ok) refresh();
  return toState(result);
}
