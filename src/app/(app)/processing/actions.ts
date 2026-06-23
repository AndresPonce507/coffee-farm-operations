"use server";

import { reactiveRefresh } from "@/lib/revalidate";

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
 * It builds the offline-ready event envelope server-side (D5: a processing-
 * specific `device_id`, dual clocks, a collision-proof `device_seq`, and a
 * STABLE idempotency key carried from the form so a double-submit is a DB no-op)
 * and delegates to the `advanceProcessingStage` command, whose single write door
 * is the hardened `advance_processing_stage` SECURITY DEFINER RPC.
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

/**
 * Offline node identity for processing advances — DISTINCT from intake's
 * `"server"` so the two write surfaces can never collide on the
 * `lot_event (device_id, device_seq)` unique key.
 */
const PROCESSING_DEVICE_ID = "server-processing";

/**
 * A strictly-increasing per-call `device_seq` (the Lamport column). `Date.now()`
 * alone collides on two advances within the same millisecond, breaking the
 * `lot_event (device_id, device_seq)` unique key; a process-monotonic counter
 * folded onto a ms time-base makes every call's seq distinct while staying a
 * non-negative SAFE integer. (The real exactly-once anchor is the idempotency
 * key; this column just has to be unique-per-event.)
 */
let advanceSeqCounter = 0;
const ADVANCE_SEQ_BASE = Date.now() * 1000;
function nextDeviceSeq(): number {
  return ADVANCE_SEQ_BASE + advanceSeqCounter++;
}

function refresh() {
  reactiveRefresh("processing-batch");
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
      // A processing-specific device namespace, distinct from intake's "server".
      deviceId: PROCESSING_DEVICE_ID,
      // A strictly-increasing, collision-proof Lamport counter — two advances in
      // the same millisecond no longer share a device_seq. The DB's exactly-once
      // anchor remains the (stable, form-carried) idempotency key.
      deviceSeq: nextDeviceSeq(),
      idempotencyKey,
    },
  );

  if (result.ok) refresh();
  return toState(result);
}
