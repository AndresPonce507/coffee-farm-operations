"use server";

import { getTranslations } from "next-intl/server";

import { reactiveRefresh } from "@/lib/revalidate";
import { getSupabase } from "@/lib/supabase/server";

/**
 * /mill/[runId] WRITE port — the finalize + re-grade Server Actions (P3-S9).
 *
 * Server Actions are the one driving port (rail §7 injection invariant: only ever
 * invoked by an authenticated human submitting a form — no untrusted inbound fires a
 * write). Each validates the shape the DB enforces BEFORE the network hop, then appends
 * through a single SECURITY DEFINER command RPC:
 *   • finalize_milling_run — THE keystone. Validates the CLOSED mass balance, CALLS the
 *     canonical materialize_green_lot to mint the green node via a conserved 'process'
 *     edge, posts a processing-batch cost_entry so milling cost flows into
 *     cogs_per_lot, refresh_lot_cost()s, auto-grades, appends 'mill_run_finalized'.
 *     This is the money/mass-shaped, HUMAN-CONFIRMED write (the client gates it behind
 *     an irreversible confirm dialog). The mass-balance + conservation guards live in
 *     the database; this action surfaces the author-written guard messages verbatim and
 *     maps structural Postgres errors to clean copy — never a raw SQLSTATE leak.
 *   • record_green_grade — a standalone append-only re-grade for a minted green lot.
 *
 * The idempotency_key is CLIENT-minted (rail §1) so an exactly-once retry collapses to
 * the same row. REVALIDATION: finalize mints green inventory AND posts a cost_entry +
 * refresh_lot_cost(), so it moves cost-per-kg-green, the EUDR green-lot listing, and the
 * lot dossier — exactly the existing "inventory-update" ripple (its own comment: "a grade
 * mints a green lot and refresh_lot_cost()s"). A pure re-grade moves no consumer read's
 * inventory/cost, so it busts nothing (the same posture as a 'quoted' price quote).
 */

export interface FinalizeMillingRunInput {
  runId: number;
  greenKgOut: number;
  /** null ⇒ not yet cupped; the green lot mints without an SCA band. */
  cuppingScore: number | null;
  location: string;
  cat1Defects: number;
  cat2Defects: number;
  screenSize: number | null;
  processingCostUsd: number;
  idempotencyKey: string;
}

export interface RecordGreenGradeInput {
  greenLotCode: string;
  cat1Defects: number;
  cat2Defects: number;
  screenSize: number | null;
  idempotencyKey: string;
}

export type FinalizeResult =
  | { ok: true; greenLotCode: string }
  | { ok: false; error: string };

export type GradeResult =
  | { ok: true; gradeId: number }
  | { ok: false; error: string };

interface PgError {
  message: string;
  code?: string;
}

/**
 * Map a Postgres error to family-readable copy. Our SECURITY DEFINER guards raise
 * author-written messages with these SQLSTATEs (mass-balance unbalanced, wrong-status,
 * unknown run) — all safe and clear, so they pass through verbatim. Structural codes get
 * canned guidance; nothing raw ever leaks.
 */
function friendlyError(error: PgError, generic: string): string {
  switch (error.code) {
    case "23514": // check_violation — author-written guard (unbalanced / wrong status)
    case "P0001": // raise_exception
    case "P0002": // no_data_found
    case "23503": // foreign_key_violation ("unknown milling run / green lot")
      return error.message;
    case "42501": // insufficient_privilege
      return "You don't have access to finalize this run.";
    case "23505": // unique_violation — idempotent replay collided
      return "That run was already finalized.";
    default:
      return generic;
  }
}

const isPositive = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;

const isNonNegInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0;

export async function finalizeMillingRunAction(
  input: FinalizeMillingRunInput,
): Promise<FinalizeResult> {
  const t = await getTranslations("millFinalize");

  if (!isPositive(input.greenKgOut)) {
    return { ok: false, error: t("errors.greenKgPositive") };
  }
  if (!input.location?.trim()) {
    return { ok: false, error: t("errors.locationRequired") };
  }
  if (!isNonNegInt(input.cat1Defects) || !isNonNegInt(input.cat2Defects)) {
    return { ok: false, error: t("errors.defectsInvalid") };
  }
  if (
    input.screenSize != null &&
    !(Number.isInteger(input.screenSize) && input.screenSize >= 0)
  ) {
    return { ok: false, error: t("errors.defectsInvalid") };
  }
  if (
    input.cuppingScore != null &&
    !(Number.isFinite(input.cuppingScore) && input.cuppingScore > 0)
  ) {
    return { ok: false, error: t("errors.cuppingInvalid") };
  }
  if (!(Number.isFinite(input.processingCostUsd) && input.processingCostUsd >= 0)) {
    return { ok: false, error: t("errors.costInvalid") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("finalize_milling_run", {
    p_run_id: input.runId,
    p_green_kg_out: input.greenKgOut,
    p_cupping_score: input.cuppingScore,
    p_location: input.location.trim(),
    p_cat1_defects: input.cat1Defects,
    p_cat2_defects: input.cat2Defects,
    p_screen_size: input.screenSize,
    p_processing_cost_usd: input.processingCostUsd,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return { ok: false, error: friendlyError(error as PgError, t("errors.generic")) };
  }

  // finalize minted a green lot + posted a cost_entry + refresh_lot_cost()d: green
  // inventory / cost-per-kg-green moved → fan out through the inventory ripple.
  reactiveRefresh("inventory-update");
  return { ok: true, greenLotCode: String(data) };
}

export async function recordGreenGradeAction(
  input: RecordGreenGradeInput,
): Promise<GradeResult> {
  const t = await getTranslations("millFinalize");

  if (!input.greenLotCode?.trim()) {
    return { ok: false, error: t("errors.lotRequired") };
  }
  if (!isNonNegInt(input.cat1Defects) || !isNonNegInt(input.cat2Defects)) {
    return { ok: false, error: t("errors.defectsInvalid") };
  }
  if (
    input.screenSize != null &&
    !(Number.isInteger(input.screenSize) && input.screenSize >= 0)
  ) {
    return { ok: false, error: t("errors.defectsInvalid") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("record_green_grade", {
    p_green_lot_code: input.greenLotCode.trim(),
    p_cat1_defects: input.cat1Defects,
    p_cat2_defects: input.cat2Defects,
    p_screen_size: input.screenSize,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return { ok: false, error: friendlyError(error as PgError, t("errors.generic")) };
  }

  // A pure grade append moves no consumer route's inventory/cost — nothing to bust.
  return { ok: true, gradeId: Number(data) };
}
