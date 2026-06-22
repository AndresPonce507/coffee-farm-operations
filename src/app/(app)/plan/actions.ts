"use server";

import { revalidatePath } from "next/cache";

import { getSupabase } from "@/lib/supabase/server";
import { isISODate } from "@/lib/validation/shared";
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
 * $0 / offline-safe: nothing here calls an external API. The readiness model reads
 * only in-DB phenology inputs written via `record_maturation_signal`; `gddAccumulated`
 * is a RECORDED signal, not yet auto-derived from the cached `weather` table. An
 * automatic weather→GDD feeder (a dated daily-temp series + an accumulation job that
 * writes plot_phenology) is the documented LATER upgrade — until then the "re-plan
 * around rain" path is a pure read of in-DB data, no live Open-Meteo call, no paid
 * service.
 */

export type PlanResult = { ok: true } | { ok: false; error: string };

/** A stable per-server device id for owner-driven planner writes (the field
 *  picker devices that S0 will add get their own per-install id; this is the
 *  manager's planning console). */
const PLANNER_DEVICE_ID = "planner-console";

/**
 * Mint the offline-replay envelope every command RPC takes.
 *
 * device_seq is drawn from the SECURITY DEFINER `next_server_seq()` sequence (the
 * same monotonic source the crew slice uses), NOT from `now.getTime()`. The planner
 * shares a single device_id, and pasada_schedule / maturation_signal both carry
 * `unique (device_id, device_seq)`; two writes landing in the same millisecond (a
 * double-click submit, two back-to-back schedules, or two concurrent serverless
 * instances seeded from the clock) would mint the SAME (device_id, device_seq) and
 * the second would hard-fail on the unique key — the exact collision the crew and
 * harvests slices already fixed. A strictly-increasing server sequence makes
 * ('planner-console', seq) unique forever; idempotency_key stays the exactly-once
 * anchor.
 */
async function writeEnvelope(
  sb: Awaited<ReturnType<typeof getSupabase>>,
): Promise<{
  p_occurred_at: string;
  p_device_id: string;
  p_device_seq: number;
  p_idempotency_key: string;
}> {
  const now = new Date();
  const { data, error } = await sb.rpc("next_server_seq");
  // Fail safe to a time-derived seq so a draw hiccup never silently reuses a value;
  // the unique key still protects correctness and any real error still surfaces below.
  const seq =
    error || data === null || data === undefined ? now.getTime() : Number(data);
  return {
    p_occurred_at: now.toISOString(),
    p_device_id: PLANNER_DEVICE_ID,
    p_device_seq: seq,
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
  if (m.includes("duplicate key") || m.includes("device_id_device_seq")) {
    // a same-instant collision on the offline-replay seq — retryable, not the user's fault.
    return "Two plans were saved at once. Please try again.";
  }
  if (m.includes("check constraint") || m.includes("violates check")) {
    // a DB-layer range/enum backstop fired — surface the likely cause, not the raw SQL.
    return "Those values are out of range — check the GDD, NDVI (0–1), or ripeness band and try again.";
  }
  // Never leak a raw SQL constraint string into the UI.
  return "We couldn't save that plan. Please try again.";
}

const RIPENESS_BANDS: readonly RipenessTarget[] = ["low", "medium", "high"];

/**
 * Validate a planner command's args BEFORE the round-trip (mirrors the sibling
 * command ports, e.g. advanceProcessingStage). The DB CHECK constraints are the real
 * enforcement and stay as the backstop; this returns an actionable, field-keyed
 * message so a bad value never reaches the RPC and falls through to a generic,
 * falsely-retryable error. Returns null when the input is valid.
 */
function validate(checks: Array<[boolean, string]>): string | null {
  for (const [ok, message] of checks) {
    if (!ok) return message;
  }
  return null;
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
  const invalid = validate([
    [input.plotId.trim().length > 0, "Choose a plot to schedule."],
    [input.season.trim().length > 0, "A season is required."],
    [
      Number.isInteger(input.pasadaNumber) && input.pasadaNumber >= 1,
      "The pasada number must be 1 or more.",
    ],
    [isISODate(input.predictedReadyDate), "Choose a valid predicted ready date."],
    [
      RIPENESS_BANDS.includes(input.ripenessTarget),
      "Choose a ripeness band (low, medium, or high).",
    ],
  ]);
  if (invalid) return { ok: false, error: invalid };

  const sb = await getSupabase();
  const { error } = await sb.rpc("schedule_pasada", {
    p_plot_id: input.plotId,
    p_season: input.season,
    p_pasada_number: input.pasadaNumber,
    p_predicted_ready_date: input.predictedReadyDate,
    p_predicted_ripe_pct: input.ripenessTarget,
    ...(await writeEnvelope(sb)),
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
  const invalid = validate([
    [input.plotId.trim().length > 0, "Choose a plot to re-plan."],
    [input.season.trim().length > 0, "A season is required."],
    [
      Number.isInteger(input.pasadaNumber) && input.pasadaNumber >= 1,
      "The pasada number must be 1 or more.",
    ],
    [isISODate(input.newReadyDate), "Choose a valid new ready date."],
    [input.reason.trim().length > 0, "Add a short reason (e.g. 'rain front')."],
  ]);
  if (invalid) return { ok: false, error: invalid };

  const sb = await getSupabase();
  const { error } = await sb.rpc("replan_pasada", {
    p_plot_id: input.plotId,
    p_season: input.season,
    p_pasada_number: input.pasadaNumber,
    p_new_ready_date: input.newReadyDate,
    p_reason: input.reason,
    ...(await writeEnvelope(sb)),
  });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/plan");
  revalidatePath("/tasks");
  return { ok: true };
}

export interface MaturationSignalInput {
  plotId: string;
  bloomDate: string | null; // ISO yyyy-mm-dd, null when not logging a bloom
  gddAccumulated: number | null; // recorded GDD-since-bloom signal (auto-feed from weather is a later upgrade)
  ndviLatest: number | null; // latest NDVI [0,1], null when no satellite signal
}

/**
 * Record a maturation signal (a logged bloom, a GDD update, an NDVI observation).
 * Upserts the plot's phenology + appends the append-only maturation ledger, then
 * revalidates the planner so the derived readiness re-computes.
 */
export async function recordMaturationSignal(input: MaturationSignalInput): Promise<PlanResult> {
  const invalid = validate([
    [input.plotId.trim().length > 0, "Choose a plot."],
    [
      input.bloomDate === null || isISODate(input.bloomDate),
      "The bloom date must be a valid date.",
    ],
    [
      input.gddAccumulated === null ||
        (Number.isFinite(input.gddAccumulated) && input.gddAccumulated >= 0),
      "GDD must be zero or more.",
    ],
    [
      input.ndviLatest === null ||
        (Number.isFinite(input.ndviLatest) &&
          input.ndviLatest >= 0 &&
          input.ndviLatest <= 1),
      "NDVI must be between 0 and 1.",
    ],
    [
      input.bloomDate !== null ||
        input.gddAccumulated !== null ||
        input.ndviLatest !== null,
      "Log at least one signal — a bloom date, GDD, or NDVI.",
    ],
  ]);
  if (invalid) return { ok: false, error: invalid };

  const sb = await getSupabase();
  const { error } = await sb.rpc("record_maturation_signal", {
    p_plot_id: input.plotId,
    p_bloom_date: input.bloomDate,
    p_gdd_accumulated: input.gddAccumulated,
    p_ndvi_latest: input.ndviLatest,
    ...(await writeEnvelope(sb)),
  });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/plan");
  return { ok: true };
}
