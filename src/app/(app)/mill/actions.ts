"use server";

import { getTranslations } from "next-intl/server";

import { getSupabase } from "@/lib/supabase/server";

/**
 * /mill WRITE port — the readiness + open-run Server Actions (P3-S7).
 *
 * Two driving ports, both invoked only by an authenticated human submitting the
 * spec-gate form (ADR-002 / rail §7 — no untrusted inbound ever fires these). Each
 * validates the shape the DB enforces BEFORE the network hop, then appends through a
 * single SECURITY DEFINER command RPC:
 *   • record_mill_readiness — appends one moisture/aw measurement, snapshotting the
 *     upstream reposo clearance; `passed` is GENERATED in the DB (in-spec moisture +
 *     aw + rested). Append-only: a re-measure is a new row, never an edit.
 *   • open_milling_run — THE no-mill-out-of-spec gate. It RAISES (check_violation)
 *     unless a PASSING mill_readiness row exists for the lot. The button below is a
 *     UI courtesy; the database is the real wall.
 *
 * Both raise author-written, family-readable messages with clean SQLSTATEs, surfaced
 * verbatim; structural Postgres codes get canned guidance, never a raw SQLSTATE leak.
 * The idempotency_key is CLIENT-minted (rail §1) so an exactly-once retry collapses to
 * the same row.
 *
 * REVALIDATION: recording a reading / opening a run moves only the /mill board's own
 * read; it commits NO green inventory (milling consumes parchment — no lot_reservations
 * / lot_shipments row, no ATP move), so no cross-route ripple fires. The board re-reads
 * on the next navigation (the whole (app) is force-dynamic); the gate island calls
 * router.refresh() in place. WIRING SEAM (out of this slice's file scope —
 * src/lib/revalidate.ts is single-author in the Wiring pass): add a dedicated
 * "mill-update" EventKind whose RIPPLE includes /mill (+ /lots/[code]) and repoint here.
 */

export interface RecordReadinessInput {
  parchmentLotCode: string;
  moisturePct: number;
  waterActivityAw: number;
  idempotencyKey: string;
}

export interface OpenRunInput {
  parchmentLotCode: string;
  parchmentKgIn: number;
  idempotencyKey: string;
}

export type ReadinessResult =
  | { ok: true; readinessId: number }
  | { ok: false; error: string };

export type OpenRunResult =
  | { ok: true; runId: number }
  | { ok: false; error: string };

interface PgError {
  message: string;
  code?: string;
}

/**
 * Map a Postgres error to family-readable copy. Our SECURITY DEFINER guards raise
 * author-written messages with these SQLSTATEs (the no-mill-out-of-spec gate is a
 * check_violation; the immutability trigger a restrict_violation) — all safe and
 * clear, so they pass through verbatim. Structural codes get canned guidance.
 */
function friendlyError(error: PgError, generic: string): string {
  switch (error.code) {
    case "23514": // check_violation — the no-mill-out-of-spec gate message
    case "P0001": // raise_exception
    case "P0002": // no_data_found
    case "23001": // restrict_violation — append-only immutability
    case "23503": // foreign_key_violation — unknown parchment lot
      return error.message;
    case "42501": // insufficient_privilege
      return "You don't have access to run the mill.";
    case "23505": // unique_violation — idempotent replay collided
      return "That was already saved.";
    default:
      return generic;
  }
}

const isPositive = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;

const inRange = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;

export async function recordMillReadinessAction(
  input: RecordReadinessInput,
): Promise<ReadinessResult> {
  const t = await getTranslations("mill");
  if (!input.parchmentLotCode?.trim()) {
    return { ok: false, error: t("errors.lotRequired") };
  }
  // Moisture is a percentage (0-100); aw is a unit fraction (0-1). The DB CHECKs
  // mirror these; reject the obviously-impossible shape before the round-trip.
  if (!inRange(input.moisturePct, 0, 100)) {
    return { ok: false, error: t("errors.moisturePositive") };
  }
  if (!inRange(input.waterActivityAw, 0, 1)) {
    return { ok: false, error: t("errors.awPositive") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("record_mill_readiness", {
    p_parchment_lot_code: input.parchmentLotCode.trim(),
    p_moisture_pct: input.moisturePct,
    p_water_activity_aw: input.waterActivityAw,
    p_measured_at: new Date().toISOString(),
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return {
      ok: false,
      error: friendlyError(error as PgError, t("errors.generic")),
    };
  }
  return { ok: true, readinessId: Number(data) };
}

export async function openMillingRunAction(
  input: OpenRunInput,
): Promise<OpenRunResult> {
  const t = await getTranslations("mill");
  if (!input.parchmentLotCode?.trim()) {
    return { ok: false, error: t("errors.lotRequired") };
  }
  if (!isPositive(input.parchmentKgIn)) {
    return { ok: false, error: t("errors.kgPositive") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("open_milling_run", {
    p_parchment_lot_code: input.parchmentLotCode.trim(),
    p_parchment_kg_in: input.parchmentKgIn,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return {
      ok: false,
      error: friendlyError(error as PgError, t("errors.generic")),
    };
  }
  return { ok: true, runId: Number(data) };
}
