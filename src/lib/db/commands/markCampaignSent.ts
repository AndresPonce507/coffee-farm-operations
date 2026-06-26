import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for the HUMAN-CONFIRMED send (P3-S20 — the only place a send
 * happens; ADR-002 + the no-untrusted-inbound rail). `mark_campaign_sent` flips the
 * queued outbound rows → 'sent' (stamping sent_at), flips the campaign → 'sent', and
 * appends a hash-chained 'campaign_sent' lot_event. NO AI and no untrusted inbound
 * ever reaches it — a human clicks the button; THIS command is what that click
 * invokes. It returns the COUNT of rows marked sent; idempotent + tenant-clamped.
 *
 * Symmetric twin of the read ports: a pure validator plus a thin command that calls
 * the one `.rpc()` it needs. The idempotency key is REQUIRED. A 0 count (nothing was
 * queued, or an idempotent replay) is a SUCCESS, not an error.
 */

/** Validated, domain-shaped send args (camelCase). */
export interface MarkCampaignSentInput {
  campaignId: number;
  idempotencyKey: string;
}

/**
 * Pure validation of a raw send request — a real campaign id (accepted under
 * `campaignId` or `id`) + an idempotency key. The state flip + the 'campaign_sent'
 * event + idempotency are the RPC's job (the migration's PGlite tests).
 */
export function validateMarkCampaignSent(
  raw: Record<string, unknown>,
): ValidationResult<MarkCampaignSentInput> {
  const errors: Record<string, string> = {};

  const campaignId = toNumber(raw.campaignId ?? raw.id);
  if (campaignId === null || !Number.isInteger(campaignId) || campaignId <= 0) {
    errors.campaignId = "Choose a campaign to send.";
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, data: { campaignId: campaignId as number, idempotencyKey } };
}

/** The PostgREST shape the command returns from `.rpc()` (integer sent count). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` `mark_campaign_sent` needs. */
export interface MarkCampaignSentStore {
  rpc(
    fn: "mark_campaign_sent",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the sent count, or friendly/labelled errors. */
export type MarkCampaignSentResult =
  | { ok: true; sentCount: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `mark_campaign_sent` onto a family-readable
 * sentence (the unknown-campaign rejection). Returns null for anything unrecognised.
 */
export function friendlyMarkCampaignSentError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  if (error.code === "23503" || /unknown campaign|foreign key/.test(m)) {
    return "That campaign couldn't be found. Refresh and try again.";
  }
  return null;
}

/**
 * Validate then send: calls `mark_campaign_sent` exactly once with the snake_case
 * argument envelope. Bad input never reaches the RPC (friendly errors); the
 * unknown-campaign rejection surfaces as a CLEAN sentence, any other failure
 * labelled. Returns the sent count (0 is success). Exactly-once on `idempotencyKey`.
 */
export async function markCampaignSent(
  store: MarkCampaignSentStore,
  raw: Record<string, unknown>,
): Promise<MarkCampaignSentResult> {
  const parsed = validateMarkCampaignSent(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("mark_campaign_sent", {
    p_campaign_id: parsed.data.campaignId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyMarkCampaignSentError(error) ??
        "The campaign couldn't be sent right now. Please try again.",
    };
  }
  return { ok: true, sentCount: Number(data ?? 0) };
}
