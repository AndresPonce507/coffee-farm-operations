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

// The offline node identity for the cherry-intake surface. Distinct from the
// PROCESS-ADVANCE surface's `"server"` id (HIGH review finding): both write
// `lot_event` rows keyed on the `(device_id, device_seq)` UNIQUE pair, so a
// SHARED device_id would needlessly widen the collision surface between the two
// surfaces. Each surface carries its own id, so their sequence spaces are
// independent.
const INTAKE_DEVICE_ID = "server-intake";

// Globally-unique `device_seq` source. A per-PROCESS monotonic cursor (the old
// approach) restarts at every serverless cold start — each instance seeds from
// epoch-ms, so two instances can mint the SAME small sequence and collide on
// `lot_event`'s `(device_id, device_seq)` UNIQUE key (HIGH review finding). A
// 48-bit value drawn from `crypto.getRandomValues` is independent across
// instances and well within both JS safe-integer range (2^48 ≪ 2^53) and
// Postgres `bigint`, so a cross-instance collision is astronomically unlikely.
// The real exactly-once anchor is still `idempotency_key`; this just keeps the
// event-spine key from tripping. A retry-safe form may pass an explicit
// `deviceSeq` (paired with its `idempotencyKey`) — that wins so a replay
// re-uses the same sequence.
function randomDeviceSeq(): number {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  // 48 bits: high 16 bits from buf[0], low 32 bits from buf[1].
  return (buf[0] & 0xffff) * 0x100000000 + buf[1];
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

  // HIGH review finding: a per-PROCESS monotonic cursor collides across
  // serverless instances (each cold start restarts it). Mint a globally-unique
  // sequence per submit (`randomDeviceSeq`) so the event-spine
  // `(device_id, device_seq)` key never trips. A retry-safe form may pass an
  // explicit `deviceSeq` (paired with its `idempotencyKey`) — that wins so a
  // replay re-uses the same sequence.
  const deviceSeq =
    typeof raw.deviceSeq === "string" && raw.deviceSeq.trim()
      ? Number(raw.deviceSeq.trim())
      : randomDeviceSeq();

  const sb = await getSupabase();
  const result = await recordCherryIntake(sb as unknown as CherryIntakeStore, {
    ...raw,
    occurredAt,
    deviceId: INTAKE_DEVICE_ID,
    deviceSeq,
    idempotencyKey,
  });

  if (result.ok) refresh();
  return toState(result);
}
