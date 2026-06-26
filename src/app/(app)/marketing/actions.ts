"use server";

import { getTranslations } from "next-intl/server";

import { getSupabase } from "@/lib/supabase/server";

/**
 * /marketing WRITE port — the draft / queue / send / unsubscribe Server Actions
 * (P3-S20 lifecycle marketing).
 *
 * Server Actions are the one driving port (rail §7: only ever invoked by an
 * authenticated human submitting a form). The send is split into two deliberate steps
 * so NO untrusted inbound and no AI ever sends on its own:
 *   • draft_campaign — saves a draft (the composer's Save). AI may draft the copy from
 *     real harvest/reputation rows; this is still just a draft.
 *   • queue_campaign_send — builds the DRAFT outbound queue, selecting ONLY consenting,
 *     non-unsubscribed contacts (the consent gate is a DB CHECK + a before-insert
 *     guard; the audience view filters too). NOTHING is sent — every row lands 'queued'.
 *   • mark_campaign_sent — the HUMAN-CONFIRMED send: a human clicks the button behind a
 *     glass confirm dialog; only then do queued rows flip to 'sent' and a hash-chained
 *     'campaign_sent' lot_event is appended.
 *   • record_unsubscribe — the contact's OWN opt-out. Suppression only removes
 *     capability (never a money/send action), so auto-applying it honors the rail.
 *
 * The consent gate lives at the database; these actions surface the author-written
 * guard messages verbatim (family-readable) and map structural Postgres errors to
 * clean copy — never a raw SQLSTATE leak. The idempotency_key is CLIENT-minted (rail
 * §1) so an exactly-once retry collapses to the same row / never double-sends.
 *
 * REVALIDATION: these move no inventory and no ATP — only the /marketing board. There
 * is no marketing-shaped EventKind to ripple and src/lib/revalidate.ts is a shared
 * contract file (single-author in the Wiring pass), so these intentionally bust
 * nothing; the client island calls router.refresh() after a write. WIRING SEAM: add a
 * "campaign-sent" EventKind whose RIPPLE routes are ["/marketing", "/lots/[code]"]
 * (mark_campaign_sent appends a 'campaign_sent' lot_event) and repoint.
 */

export type CampaignTrigger =
  | "lot-launch"
  | "replenishment"
  | "sample-follow-up"
  | "manual";

export interface DraftCampaignInput {
  name: string;
  triggerKind: CampaignTrigger;
  greenLotCode: string | null;
  subject: string | null;
  bodyTemplate: string | null;
  idempotencyKey: string;
}

export interface QueueSendInput {
  campaignId: number;
  idempotencyKey: string;
}

export interface MarkSentInput {
  campaignId: number;
  idempotencyKey: string;
}

export interface UnsubscribeInput {
  contactId: number;
  idempotencyKey: string;
}

export type DraftResult =
  | { ok: true; campaignId: number }
  | { ok: false; error: string };

export type QueueResult =
  | { ok: true; queuedCount: number }
  | { ok: false; error: string };

export type SendResult =
  | { ok: true; sentCount: number }
  | { ok: false; error: string };

export type UnsubscribeResult = { ok: true } | { ok: false; error: string };

interface PgError {
  message: string;
  code?: string;
}

function friendlyError(error: PgError, generic: string): string {
  switch (error.code) {
    case "23514": // check_violation — author-written guard messages (incl. the consent gate)
    case "P0001": // raise_exception
    case "P0002": // no_data_found
    case "23503": // foreign_key_violation ("unknown campaign / contact")
      return error.message;
    case "42501": // insufficient_privilege
      return "You don't have access to do that.";
    case "23505": // unique_violation — idempotent replay collided
      return "That was already saved.";
    default:
      return generic;
  }
}

const TRIGGERS: CampaignTrigger[] = [
  "lot-launch",
  "replenishment",
  "sample-follow-up",
  "manual",
];

const trimOrNull = (v: string | null): string | null => {
  if (v == null) return null;
  const t = v.trim();
  return t === "" ? null : t;
};

export async function draftCampaignAction(
  input: DraftCampaignInput,
): Promise<DraftResult> {
  const t = await getTranslations("marketing");

  const name = input.name?.trim();
  if (!name) return { ok: false, error: t("errors.nameRequired") };

  const subject = trimOrNull(input.subject);
  const body = trimOrNull(input.bodyTemplate);
  // A campaign with nothing to say can't be sent — require a subject or a message.
  if (!subject && !body) return { ok: false, error: t("errors.bodyRequired") };

  const triggerKind: CampaignTrigger = TRIGGERS.includes(input.triggerKind)
    ? input.triggerKind
    : "manual";

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("draft_campaign", {
    p_name: name,
    p_trigger_kind: triggerKind,
    p_green_lot_code: trimOrNull(input.greenLotCode),
    p_subject: subject,
    p_body_template: body,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return { ok: false, error: friendlyError(error as PgError, t("errors.generic")) };
  }
  return { ok: true, campaignId: Number(data) };
}

export async function queueCampaignSendAction(
  input: QueueSendInput,
): Promise<QueueResult> {
  const t = await getTranslations("marketing");

  if (!Number.isInteger(input.campaignId) || input.campaignId <= 0) {
    return { ok: false, error: t("errors.campaignRequired") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("queue_campaign_send", {
    p_campaign_id: input.campaignId,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return { ok: false, error: friendlyError(error as PgError, t("errors.queueGeneric")) };
  }
  return { ok: true, queuedCount: Number(data ?? 0) };
}

export async function markCampaignSentAction(
  input: MarkSentInput,
): Promise<SendResult> {
  const t = await getTranslations("marketing");

  if (!Number.isInteger(input.campaignId) || input.campaignId <= 0) {
    return { ok: false, error: t("errors.campaignRequired") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("mark_campaign_sent", {
    p_campaign_id: input.campaignId,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return { ok: false, error: friendlyError(error as PgError, t("errors.sendGeneric")) };
  }
  return { ok: true, sentCount: Number(data ?? 0) };
}

export async function recordUnsubscribeAction(
  input: UnsubscribeInput,
): Promise<UnsubscribeResult> {
  const t = await getTranslations("marketing");

  if (!Number.isInteger(input.contactId) || input.contactId <= 0) {
    return { ok: false, error: t("errors.contactRequired") };
  }

  const sb = await getSupabase();
  const { error } = await sb.rpc("record_unsubscribe", {
    p_contact_id: input.contactId,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return { ok: false, error: friendlyError(error as PgError, t("errors.generic")) };
  }
  return { ok: true };
}
