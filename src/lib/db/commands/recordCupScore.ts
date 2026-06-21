import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for a cupping attribute score (P2-S6 — ADR-002: all writes
 * flow through a SECURITY DEFINER command RPC). The single write door is
 * `record_cup_score`, which appends one immutable row to the `cupping_scores`
 * append-only ledger (exactly-once on idempotency_key). This pure command mirrors
 * recordCherryIntake: a friendly validator + a thin command over the one `.rpc()`
 * it needs, testable against a fake store with no database. The SQL CHECK
 * (score 0–100) + the append-only block trigger are the REAL enforcement.
 */

/** Validated, domain-shaped cup-score args (camelCase). */
export interface CupScoreInput {
  sessionId: number;
  attribute: string;
  score: number;
  deviceId: string;
  deviceSeq: number;
  idempotencyKey: string;
}

/** Pure validation — mirrors the `record_cup_score` / `cupping_scores` CHECKs so
 *  errors surface before the round-trip. The SQL is the actual enforcement. */
export function validateCupScore(
  raw: Record<string, unknown>,
): ValidationResult<CupScoreInput> {
  const errors: Record<string, string> = {};

  const sessionId = toNumber(raw.sessionId);
  if (sessionId === null || sessionId <= 0 || !Number.isInteger(sessionId)) {
    errors.sessionId = "A cupping session is required.";
  }

  const attribute = trimmed(raw.attribute);
  if (!attribute) errors.attribute = "An attribute is required.";

  const score = toNumber(raw.score);
  if (score === null || score < 0 || score > 100) {
    errors.score = "Score must be between 0 and 100.";
  }

  const deviceId = trimmed(raw.deviceId);
  if (!deviceId) errors.deviceId = "A device id is required.";

  const deviceSeq = toNumber(raw.deviceSeq);
  if (deviceSeq === null || deviceSeq < 0 || !Number.isInteger(deviceSeq)) {
    errors.deviceSeq = "A device sequence is required.";
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      sessionId: sessionId as number,
      attribute,
      score: score as number,
      deviceId,
      deviceSeq: deviceSeq as number,
      idempotencyKey,
    },
  };
}

interface RpcResult {
  data: number | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` the command needs. */
export interface CupScoreStore {
  rpc(fn: "record_cup_score", args: Record<string, unknown>): Promise<RpcResult>;
}

export type CupScoreResult =
  | { ok: true; scoreId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/** Validate then append: calls `record_cup_score` once with the snake_case
 *  envelope. Bad input never reaches the RPC; a replay is exactly-once in the DB. */
export async function recordCupScore(
  store: CupScoreStore,
  raw: Record<string, unknown>,
): Promise<CupScoreResult> {
  const parsed = validateCupScore(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("record_cup_score", {
    p_session_id: parsed.data.sessionId,
    p_attribute: parsed.data.attribute,
    p_score: parsed.data.score,
    p_device_id: parsed.data.deviceId,
    p_device_seq: parsed.data.deviceSeq,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) return { ok: false, message: `record_cup_score: ${error.message}` };
  return { ok: true, scoreId: Number(data ?? 0) };
}
