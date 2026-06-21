"use server";

import { revalidatePath } from "next/cache";

import {
  generateDispatch,
  type GenerateDispatchResult,
  type GenerateDispatchStore,
} from "@/lib/db/commands/generateDispatch";
import {
  markDispatchSent,
  type MarkDispatchSentResult,
  type MarkDispatchSentStore,
} from "@/lib/db/commands/markDispatchSent";
import {
  recordDispatchAck,
  type RecordDispatchAckResult,
  type RecordDispatchAckStore,
} from "@/lib/db/commands/recordDispatchAck";
import { getSupabase } from "@/lib/supabase/server";
import { formToRecord } from "@/lib/validation/shared";
import type { DispatchChannel } from "@/lib/types";
import { DISPATCH_IDLE, type DispatchActionState } from "./state";

/**
 * P2-S5 — Morning crew dispatch Server Actions (the owner's WRITE seam).
 *
 * Server Actions are the driving port (ADR-002 — only ever invoked by an
 * authenticated human in the /dispatch UI). The write doors are the SECURITY
 * DEFINER command RPCs behind the already-tested command ports:
 *   • generate_dispatch  — reads the S8 ripeness model + S1 crews → drafts a
 *     per-crew run + assignments (NEVER auto-sends; the run starts 'draft').
 *   • mark_dispatch_sent — the OWNER-INITIATED OUTBOUND transition (draft → sent),
 *     enqueuing the $0 web-share delivery. Owner acts; nothing auto-sends.
 *   • record_dispatch_ack — 🚨 the INJECTION-SAFE inbound writer: it records that
 *     a crew lead saw the dispatch as EVIDENCE ONLY. It can never advance a run,
 *     fire a task, or drive any action — untrusted inbound text is never a
 *     puppeteer (the global no-untrusted-text-drives-action invariant, in code).
 *
 * Each action mints the offline-replay envelope (device_id/device_seq/
 * idempotency_key) the RPCs require so every write is exactly-once under replay
 * and offline-replayable through the S0 outbox, and maps raw DB rejections onto
 * friendly, SQL-free messages (the family never sees a Postgres exception).
 *
 * $0: the delivery leg is the web-share adapter (the device's native share sheet
 * into WhatsApp, manually) — no paid API. The WhatsApp Cloud channel is a dormant,
 * flagged drop-in; an action never selects it unless explicitly enabled.
 */

/** A stable per-server device id for owner-driven dispatch writes (the manager's
 *  morning console). Field devices that S0 adds get their own per-install id. */
const DISPATCH_DEVICE_ID = "dispatch-console";

/** Read the form value if a non-blank string, else undefined (for fallbacks). */
function str(raw: Record<string, unknown>, key: string): string | undefined {
  const v = raw[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function occurredAtOrNow(raw: Record<string, unknown>): string {
  return str(raw, "occurredAt") ?? new Date().toISOString();
}

function idempotencyKeyOrNew(raw: Record<string, unknown>): string {
  return str(raw, "idempotencyKey") ?? crypto.randomUUID();
}

/** A monotonic-enough per-call seq (ms since epoch); unique per (device, seq). */
function deviceSeq(): number {
  return Date.now();
}

/** Map a raw DB/RPC error string to a friendly, SQL-free sentence. */
function friendlyError(message: string | undefined): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("unknown crew") || m.includes("unknown dispatch") || m.includes("foreign_key")) {
    return "That crew or dispatch no longer exists. Refresh the page and try again.";
  }
  if (m.includes("permission denied") || m.includes("denied")) {
    return "You're signed out. Sign in again to dispatch the crew.";
  }
  if (m.includes("append-only") || m.includes("supersede") || m.includes("lifecycle")) {
    return "A dispatch can only be re-planned with a new version — refresh and try again.";
  }
  return "We couldn't save that dispatch. Please try again.";
}

function toErrorState(
  result:
    | GenerateDispatchResult
    | MarkDispatchSentResult
    | RecordDispatchAckResult,
): DispatchActionState {
  if (result.ok) return DISPATCH_IDLE; // never called on ok
  if (result.errors) return { status: "error", errors: result.errors };
  return { status: "error", message: friendlyError(result.message) };
}

/**
 * Generate (or re-generate) the morning dispatch for a crew. Reads the S8 ripeness
 * model + S1 crews and drafts the run + per-plot assignments. NEVER auto-sends.
 */
export async function generateDispatchAction(
  formData: FormData,
): Promise<DispatchActionState> {
  const raw = formToRecord(formData);

  const sb = await getSupabase();
  const result = await generateDispatch(sb as unknown as GenerateDispatchStore, {
    ...raw,
    occurredAt: occurredAtOrNow(raw),
    deviceId: DISPATCH_DEVICE_ID,
    deviceSeq: deviceSeq(),
    idempotencyKey: idempotencyKeyOrNew(raw),
  });

  if (result.ok) {
    revalidatePath("/dispatch");
    return { status: "success", message: "Dispatch drafted.", runId: result.runId };
  }
  return toErrorState(result);
}

/**
 * Mark a dispatch as sent — the deliberate owner-initiated outbound action that the
 * "share" button fires after the manager shares the card (web-share by default).
 */
export async function markDispatchSentAction(
  formData: FormData,
): Promise<DispatchActionState> {
  const raw = formToRecord(formData);

  // Default to the $0 web-share channel; the paid WhatsApp Cloud channel is only
  // ever chosen when explicitly enabled (it is dormant by default).
  const channel = (str(raw, "channel") ?? "web-share") as DispatchChannel;

  const sb = await getSupabase();
  const result = await markDispatchSent(sb as unknown as MarkDispatchSentStore, {
    ...raw,
    channel,
    occurredAt: occurredAtOrNow(raw),
    deviceId: DISPATCH_DEVICE_ID,
    deviceSeq: deviceSeq(),
    idempotencyKey: idempotencyKeyOrNew(raw),
  });

  if (result.ok) {
    revalidatePath("/dispatch");
    return { status: "success", message: "Dispatch shared.", runId: result.runId };
  }
  return toErrorState(result);
}

/**
 * 🚨 INJECTION-SAFE inbound recorder. Records that a crew lead acknowledged the
 * dispatch as EVIDENCE ONLY — it cannot advance the run, fire a task, or drive any
 * action. The manager acts; an inbound reply is never an automated trigger.
 */
export async function recordDispatchAckAction(
  formData: FormData,
): Promise<DispatchActionState> {
  const raw = formToRecord(formData);

  const sb = await getSupabase();
  const result = await recordDispatchAck(sb as unknown as RecordDispatchAckStore, {
    ...raw,
    occurredAt: occurredAtOrNow(raw),
    deviceId: DISPATCH_DEVICE_ID,
    deviceSeq: deviceSeq(),
    idempotencyKey: idempotencyKeyOrNew(raw),
  });

  if (result.ok) {
    revalidatePath("/dispatch");
    return { status: "success", message: "Acknowledgement recorded." };
  }
  return toErrorState(result);
}
