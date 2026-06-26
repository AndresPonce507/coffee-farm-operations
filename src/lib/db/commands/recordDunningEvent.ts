import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for the dunning ledger (P3-S12). The `record_dunning_event` RPC
 * appends a 'dunning' `sub_event`; a 'final' stage also marks the subscription past_due.
 * Idempotent on the key. The DB does NOT enum-lock the stage (only 'final' is special-
 * cased), so the validator just requires a non-empty stage — `DUNNING_STAGES` is a UI
 * convenience list, not a hard gate.
 *
 * Symmetric twin of the read ports: a pure validator plus a thin command calling the one
 * `.rpc()` it needs. The idempotency key is REQUIRED.
 */

/** Suggested dunning stages for the UI (NOT enforced — the DB special-cases only 'final'). */
export const DUNNING_STAGES = ["reminder", "soft", "hard", "final"] as const;
export type DunningStage = (typeof DUNNING_STAGES)[number];

/** Validated, domain-shaped dunning args (camelCase). */
export interface RecordDunningEventInput {
  subscriptionId: number;
  /** The dunning stage; 'final' marks the subscription past_due. Any non-empty value. */
  stage: string;
  idempotencyKey: string;
}

/** Pure validation — a real subscription id + a non-empty stage + a key. */
export function validateRecordDunningEvent(
  raw: Record<string, unknown>,
): ValidationResult<RecordDunningEventInput> {
  const errors: Record<string, string> = {};

  const subscriptionId = toNumber(raw.subscriptionId);
  if (subscriptionId === null || !Number.isInteger(subscriptionId) || subscriptionId <= 0) {
    errors.subscriptionId = "Choose a subscription.";
  }

  const stage = trimmed(raw.stage);
  if (!stage) errors.stage = "A dunning stage is required.";

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: { subscriptionId: subscriptionId as number, stage, idempotencyKey },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint sub_event id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the `.rpc()` method `record_dunning_event` needs. */
export interface RecordDunningEventStore {
  rpc(
    fn: "record_dunning_event",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the new dunning event id, or friendly/labelled errors. */
export type RecordDunningEventResult =
  | { ok: true; eventId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/** Map a raw Postgres error onto a family-readable sentence; null when unrecognised. */
export function friendlyRecordDunningEventError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  if (error.code === "23503" || /unknown subscription|foreign key/.test(m)) {
    return "That subscription couldn't be found. Refresh and try again.";
  }
  return null;
}

/**
 * Validate then record: calls `record_dunning_event` exactly once with the snake_case
 * envelope. Bad input never reaches the RPC; an unknown subscription surfaces clean.
 * Exactly-once on `idempotencyKey`.
 */
export async function recordDunningEvent(
  store: RecordDunningEventStore,
  raw: Record<string, unknown>,
): Promise<RecordDunningEventResult> {
  const parsed = validateRecordDunningEvent(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("record_dunning_event", {
    p_subscription_id: parsed.data.subscriptionId,
    p_stage: parsed.data.stage,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyRecordDunningEventError(error) ??
        "That dunning step couldn't be recorded right now. Please try again.",
    };
  }
  if (data == null) {
    return { ok: false, message: "That dunning step couldn't be recorded right now. Please try again." };
  }
  return { ok: true, eventId: Number(data) };
}
