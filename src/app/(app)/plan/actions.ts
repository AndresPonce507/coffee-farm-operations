"use server";

import { revalidatePath } from "next/cache";

import { getSupabase } from "@/lib/supabase/server";
import type { RipenessTarget } from "@/lib/types";

/**
 * P2-S8 — Harvest-planning Server Actions (the owner's WRITE seam).
 *
 * Server Actions are the driving port (ADR-002 — only ever invoked by an
 * authenticated human in the /plan UI). The write doors are the SECURITY DEFINER
 * command RPCs: `schedule_pasada` / `replan_pasada` (which both append a pasada
 * plan AND fire a task onto the real /tasks board, in one idempotent txn) and
 * `record_maturation_signal` (the only writer of plot_phenology + the append-only
 * maturation ledger). Each action mints the device_id/device_seq/idempotency_key
 * the RPC requires so every write is offline-replayable (the S0 outbox contract)
 * and exactly-once under replay, and maps raw DB rejections onto friendly,
 * SQL-free messages (the family never sees a Postgres exception).
 *
 * $0 / offline-safe: nothing here calls an external API. The GDD/readiness model
 * consumes the cached `weather` table (the same feed the dashboard reads), so the
 * "re-plan around rain" path is a pure read of in-DB data — no live Open-Meteo
 * call, no paid service. A live forecast feed is a documented LATER upgrade behind
 * this same action.
 */

export type PlanResult = { ok: true } | { ok: false; error: string };

/** A stable per-server device id for owner-driven planner writes (the field
 *  picker devices that S0 will add get their own per-install id; this is the
 *  manager's planning console). device_seq is monotonic per call via the clock. */
const PLANNER_DEVICE_ID = "planner-console";

/** Mint the offline-replay envelope every command RPC takes. */
function writeEnvelope() {
  const now = new Date();
  return {
    p_occurred_at: now.toISOString(),
    p_device_id: PLANNER_DEVICE_ID,
    // a monotonic-enough per-call seq (ms since epoch); unique per (device, seq).
    p_device_seq: now.getTime(),
    p_idempotency_key: crypto.randomUUID(),
  };
}

/** Map a raw DB/RPC error to a friendly, SQL-free sentence. */
function friendlyError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("unknown plot") || m.includes("foreign_key") || m.includes("not found")) {
    return "That plot no longer exists. Refresh the page and try again.";
  }
  if (m.includes("permission denied") || m.includes("denied")) {
    return "You're signed out. Sign in again to plan harvests.";
  }
  if (m.includes("append-only") || m.includes("supersede")) {
    return "A plan can only be re-planned with a new version — refresh and try again.";
  }
  // Never leak a raw SQL constraint string into the UI.
  return "We couldn't save that plan. Please try again.";
}

export interface SchedulePasadaInput {
  plotId: string;
  season: string;
  pasadaNumber: number;
  predictedReadyDate: string; // ISO yyyy-mm-dd
  ripenessTarget: RipenessTarget;
}

/**
 * Schedule a pasada (harvest pass) for a plot. Appends the plan AND fires a task
 * onto the real /tasks board (the RPC does both atomically), then revalidates the
 * planner so the calendar + the board re-render.
 */
export async function schedulePasada(input: SchedulePasadaInput): Promise<PlanResult> {
  const sb = await getSupabase();
  const { error } = await sb.rpc("schedule_pasada", {
    p_plot_id: input.plotId,
    p_season: input.season,
    p_pasada_number: input.pasadaNumber,
    p_predicted_ready_date: input.predictedReadyDate,
    p_predicted_ripe_pct: input.ripenessTarget,
    ...writeEnvelope(),
  });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/plan");
  revalidatePath("/tasks");
  return { ok: true };
}

export interface ReplanPasadaInput {
  plotId: string;
  season: string;
  pasadaNumber: number;
  newReadyDate: string; // ISO yyyy-mm-dd
  reason: string; // e.g. 'rain front'
}

/**
 * Re-plan a pasada around a rain front (or any shift): the RPC supersedes the
 * current active plan and appends a new version + a new task — append-only, the
 * prior plan is preserved as history.
 */
export async function replanPasada(input: ReplanPasadaInput): Promise<PlanResult> {
  const sb = await getSupabase();
  const { error } = await sb.rpc("replan_pasada", {
    p_plot_id: input.plotId,
    p_season: input.season,
    p_pasada_number: input.pasadaNumber,
    p_new_ready_date: input.newReadyDate,
    p_reason: input.reason,
    ...writeEnvelope(),
  });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/plan");
  revalidatePath("/tasks");
  return { ok: true };
}

export interface MaturationSignalInput {
  plotId: string;
  bloomDate: string | null; // ISO yyyy-mm-dd, null when not logging a bloom
  gddAccumulated: number | null; // GDD since bloom (from the cached weather feed)
  ndviLatest: number | null; // latest NDVI [0,1], null when no satellite signal
}

/**
 * Record a maturation signal (a logged bloom, a GDD update, an NDVI observation).
 * Upserts the plot's phenology + appends the append-only maturation ledger, then
 * revalidates the planner so the derived readiness re-computes.
 */
export async function recordMaturationSignal(input: MaturationSignalInput): Promise<PlanResult> {
  const sb = await getSupabase();
  const { error } = await sb.rpc("record_maturation_signal", {
    p_plot_id: input.plotId,
    p_bloom_date: input.bloomDate,
    p_gdd_accumulated: input.gddAccumulated,
    p_ndvi_latest: input.ndviLatest,
    ...writeEnvelope(),
  });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/plan");
  return { ok: true };
}
