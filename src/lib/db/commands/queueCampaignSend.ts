import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for building the DRAFT outbound queue (P3-S20 — AI/owner
 * drafting; ADR-002 + the no-untrusted-inbound rail). `queue_campaign_send` selects
 * ONLY consenting, non-unsubscribed contacts (the CONSENT GATE; the
 * `_enforce_marketing_consent` before-insert guard re-checks every row against the
 * LIVE contact), renders the merge tags ({{lot_code}}/{{cup_score}}/{{sca_grade}})
 * from the lot's QC truth + reputation, and inserts 'queued' rows. NOTHING is sent
 * here — this is drafting the queue; the human-confirmed `mark_campaign_sent` is the
 * only send door. It returns the COUNT of newly-queued rows; idempotent (a replay
 * queues nothing more → 0). Tenant-clamped.
 *
 * Symmetric twin of the read ports: a pure validator plus a thin command that calls
 * the one `.rpc()` it needs. The idempotency key is REQUIRED. A 0 count (an
 * idempotent replay, or no consenting contacts) is a SUCCESS, not an error.
 */

/** Validated, domain-shaped queue args (camelCase). */
export interface QueueCampaignSendInput {
  campaignId: number;
  idempotencyKey: string;
}

/**
 * Pure validation of a raw queue request — a real campaign id (accepted under
 * `campaignId` or `id`) + an idempotency key. The consent gate + the merge-tag
 * render + idempotency are the RPC's job (the migration's PGlite tests).
 */
export function validateQueueCampaignSend(
  raw: Record<string, unknown>,
): ValidationResult<QueueCampaignSendInput> {
  const errors: Record<string, string> = {};

  const campaignId = toNumber(raw.campaignId ?? raw.id);
  if (campaignId === null || !Number.isInteger(campaignId) || campaignId <= 0) {
    errors.campaignId = "Choose a campaign to queue.";
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, data: { campaignId: campaignId as number, idempotencyKey } };
}

/** The PostgREST shape the command returns from `.rpc()` (integer queued count). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` `queue_campaign_send` needs. */
export interface QueueCampaignSendStore {
  rpc(
    fn: "queue_campaign_send",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the queued count, or friendly/labelled errors. */
export type QueueCampaignSendResult =
  | { ok: true; queuedCount: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `queue_campaign_send` onto a family-readable
 * sentence (the unknown-campaign rejection; defensively, the consent guard — the
 * RPC only selects consenting rows, so this should not fire from this path).
 * Returns null for anything unrecognised.
 */
export function friendlyQueueCampaignSendError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  if (/marketing consent guard|has not consented|unsubscrib/.test(m)) {
    return "One of the targeted contacts hasn't consented (or has unsubscribed) and was skipped. Only consenting contacts can be queued.";
  }
  if (error.code === "23503" || /unknown campaign|foreign key/.test(m)) {
    return "That campaign couldn't be found. Refresh and try again.";
  }
  return null;
}

/**
 * Validate then queue: calls `queue_campaign_send` exactly once with the snake_case
 * argument envelope. Bad input never reaches the RPC (friendly errors); the
 * unknown-campaign rejection surfaces as a CLEAN sentence, any other failure
 * labelled. Returns the queued count (0 is success). Exactly-once on `idempotencyKey`.
 */
export async function queueCampaignSend(
  store: QueueCampaignSendStore,
  raw: Record<string, unknown>,
): Promise<QueueCampaignSendResult> {
  const parsed = validateQueueCampaignSend(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("queue_campaign_send", {
    p_campaign_id: parsed.data.campaignId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyQueueCampaignSendError(error) ??
        "The campaign couldn't be queued right now. Please try again.",
    };
  }
  return { ok: true, queuedCount: Number(data ?? 0) };
}
