"use server";

import { getTranslations } from "next-intl/server";

import { getSupabase } from "@/lib/supabase/server";
import type { ByproductKind, MachineKind } from "./data";

/**
 * /mill/[runId]/balance WRITE port — the two append-only Server Actions the
 * mass-balance workspace drives (P3-S8). Server Actions are the one driving port
 * (ADR-002: only ever invoked by an authenticated human submitting a form — the
 * injection invariant, rail §7; no untrusted inbound ever fires these).
 *
 * Each validates the shape the DB enforces BEFORE the network hop, then appends
 * through a single SECURITY DEFINER command RPC:
 *   • record_mill_pass — one machine pass. The per-pass mass CHECK (output+reject ≤
 *     input) lives on the table; the in-RPC half is the cross-pass continuity guard.
 *     We mirror the table CHECK here so a doomed pass never makes the round-trip.
 *   • record_mill_byproduct — mints a fresh sellable, traceable byproduct lots node +
 *     a conserved 'byproduct' lot_edge. The EXISTING lot_edges_conserve_mass() trigger
 *     rejects routing more than the parchment holds — the money/mass guarantee REUSED,
 *     never a parallel counter.
 *
 * The continuity / run-not-open / oversell guards all live in the database; these
 * actions surface the author-written guard messages verbatim (they are family-
 * readable) and map structural Postgres codes to clean copy — never a raw SQLSTATE
 * leak. The idempotency_key is CLIENT-minted (rail §1) so an exactly-once retry
 * collapses to the same row.
 *
 * REVALIDATION / WIRING SEAM: recording a pass moves only THIS run's derived
 * mass-balance readout (no consumer-route read elsewhere), and a byproduct mint moves
 * the lot graph / green inventory (a new BYP lots node + the parchment draw). The
 * reactive-refresh SSOT (src/lib/revalidate.ts) has no milling EventKind yet, and that
 * shared contract file is single-author (the Wiring pass). So these actions
 * intentionally bust nothing here; the client island calls router.refresh() for
 * in-place freshness. Wiring should add a "milling"/"byproduct" EventKind whose RIPPLE
 * includes /mill/[runId]/balance + /lots + /inventory + /costing, register this file in
 * the guard's KIND_TO_ACTION_FILES, and repoint these calls.
 */

export interface RecordMillPassInput {
  runId: number;
  passNo: number;
  machineKind: MachineKind;
  inputKg: number;
  outputKg: number;
  rejectKg: number;
  idempotencyKey: string;
}

export interface RecordMillByproductInput {
  runId: number;
  kind: ByproductKind;
  kg: number;
  idempotencyKey: string;
}

export type MillPassResult =
  | { ok: true; passId: number }
  | { ok: false; error: string };

export type MillByproductResult =
  | { ok: true; byproductLotCode: string }
  | { ok: false; error: string };

interface PgError {
  message: string;
  code?: string;
}

const MACHINE_KINDS: readonly MachineKind[] = [
  "huller",
  "polisher",
  "screen_grader",
  "gravity_table",
  "optical_sorter",
];
const BYPRODUCT_KINDS: readonly ByproductKind[] = [
  "husk",
  "chaff",
  "screen_rejects",
  "defects",
];

const EPS = 1e-9;
const isPositive = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;
const isNonNeg = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;

/**
 * Map a Postgres error to family-readable copy. Our SECURITY DEFINER guards raise
 * author-written messages with these SQLSTATEs (continuity broken, run-not-open,
 * the per-pass mass CHECK, the lot_edges conservation trigger) — all safe and clear,
 * so they pass through verbatim. Structural codes get canned guidance; nothing raw
 * ever leaks.
 */
function friendlyError(error: PgError, generic: string): string {
  switch (error.code) {
    case "23514": // check_violation — author-written guard messages
    case "P0001": // raise_exception
    case "P0002": // no_data_found
    case "23503": // foreign_key_violation ("unknown milling run")
      return error.message;
    case "42501": // insufficient_privilege
      return "You don't have access to record this milling step.";
    case "23505": // unique_violation — idempotent replay collided
      return "That milling step was already recorded.";
    default:
      return generic;
  }
}

export async function recordMillPassAction(
  input: RecordMillPassInput,
): Promise<MillPassResult> {
  const t = await getTranslations("millBalance");

  if (!Number.isInteger(input.runId) || input.runId <= 0) {
    return { ok: false, error: t("errors.generic") };
  }
  if (!Number.isInteger(input.passNo) || input.passNo < 1) {
    return { ok: false, error: t("errors.passNo") };
  }
  if (!MACHINE_KINDS.includes(input.machineKind)) {
    return { ok: false, error: t("errors.machine") };
  }
  if (!isPositive(input.inputKg)) {
    return { ok: false, error: t("errors.inputPositive") };
  }
  if (!isNonNeg(input.outputKg)) {
    return { ok: false, error: t("errors.outputNonNeg") };
  }
  if (!isNonNeg(input.rejectKg)) {
    return { ok: false, error: t("errors.rejectNonNeg") };
  }
  // mirror the per-pass mass CHECK: a single machine can't emit more than it took.
  if (input.outputKg + input.rejectKg > input.inputKg + EPS) {
    return { ok: false, error: t("errors.massBalance") };
  }
  if (!input.idempotencyKey?.trim()) {
    return { ok: false, error: t("errors.generic") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("record_mill_pass", {
    p_run_id: input.runId,
    p_pass_no: input.passNo,
    p_machine_kind: input.machineKind,
    p_input_kg: input.inputKg,
    p_output_kg: input.outputKg,
    p_reject_kg: input.rejectKg,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return { ok: false, error: friendlyError(error as PgError, t("errors.generic")) };
  }
  return { ok: true, passId: Number(data) };
}

export async function recordMillByproductAction(
  input: RecordMillByproductInput,
): Promise<MillByproductResult> {
  const t = await getTranslations("millBalance");

  if (!Number.isInteger(input.runId) || input.runId <= 0) {
    return { ok: false, error: t("errors.generic") };
  }
  if (!BYPRODUCT_KINDS.includes(input.kind)) {
    return { ok: false, error: t("errors.kind") };
  }
  if (!isPositive(input.kg)) {
    return { ok: false, error: t("errors.kgPositive") };
  }
  if (!input.idempotencyKey?.trim()) {
    return { ok: false, error: t("errors.generic") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("record_mill_byproduct", {
    p_run_id: input.runId,
    p_kind: input.kind,
    p_kg: input.kg,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return { ok: false, error: friendlyError(error as PgError, t("errors.generic")) };
  }
  return { ok: true, byproductLotCode: String(data) };
}
