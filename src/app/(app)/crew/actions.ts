"use server";

import { reactiveRefresh } from "@/lib/revalidate";

import {
  enrollCrewMember,
  type CrewEnrollmentResult,
  type CrewEnrollmentStore,
} from "@/lib/db/commands/enrollCrewMember";
import {
  recordAttendance,
  type AttendanceResult,
  type AttendanceStore,
} from "@/lib/db/commands/recordAttendance";
import {
  recordCertification,
  type CertificationResult,
  type CertificationStore,
} from "@/lib/db/commands/recordCertification";
import {
  rehireWorker,
  type RehireResult,
  type RehireStore,
} from "@/lib/db/commands/rehireWorker";
import {
  signPorObra,
  type PorObraResult,
  type PorObraStore,
} from "@/lib/db/commands/signPorObra";
import { getSupabase } from "@/lib/supabase/server";
import { formToRecord } from "@/lib/validation/shared";
import type { CrewActionState } from "./state";

/**
 * Server Actions for the P2-S1 crew system-of-record (ADR-002 — Server Actions
 * are the driving port; only ever invoked by an authenticated human submitting a
 * form). Each action builds the offline-ready event envelope server-side (D5: a
 * synthetic `device_id:"server"` + `device_seq:0` for the device-bearing
 * commands, an `occurred_at` fallback to now, and a minted `idempotency_key` so
 * the exactly-once column is never unrecoverable) and delegates to the
 * already-tested command port, whose single write door is its SECURITY DEFINER
 * RPC. An explicit `idempotencyKey` / `occurredAt` from the form (a retry-safe
 * submit) wins when present.
 *
 * NOTE: a `"use server"` file may export ONLY async functions (Next 15) — the
 * `CrewActionState` type + `CREW_IDLE` constant live in ./state and are imported.
 */

/** Read the form value if a non-blank string, else `undefined` (for fallbacks). */
function str(raw: Record<string, unknown>, key: string): string | undefined {
  const v = raw[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** The field's value, or a freshly-minted now-ISO timestamp when absent. */
function occurredAtOrNow(raw: Record<string, unknown>): string {
  return str(raw, "occurredAt") ?? new Date().toISOString();
}

/** The field's value, or a freshly-minted uuid when absent (exactly-once key). */
function idempotencyKeyOrNew(raw: Record<string, unknown>): string {
  return str(raw, "idempotencyKey") ?? crypto.randomUUID();
}

/**
 * A UNIQUE monotonic device_seq for the single synthetic online device `"server"`.
 * The attendance/worker ledgers carry `unique (device_id, device_seq)`, so the online
 * actions must NOT hardcode a constant seq — a constant collides on the second write
 * system-wide. `next_server_seq()` is the SECURITY DEFINER draw the migration exposes;
 * it hands out a strictly-increasing seq so ('server', seq) is unique forever. (When
 * the S0 offline outbox lands, field devices mint their own (device_id, device_seq)
 * client-side and this server path becomes just one more device.)
 */
async function nextServerSeq(
  sb: { rpc(fn: "next_server_seq"): Promise<{ data: number | string | null; error: { message: string } | null }> },
): Promise<number> {
  const { data, error } = await sb.rpc("next_server_seq");
  if (error || data === null || data === undefined) {
    // Fail safe to a time-derived seq so a draw hiccup never silently reuses 0; the
    // unique key still protects correctness, and the action surfaces any real error.
    return Date.now();
  }
  return Number(data);
}

/** Map a command result that carries an event/contract/cert id onto the state. */
function toState(
  result:
    | AttendanceResult
    | CrewEnrollmentResult
    | RehireResult
    | PorObraResult
    | CertificationResult,
  successMessage: string,
): CrewActionState {
  if (result.ok) return { status: "success", message: successMessage };
  return { status: "error", errors: result.errors, message: result.message };
}

export async function recordAttendanceAction(
  formData: FormData,
): Promise<CrewActionState> {
  const raw = formToRecord(formData);

  const sb = await getSupabase();
  const result = await recordAttendance(sb as unknown as AttendanceStore, {
    ...raw,
    occurredAt: occurredAtOrNow(raw),
    deviceId: "server",
    deviceSeq: await nextServerSeq(sb as unknown as Parameters<typeof nextServerSeq>[0]),
    idempotencyKey: idempotencyKeyOrNew(raw),
  });

  if (result.ok) {
    reactiveRefresh("crew-event");
  }
  return toState(result, "Attendance recorded.");
}

export async function enrollCrewMemberAction(
  formData: FormData,
): Promise<CrewActionState> {
  const raw = formToRecord(formData);

  const sb = await getSupabase();
  const result = await enrollCrewMember(sb as unknown as CrewEnrollmentStore, {
    ...raw,
    occurredAt: occurredAtOrNow(raw),
    deviceId: "server",
    deviceSeq: await nextServerSeq(sb as unknown as Parameters<typeof nextServerSeq>[0]),
    idempotencyKey: idempotencyKeyOrNew(raw),
  });

  if (result.ok) {
    reactiveRefresh("crew-event");
  }
  return toState(result, "Worker enrolled.");
}

export async function signPorObraAction(
  formData: FormData,
): Promise<CrewActionState> {
  const raw = formToRecord(formData);

  // Por-obra contracts take NO device columns — mint only the idempotency key.
  const sb = await getSupabase();
  const result = await signPorObra(sb as unknown as PorObraStore, {
    ...raw,
    idempotencyKey: idempotencyKeyOrNew(raw),
  });

  if (result.ok) {
    reactiveRefresh("crew-event");
  }
  return toState(result, "Contract signed.");
}

export async function recordCertificationAction(
  formData: FormData,
): Promise<CrewActionState> {
  const raw = formToRecord(formData);

  // Certifications take NO device columns — mint only the idempotency key.
  const sb = await getSupabase();
  const result = await recordCertification(sb as unknown as CertificationStore, {
    ...raw,
    idempotencyKey: idempotencyKeyOrNew(raw),
  });

  if (result.ok) {
    reactiveRefresh("crew-event");
  }
  return toState(result, "Certification recorded.");
}

export async function rehireWorkerAction(
  formData: FormData,
): Promise<CrewActionState> {
  const raw = formToRecord(formData);

  const sb = await getSupabase();
  const result = await rehireWorker(sb as unknown as RehireStore, {
    ...raw,
    occurredAt: occurredAtOrNow(raw),
    deviceId: "server",
    deviceSeq: await nextServerSeq(sb as unknown as Parameters<typeof nextServerSeq>[0]),
    idempotencyKey: idempotencyKeyOrNew(raw),
  });

  if (result.ok) {
    reactiveRefresh("crew-event");
  }
  return toState(result, "Worker rehired.");
}
