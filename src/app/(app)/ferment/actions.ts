"use server";

import { revalidatePath } from "next/cache";

import {
  recordFermentReading,
  type RecordFermentReadingResult,
  type RecordFermentReadingStore,
} from "@/lib/db/commands/recordFermentReading";
import {
  startFermentBatch,
  type StartFermentBatchResult,
  type StartFermentBatchStore,
} from "@/lib/db/commands/startFermentBatch";
import {
  logMillWater,
  type LogMillWaterResult,
  type LogMillWaterStore,
} from "@/lib/db/commands/logMillWater";
import { getSupabase } from "@/lib/supabase/server";
import { formToRecord } from "@/lib/validation/shared";

/**
 * Server Actions for the P2-S3 fermentation & wet-mill tracker (ADR-002 — Server
 * Actions are the driving port, only ever invoked by an authenticated human submitting
 * a form). Each builds the offline-ready event envelope server-side (D5: a ferment-
 * specific `device_id`, a collision-proof `device_seq`, and a stable idempotency key
 * carried from the form so a double-submit is a DB no-op) and delegates to the matching
 * command, whose single write door is the matching SECURITY DEFINER RPC. Every RPC's
 * CHECK/FK violations are translated by the command into clean, family-readable
 * messages; these actions just surface them and revalidate the affected routes.
 */

export type FermentActionState =
  | { status: "idle" }
  | { status: "success"; message: string; batchId?: string }
  | { status: "error"; message?: string; errors?: Record<string, string> };

export const FERMENT_IDLE: FermentActionState = { status: "idle" };

/** Ferment surface's offline node identity — DISTINCT from intake's `server-intake`
 *  and processing's `server-processing` so the three write surfaces never collide on
 *  the `(device_id, device_seq)` UNIQUE key in their respective ledgers. */
const FERMENT_DEVICE_ID = "server-ferment";

/**
 * Globally-unique `device_seq` source: a 48-bit value from `crypto.getRandomValues`,
 * independent across serverless instances and within both JS safe-integer range and
 * Postgres `bigint`, so a cross-instance collision is astronomically unlikely. The real
 * exactly-once anchor is `idempotency_key`; this just keeps the ledger's
 * `(device_id, device_seq)` key from tripping. A retry-safe form may pass an explicit
 * `deviceSeq` paired with its `idempotencyKey` — that wins so a replay re-uses it.
 */
function randomDeviceSeq(): number {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  return (buf[0] & 0xffff) * 0x100000000 + buf[1];
}

/** Fill the offline-ready envelope columns (occurredAt, deviceId, deviceSeq,
 *  idempotencyKey) from the form, defaulting the unrecoverable ones server-side. */
function withEnvelope(raw: Record<string, unknown>): Record<string, unknown> {
  const occurredAt =
    typeof raw.occurredAt === "string" && raw.occurredAt.trim()
      ? raw.occurredAt.trim()
      : new Date().toISOString();
  const idempotencyKey =
    typeof raw.idempotencyKey === "string" && raw.idempotencyKey.trim()
      ? raw.idempotencyKey.trim()
      : crypto.randomUUID();
  const deviceSeq =
    typeof raw.deviceSeq === "string" && raw.deviceSeq.trim()
      ? Number(raw.deviceSeq.trim())
      : randomDeviceSeq();
  return {
    ...raw,
    occurredAt,
    deviceId: FERMENT_DEVICE_ID,
    deviceSeq,
    idempotencyKey,
  };
}

function refresh() {
  revalidatePath("/ferment");
  revalidatePath("/");
}

function toState(
  result:
    | StartFermentBatchResult
    | RecordFermentReadingResult
    | LogMillWaterResult,
  successMessage: string,
): FermentActionState {
  if (result.ok) {
    return {
      status: "success",
      message: successMessage,
      batchId: "batchId" in result ? result.batchId : undefined,
    };
  }
  return { status: "error", errors: result.errors, message: result.message };
}

export async function startFermentBatchAction(
  _prev: FermentActionState,
  formData: FormData,
): Promise<FermentActionState> {
  const raw = withEnvelope(formToRecord(formData));
  const sb = await getSupabase();
  const result = await startFermentBatch(
    sb as unknown as StartFermentBatchStore,
    raw,
  );
  if (result.ok) refresh();
  return toState(result, "Ferment batch started.");
}

export async function recordFermentReadingAction(
  _prev: FermentActionState,
  formData: FormData,
): Promise<FermentActionState> {
  const raw = withEnvelope(formToRecord(formData));
  const sb = await getSupabase();
  const result = await recordFermentReading(
    sb as unknown as RecordFermentReadingStore,
    raw,
  );
  if (result.ok) refresh();
  return toState(result, "Reading logged.");
}

export async function logMillWaterAction(
  _prev: FermentActionState,
  formData: FormData,
): Promise<FermentActionState> {
  const raw = withEnvelope(formToRecord(formData));
  const sb = await getSupabase();
  const result = await logMillWater(sb as unknown as LogMillWaterStore, raw);
  if (result.ok) refresh();
  return toState(result, "Mill water logged.");
}
