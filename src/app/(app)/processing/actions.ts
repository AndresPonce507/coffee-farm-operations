"use server";

import { revalidatePath } from "next/cache";

import {
  advanceProcessingStage,
  type AdvanceProcessingStageResult,
  type AdvanceProcessingStageStore,
} from "@/lib/db/commands/advanceProcessingStage";
import { getSupabase } from "@/lib/supabase/server";
import { formToRecord } from "@/lib/validation/shared";

/**
 * Server Action for the PROCESS-ADVANCE slice — the first write off the
 * Processing surface that *moves* a lot through the pipeline (cherry →
 * fermentation → drying → parchment → milled → green), recording the mass that
 * survives each step. ADR-002 — Server Actions are the driving port, only ever
 * invoked by an authenticated human submitting a form.
 *
 * It builds the offline-ready event envelope server-side (D5: synthetic
 * `device_id`, dual clocks, a fresh idempotency key) and delegates to the
 * `advanceProcessingStage` command, whose single write door is the hardened
 * `advance_processing_stage` SECURITY DEFINER RPC (migration 20260621110000).
 * The RPC's CHECK violations — a BACKWARD move, a mass GAIN, or a non-existent
 * target stage — are translated by the command into clean, family-readable
 * messages; this action just surfaces them so the family never sees a raw
 * Postgres exception. A successful advance revalidates `/processing` (the
 * pipeline board) and `/` (the dashboard's pipeline metrics depend on it).
 */

export type ProcessingActionState =
  | { status: "idle" }
  | { status: "success"; message: string; lotCode?: string }
  | { status: "error"; message?: string; errors?: Record<string, string> };

export const PROCESSING_IDLE: ProcessingActionState = { status: "idle" };

function refresh() {
  revalidatePath("/processing");
  revalidatePath("/");
}

/** Map the advance command's friendly/labelled result onto the form's state. */
function toState(result: AdvanceProcessingStageResult): ProcessingActionState {
  if (result.ok) {
    return {
      status: "success",
      message: `Lot ${result.lotCode} advanced.`,
      lotCode: result.lotCode,
    };
  }
  return { status: "error", errors: result.errors, message: result.message };
}

export async function advanceStageAction(
  _prev: ProcessingActionState,
  formData: FormData,
): Promise<ProcessingActionState> {
  const raw = formToRecord(formData);

  // Build the offline-ready event envelope server-side (D5). For the single
  // online writer today, the synthetic `device_id` + a fresh idempotency key
  // fill the columns that are unrecoverable if added later; an explicit
  // `occurredAt` from the form (the real advance wall-clock) wins when present.
  const occurredAt =
    typeof raw.occurredAt === "string" && raw.occurredAt.trim()
      ? raw.occurredAt.trim()
      : new Date().toISOString();
  const idempotencyKey =
    typeof raw.idempotencyKey === "string" && raw.idempotencyKey.trim()
      ? raw.idempotencyKey.trim()
      : crypto.randomUUID();

  const sb = await getSupabase();
  const result = await advanceProcessingStage(
    sb as unknown as AdvanceProcessingStageStore,
    {
      ...raw,
      occurredAt,
      deviceId: "server",
      // A monotonic-ish per-call counter for the single online writer; the DB's
      // exactly-once anchor is the idempotency key, this is the Lamport column.
      deviceSeq: Date.now(),
      idempotencyKey,
    },
  );

  if (result.ok) refresh();
  return toState(result);
}
