"use server";

import { revalidatePath } from "next/cache";

import {
  placeQcHold,
  releaseQcHold,
  type QcHoldResult,
  type QcHoldStore,
} from "@/lib/db/commands/placeQcHold";
import {
  recordCuppingSession,
  type CuppingSessionResult,
  type CuppingSessionStore,
} from "@/lib/db/commands/recordCuppingSession";
import {
  recordCupScore,
  type CupScoreResult,
  type CupScoreStore,
} from "@/lib/db/commands/recordCupScore";
import { getSupabase } from "@/lib/supabase/server";
import { formToRecord } from "@/lib/validation/shared";

/**
 * Server Actions for the QC & cupping surface (P2-S6; ADR-002 — Server Actions are
 * the driving port, only ever invoked by an authenticated human submitting a form).
 * Four intents, each delegating to a pure command whose single write door is a
 * SECURITY DEFINER RPC:
 *
 *  - `placeQcHoldAction` / `releaseQcHoldAction` — the cup-protection TEETH. A held
 *    lot cannot be reserved/shipped (the `_prevent_held_lot_commit` DB trigger fails
 *    closed); these actions open/close the hold.
 *  - `recordCuppingSessionAction` — open a cupping session (SCA CVA / legacy 100-pt).
 *  - `recordCupScoreAction` — append one immutable attribute score to a session.
 *
 * Each builds the offline-ready `occurredAt` server-side (D5) and surfaces a clean
 * form state — never a raw Postgres exception — to the family.
 */

export type QcActionState =
  | { status: "idle" }
  | { status: "success"; message: string; sessionId?: number }
  | { status: "error"; message?: string; errors?: Record<string, string> };

export const QC_IDLE: QcActionState = { status: "idle" };

function refresh() {
  revalidatePath("/qc");
  revalidatePath("/inventory");
  revalidatePath("/");
}

function holdToState(result: QcHoldResult, ok: string): QcActionState {
  if (result.ok) return { status: "success", message: ok };
  return { status: "error", errors: result.errors, message: result.message };
}

export async function placeQcHoldAction(
  _prev: QcActionState,
  formData: FormData,
): Promise<QcActionState> {
  const raw = formToRecord(formData);
  const sb = await getSupabase();
  const result = await placeQcHold(sb as unknown as QcHoldStore, raw);
  if (result.ok) refresh();
  return holdToState(result, "QC-hold placed — this lot is now un-sellable.");
}

export async function releaseQcHoldAction(
  _prev: QcActionState,
  formData: FormData,
): Promise<QcActionState> {
  const raw = formToRecord(formData);
  const sb = await getSupabase();
  const result = await releaseQcHold(sb as unknown as QcHoldStore, raw);
  if (result.ok) refresh();
  return holdToState(result, "QC-hold released — this lot can be sold again.");
}

export async function recordCuppingSessionAction(
  _prev: QcActionState,
  formData: FormData,
): Promise<QcActionState> {
  const raw = formToRecord(formData);
  const sb = await getSupabase();
  const result: CuppingSessionResult = await recordCuppingSession(
    sb as unknown as CuppingSessionStore,
    raw,
  );
  if (result.ok) {
    refresh();
    return {
      status: "success",
      message: "Cupping session opened.",
      sessionId: result.sessionId,
    };
  }
  return { status: "error", errors: result.errors, message: result.message };
}

export async function recordCupScoreAction(
  _prev: QcActionState,
  formData: FormData,
): Promise<QcActionState> {
  const raw = formToRecord(formData);
  const sb = await getSupabase();
  const result: CupScoreResult = await recordCupScore(
    sb as unknown as CupScoreStore,
    raw,
  );
  if (result.ok) {
    refresh();
    return { status: "success", message: "Score recorded." };
  }
  return { status: "error", errors: result.errors, message: result.message };
}
