import { trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for the manual campaign drafter (P3-S20 — the composer's Save;
 * ADR-002). `draft_campaign` is idempotent + tenant-clamped. Drafting only creates a
 * 'draft' campaign header — NObody is targeted and NO consent gate runs at draft
 * time (the consent gate fires later, at `queue_campaign_send`). An optional
 * `green_lot_code` binds the campaign to a lot (its merge tags resolve against it);
 * a blank lot passes null — a lot-less manual campaign is legal. AI may draft the
 * copy from real harvest/reputation rows; a human later queues + sends it.
 *
 * Symmetric twin of the read ports: a pure validator (`validateDraftCampaign`,
 * mirroring the `campaign_trigger` enum default) plus a thin command that calls the
 * one `.rpc()` it needs. The idempotency key is REQUIRED.
 */

/** The `campaign_trigger` enum — 'manual' is the composer's own draft. */
export const CAMPAIGN_TRIGGERS = [
  "lot-launch",
  "replenishment",
  "sample-follow-up",
  "manual",
] as const;
export type CampaignTrigger = (typeof CAMPAIGN_TRIGGERS)[number];

/** Validated, domain-shaped campaign args (camelCase). Blank lot/subject/body null. */
export interface DraftCampaignInput {
  name: string;
  triggerKind: CampaignTrigger;
  greenLotCode: string | null;
  subject: string | null;
  bodyTemplate: string | null;
  idempotencyKey: string;
}

/** Is `v` one of the recognised campaign triggers? (mirrors the enum) */
function isCampaignTrigger(v: string): v is CampaignTrigger {
  return (CAMPAIGN_TRIGGERS as readonly string[]).includes(v);
}

/**
 * Pure validation of a raw campaign draft — a name + idempotency key are required;
 * a blank trigger defaults to 'manual'; the lot / subject / body are OPTIONAL (a
 * blank passes null). The unknown-lot FK + tenant clamp + idempotency are the real
 * enforcement (ADR-002, pinned by the migration's PGlite tests).
 */
export function validateDraftCampaign(
  raw: Record<string, unknown>,
): ValidationResult<DraftCampaignInput> {
  const errors: Record<string, string> = {};

  const name = trimmed(raw.name);
  if (!name) errors.name = "A campaign name is required.";

  // Blank trigger defaults to 'manual'; a supplied value must be a known kind.
  const rawTrigger = trimmed(raw.triggerKind) || "manual";
  if (!isCampaignTrigger(rawTrigger)) {
    errors.triggerKind = "Choose a valid campaign trigger.";
  }

  const greenLotCode = trimmed(raw.greenLotCode) || null;
  const subject = trimmed(raw.subject) || null;
  const bodyTemplate = trimmed(raw.bodyTemplate) || null;

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      name,
      triggerKind: rawTrigger as CampaignTrigger,
      greenLotCode,
      subject,
      bodyTemplate,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` `draft_campaign` needs. */
export interface DraftCampaignStore {
  rpc(
    fn: "draft_campaign",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the campaign's id, or friendly/labelled errors. */
export type DraftCampaignResult =
  | { ok: true; campaignId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `draft_campaign` onto a family-readable sentence
 * (the unknown-lot rejection). Returns null for anything unrecognised.
 */
export function friendlyDraftCampaignError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  if (error.code === "23503" || /unknown green lot|foreign key/.test(m)) {
    return "That green lot couldn't be found. Pick a lot (or leave it blank) and try again.";
  }
  return null;
}

/**
 * Validate then draft: calls `draft_campaign` exactly once with the snake_case
 * argument envelope. Bad input never reaches the RPC (friendly errors); the
 * unknown-lot rejection surfaces as a CLEAN sentence, any other failure labelled.
 * Exactly-once on `idempotencyKey` — a replay returns the same campaign id.
 */
export async function draftCampaign(
  store: DraftCampaignStore,
  raw: Record<string, unknown>,
): Promise<DraftCampaignResult> {
  const parsed = validateDraftCampaign(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("draft_campaign", {
    p_name: parsed.data.name,
    p_trigger_kind: parsed.data.triggerKind,
    p_green_lot_code: parsed.data.greenLotCode,
    p_subject: parsed.data.subject,
    p_body_template: parsed.data.bodyTemplate,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyDraftCampaignError(error) ??
        `Couldn't save the campaign: ${error.message}`,
    };
  }
  if (data == null) {
    return { ok: false, message: "The campaign couldn't be saved. Please try again." };
  }
  return { ok: true, campaignId: Number(data) };
}
