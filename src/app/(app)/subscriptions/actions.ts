"use server";

import { getTranslations } from "next-intl/server";

import { reactiveRefresh } from "@/lib/revalidate";
import { getSupabase } from "@/lib/supabase/server";

/**
 * /subscriptions WRITE port — the Reserve Club lifecycle Server Actions (P3-S12).
 *
 * Server Actions are the one driving port (the injection invariant, rail §7: only an
 * authenticated human submitting a form ever invokes them — no untrusted inbound fires
 * a write). Each validates the shape the DB enforces BEFORE the network hop, then
 * appends through a single SECURITY DEFINER command RPC:
 *   • allocate_subscription_cycle — THE money-shaped, human-confirmed write. It inserts
 *     a lot_reservations row so the EXISTING prevent_oversell trigger fires (a scarce
 *     micro-lot can never be promised to more subscribers than kg exist). REUSED, not
 *     rebuilt — no parallel counter (rail §4). An oversell rolls the whole txn back.
 *   • pause / resume / cancel / skip_cycle — lifecycle transitions, each appends a
 *     sub_event. They move NO shared green-inventory read, so they bust nothing
 *     server-side; the board re-reads on the island's router.refresh().
 *   • record_dunning_event — a failed-payment follow-up; a 'final' stage marks the
 *     subscription past_due (the DB does that, not the UI).
 *
 * Author-written guard messages (oversell, unknown subscription/sku, bad kg) are
 * family-readable and pass through verbatim; structural Postgres errors map to clean
 * copy — never a raw SQLSTATE leak. The idempotency_key is CLIENT-minted (rail §1).
 *
 * REVALIDATION: only an allocation commits a lot_reservations row (green inventory /
 * ATP moves), so ONLY it fans out through reactiveRefresh, the RIPPLE SSOT (never a
 * hand-rolled revalidatePath — the ripple-actions-wired guard). Wiring may later add a
 * dedicated "subscription-allocated" EventKind; until then it rides "inventory-update"
 * (ATP is green inventory). That seam lives in src/lib/revalidate.ts, a shared contract
 * file edited single-author in the Wiring pass — out of this slice's file scope.
 */

export interface AllocateCycleInput {
  subscriptionId: number;
  greenLotCode: string;
  kg: number;
  cycleLabel: string;
  idempotencyKey: string;
}

export interface LifecycleInput {
  subscriptionId: number;
  idempotencyKey: string;
}

export interface SkipCycleInput {
  subscriptionId: number;
  cycleLabel: string;
  idempotencyKey: string;
}

export type DunningStage = "soft" | "reminder" | "final";

export interface DunningInput {
  subscriptionId: number;
  stage: DunningStage;
  idempotencyKey: string;
}

export type AllocateResult =
  | { ok: true; allocationId: number }
  | { ok: false; error: string };

export type LifecycleResult =
  | { ok: true; subscriptionId: number }
  | { ok: false; error: string };

export type DunningResult =
  | { ok: true; eventId: number }
  | { ok: false; error: string };

interface PgError {
  message: string;
  code?: string;
}

/**
 * Map a Postgres error to family-readable copy. The P3-S12 SECURITY DEFINER guards
 * raise author-written messages with these SQLSTATEs (oversell on an allocation,
 * unknown subscription/sku, bad kg) — all safe and clear, so they pass through
 * verbatim. Structural codes get canned guidance; nothing raw ever leaks.
 */
function friendlyError(error: PgError, generic: string): string {
  switch (error.code) {
    case "23514": // check_violation — author-written guard messages (oversell, kg)
    case "P0001": // raise_exception
    case "P0002": // no_data_found
    case "23503": // foreign_key_violation ("unknown subscription / sku / green lot")
      return error.message;
    case "42501": // insufficient_privilege
      return "You don't have access to manage this subscription.";
    case "23505": // unique_violation — idempotent replay collided
      return "That change was already saved.";
    default:
      return generic;
  }
}

const isPositive = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;
const isId = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) > 0;

export async function allocateSubscriptionCycleAction(
  input: AllocateCycleInput,
): Promise<AllocateResult> {
  const t = await getTranslations("subscriptions");
  if (!isId(input.subscriptionId)) {
    return { ok: false, error: t("errors.subRequired") };
  }
  if (!isPositive(input.kg)) {
    return { ok: false, error: t("errors.kgPositive") };
  }
  if (!input.greenLotCode?.trim()) {
    return { ok: false, error: t("errors.lotRequired") };
  }
  if (!input.cycleLabel?.trim()) {
    return { ok: false, error: t("errors.cycleRequired") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("allocate_subscription_cycle", {
    p_subscription_id: input.subscriptionId,
    p_green_lot_code: input.greenLotCode.trim(),
    p_kg: input.kg,
    p_cycle_label: input.cycleLabel.trim(),
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return { ok: false, error: friendlyError(error as PgError, t("errors.generic")) };
  }

  // The allocation inserted a lot_reservations row: green inventory / ATP moved.
  reactiveRefresh("inventory-update");
  return { ok: true, allocationId: Number(data) };
}

async function transition(
  rpc: "pause_subscription" | "resume_subscription" | "cancel_subscription",
  input: LifecycleInput,
): Promise<LifecycleResult> {
  const t = await getTranslations("subscriptions");
  if (!isId(input.subscriptionId)) {
    return { ok: false, error: t("errors.subRequired") };
  }
  const sb = await getSupabase();
  const { data, error } = await sb.rpc(rpc, {
    p_subscription_id: input.subscriptionId,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return { ok: false, error: friendlyError(error as PgError, t("errors.generic")) };
  }
  return { ok: true, subscriptionId: Number(data) };
}

export async function pauseSubscriptionAction(
  input: LifecycleInput,
): Promise<LifecycleResult> {
  return transition("pause_subscription", input);
}

export async function resumeSubscriptionAction(
  input: LifecycleInput,
): Promise<LifecycleResult> {
  return transition("resume_subscription", input);
}

export async function cancelSubscriptionAction(
  input: LifecycleInput,
): Promise<LifecycleResult> {
  return transition("cancel_subscription", input);
}

export async function skipSubscriptionCycleAction(
  input: SkipCycleInput,
): Promise<LifecycleResult> {
  const t = await getTranslations("subscriptions");
  if (!isId(input.subscriptionId)) {
    return { ok: false, error: t("errors.subRequired") };
  }
  if (!input.cycleLabel?.trim()) {
    return { ok: false, error: t("errors.cycleRequired") };
  }
  const sb = await getSupabase();
  const { data, error } = await sb.rpc("skip_subscription_cycle", {
    p_subscription_id: input.subscriptionId,
    p_cycle_label: input.cycleLabel.trim(),
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return { ok: false, error: friendlyError(error as PgError, t("errors.generic")) };
  }
  return { ok: true, subscriptionId: Number(data) };
}

export async function recordDunningAction(
  input: DunningInput,
): Promise<DunningResult> {
  const t = await getTranslations("subscriptions");
  if (!isId(input.subscriptionId)) {
    return { ok: false, error: t("errors.subRequired") };
  }
  if (!["soft", "reminder", "final"].includes(input.stage)) {
    return { ok: false, error: t("errors.stageRequired") };
  }
  const sb = await getSupabase();
  const { data, error } = await sb.rpc("record_dunning_event", {
    p_subscription_id: input.subscriptionId,
    p_stage: input.stage,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return { ok: false, error: friendlyError(error as PgError, t("errors.generic")) };
  }
  return { ok: true, eventId: Number(data) };
}
