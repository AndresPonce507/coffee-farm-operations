"use server";

import { revalidatePath } from "next/cache";

import {
  assignStation,
  type AssignStationResult,
  type AssignStationStore,
} from "@/lib/db/commands/assignStation";
import {
  recordMoisture,
  type RecordMoistureResult,
  type RecordMoistureStore,
} from "@/lib/db/commands/recordMoisture";
import { getSupabase } from "@/lib/supabase/server";
import { formToRecord } from "@/lib/validation/shared";

/**
 * Server Actions for the DRYING surface (P2-S4) — the two writes that feed THE
 * REPOSO GATE from the running app. Until these existed, the gate's evidence
 * (`moisture_readings`) and a lot's bed (`drying_assignments`) could never be
 * created through the UI, so the resting board was a read-only dashboard over data
 * the family could not author. (Review finding #54.)
 *
 * ADR-002 — Server Actions are the driving port, only ever invoked by an
 * authenticated human submitting a form. Each action builds the offline-ready
 * event envelope server-side (D5: a drying-specific `device_id`, dual clocks, a
 * collision-proof `device_seq`, and a STABLE idempotency key carried from the form
 * so a double-submit is a DB no-op) and delegates to the matching command, whose
 * single write door is a hardened SECURITY DEFINER RPC (`record_moisture_reading`
 * / `assign_drying_station`). The RPCs' known failures (out-of-range pct, a full
 * station via `prevent_overcapacity`, a missing lot/station) are translated by the
 * commands into clean, family-readable messages; these actions just surface them
 * so the family never sees a raw Postgres exception.
 *
 * A successful write revalidates `/drying` (the resting board), `/processing` (the
 * pipeline the gate guards — a fresh in-band reading can flip a lot to "clear to
 * mill") and `/` (the dashboard's pipeline metrics).
 */

export type DryingActionState =
  | { status: "idle" }
  | { status: "success"; message: string; lotCode?: string }
  | { status: "error"; message?: string; errors?: Record<string, string> };

export const DRYING_IDLE: DryingActionState = { status: "idle" };

/**
 * Offline node identity for the drying surface — DISTINCT from intake's
 * `"server-intake"` and processing's `"server-processing"` so the three write
 * surfaces can never collide on the `lot_event (device_id, device_seq)` unique key.
 */
const DRYING_DEVICE_ID = "server-drying";

/**
 * A strictly-increasing per-call `device_seq` (the Lamport column). `Date.now()`
 * alone collides on two writes within the same millisecond, breaking the
 * `lot_event (device_id, device_seq)` unique key; a process-monotonic counter
 * folded onto a ms time-base makes every call's seq distinct while staying a
 * non-negative SAFE integer. (The real exactly-once anchor is the idempotency
 * key; this column just has to be unique-per-event.) Mirrors processing/actions.ts.
 */
let dryingSeqCounter = 0;
const DRYING_SEQ_BASE = Date.now() * 1000;
function nextDeviceSeq(): number {
  return DRYING_SEQ_BASE + dryingSeqCounter++;
}

function refresh() {
  revalidatePath("/drying");
  revalidatePath("/processing");
  revalidatePath("/");
}

/** A field wall-clock from the form, or now() when the form omits it. */
function resolveOccurredAt(raw: Record<string, unknown>): string {
  return typeof raw.occurredAt === "string" && raw.occurredAt.trim()
    ? raw.occurredAt.trim()
    : new Date().toISOString();
}

/** A STABLE form-carried idempotency key (double-submit dedupes), or a fresh one. */
function resolveIdempotencyKey(raw: Record<string, unknown>): string {
  return typeof raw.idempotencyKey === "string" && raw.idempotencyKey.trim()
    ? raw.idempotencyKey.trim()
    : crypto.randomUUID();
}

function toState(
  result: RecordMoistureResult | AssignStationResult,
  successMessage: string,
  lotCode: string,
): DryingActionState {
  if (result.ok) {
    return { status: "success", message: successMessage, lotCode };
  }
  return { status: "error", errors: result.errors, message: result.message };
}

/**
 * Append a moisture reading to a lot's drying curve — the EVIDENCE the reposo gate
 * reads. Idempotent on the form's `idempotencyKey` (a replay is a DB no-op).
 */
export async function recordMoistureAction(
  _prev: DryingActionState,
  formData: FormData,
): Promise<DryingActionState> {
  const raw = formToRecord(formData);

  const sb = await getSupabase();
  const result = await recordMoisture(sb as unknown as RecordMoistureStore, {
    ...raw,
    occurredAt: resolveOccurredAt(raw),
    deviceId: DRYING_DEVICE_ID,
    deviceSeq: nextDeviceSeq(),
    idempotencyKey: resolveIdempotencyKey(raw),
  });

  if (result.ok) refresh();
  const lotCode = typeof raw.lotCode === "string" ? raw.lotCode.trim() : "";
  return toState(result, `Reading recorded for ${lotCode}.`, lotCode);
}

/**
 * Commit a drying lot to a station bed — closes any prior open assignment and
 * opens a new one, fail-closed against `prevent_overcapacity`.
 */
export async function assignStationAction(
  _prev: DryingActionState,
  formData: FormData,
): Promise<DryingActionState> {
  const raw = formToRecord(formData);

  const sb = await getSupabase();
  const result = await assignStation(sb as unknown as AssignStationStore, {
    ...raw,
    occurredAt: resolveOccurredAt(raw),
  });

  if (result.ok) refresh();
  const lotCode = typeof raw.lotCode === "string" ? raw.lotCode.trim() : "";
  return toState(result, `Lot ${lotCode} assigned to its station.`, lotCode);
}
