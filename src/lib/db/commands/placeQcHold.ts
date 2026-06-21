import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side commands for the QC-HOLD quarantine (P2-S6 — THE cup-protection
 * teeth; ADR-002). `place_qc_hold` opens a hold on a green lot — and a held lot
 * physically CANNOT be reserved or shipped (the `_prevent_held_lot_commit` DB
 * trigger fails closed). `release_qc_hold` re-opens commerce. Both are SECURITY
 * DEFINER RPCs; these pure commands mirror recordCherryIntake — a validator + a
 * thin command over the one `.rpc()` each needs, testable with no database.
 */

/** Validated place-hold args (camelCase). */
export interface PlaceQcHoldInput {
  greenLotCode: string;
  reason: string;
  deviceId: string;
  deviceSeq: number;
  idempotencyKey: string;
}

/** Pure validation — a hold must name a lot AND say why (the audit reason). */
export function validatePlaceQcHold(
  raw: Record<string, unknown>,
): ValidationResult<PlaceQcHoldInput> {
  const errors: Record<string, string> = {};

  const greenLotCode = trimmed(raw.greenLotCode);
  if (!greenLotCode) errors.greenLotCode = "Choose a green lot.";

  const reason = trimmed(raw.reason);
  if (!reason) errors.reason = "A hold reason is required.";

  const deviceId = trimmed(raw.deviceId) || "server";
  const deviceSeqRaw = toNumber(raw.deviceSeq);
  const deviceSeq = deviceSeqRaw === null || deviceSeqRaw < 0 ? 0 : deviceSeqRaw;
  const idempotencyKey = trimmed(raw.idempotencyKey) || `hold:${greenLotCode}:${Date.now()}`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: { greenLotCode, reason, deviceId, deviceSeq, idempotencyKey },
  };
}

interface RpcResult {
  data: number | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — the place + release RPCs the commands need. */
export interface QcHoldStore {
  rpc(
    fn: "place_qc_hold" | "release_qc_hold",
    args: Record<string, unknown>,
  ): Promise<RpcResult>;
}

export type QcHoldResult =
  | { ok: true }
  | { ok: false; errors?: Record<string, string>; message?: string };

/** Validate then place: calls `place_qc_hold` once. A form-supplied `occurredAt`
 *  (the real hold wall-clock) wins; the action stamps `now()` otherwise. */
export async function placeQcHold(
  store: QcHoldStore,
  raw: Record<string, unknown>,
): Promise<QcHoldResult> {
  const parsed = validatePlaceQcHold(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const occurredAt =
    typeof raw.occurredAt === "string" && raw.occurredAt.trim()
      ? raw.occurredAt.trim()
      : new Date().toISOString();

  const { error } = await store.rpc("place_qc_hold", {
    p_green_lot_code: parsed.data.greenLotCode,
    p_reason: parsed.data.reason,
    p_occurred_at: occurredAt,
    p_device_id: parsed.data.deviceId,
    p_device_seq: parsed.data.deviceSeq,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) return { ok: false, message: `place_qc_hold: ${error.message}` };
  return { ok: true };
}

/** Validate then release: calls `release_qc_hold` once. Naturally idempotent in
 *  the DB (only open holds are stamped). */
export async function releaseQcHold(
  store: QcHoldStore,
  raw: Record<string, unknown>,
): Promise<QcHoldResult> {
  const greenLotCode = trimmed(raw.greenLotCode);
  if (!greenLotCode) {
    return { ok: false, errors: { greenLotCode: "Choose a green lot." } };
  }

  const occurredAt =
    typeof raw.occurredAt === "string" && raw.occurredAt.trim()
      ? raw.occurredAt.trim()
      : new Date().toISOString();
  const deviceId = trimmed(raw.deviceId) || "server";
  const deviceSeqRaw = toNumber(raw.deviceSeq);
  const deviceSeq = deviceSeqRaw === null || deviceSeqRaw < 0 ? 0 : deviceSeqRaw;
  const idempotencyKey =
    trimmed(raw.idempotencyKey) || `release:${greenLotCode}:${Date.now()}`;

  const { error } = await store.rpc("release_qc_hold", {
    p_green_lot_code: greenLotCode,
    p_occurred_at: occurredAt,
    p_device_id: deviceId,
    p_device_seq: deviceSeq,
    p_idempotency_key: idempotencyKey,
  });

  if (error) return { ok: false, message: `release_qc_hold: ${error.message}` };
  return { ok: true };
}
