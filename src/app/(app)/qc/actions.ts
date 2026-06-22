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
 *
 * The two INSERT-backed paths (`placeQcHoldAction`, `recordCuppingSessionAction`)
 * also mint a synthetic server envelope server-side — a `device_id:"server"` + a
 * UNIQUE monotonic `device_seq` drawn from `next_server_seq()` + a minted
 * `idempotency_key`. Every QC table carries `unique (device_id, device_seq)`, so a
 * constant seq would collide on the SECOND online write of the season (the C1 fix
 * already shipped in crew/weigh): the hold would never land, leaving the defective
 * lot reservable/shippable. `release_qc_hold` UPDATEs (never INSERTs), so it needs
 * no draw and is intentionally left unchanged.
 */

/** Read the form value if a non-blank string, else `undefined` (for fallbacks). */
function str(raw: Record<string, unknown>, key: string): string | undefined {
  const v = raw[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** The field's value, or a freshly-minted uuid when absent (exactly-once key). */
function idempotencyKeyOrNew(raw: Record<string, unknown>): string {
  return str(raw, "idempotencyKey") ?? crypto.randomUUID();
}

/**
 * A UNIQUE monotonic device_seq for the single synthetic online device `"server"`.
 * The QC ledgers (`qc_holds`, `cupping_sessions`, `cupping_scores`) each carry
 * `unique (device_id, device_seq)`, so the online actions must NOT hardcode a
 * constant seq — a constant collides on the SECOND write system-wide and the hold
 * silently fails to record (defeating `_prevent_held_lot_commit`). `next_server_seq()`
 * is the SECURITY DEFINER draw the S1 migration exposes; it hands out a
 * strictly-increasing seq so ('server', seq) is unique forever. (When the S0 offline
 * outbox lands, field devices mint their own (device_id, device_seq) client-side and
 * this server path becomes just one more device.)
 */
async function nextServerSeq(
  sb: {
    rpc(
      fn: "next_server_seq",
    ): Promise<{ data: number | string | null; error: { message: string } | null }>;
  },
): Promise<number> {
  const { data, error } = await sb.rpc("next_server_seq");
  if (error || data === null || data === undefined) {
    // Fail safe to a time-derived seq so a draw hiccup never silently reuses 0; the
    // unique key still protects correctness, and the action surfaces any real error.
    return Date.now();
  }
  return Number(data);
}

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
  const result = await placeQcHold(sb as unknown as QcHoldStore, {
    ...raw,
    deviceId: "server",
    deviceSeq: await nextServerSeq(
      sb as unknown as Parameters<typeof nextServerSeq>[0],
    ),
    idempotencyKey: idempotencyKeyOrNew(raw),
  });
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
    {
      ...raw,
      deviceId: "server",
      deviceSeq: await nextServerSeq(
        sb as unknown as Parameters<typeof nextServerSeq>[0],
      ),
      idempotencyKey: idempotencyKeyOrNew(raw),
    },
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
    {
      ...raw,
      deviceId: "server",
      deviceSeq: await nextServerSeq(
        sb as unknown as Parameters<typeof nextServerSeq>[0],
      ),
      idempotencyKey: idempotencyKeyOrNew(raw),
    },
  );
  if (result.ok) {
    refresh();
    return { status: "success", message: "Score recorded." };
  }
  return { status: "error", errors: result.errors, message: result.message };
}
