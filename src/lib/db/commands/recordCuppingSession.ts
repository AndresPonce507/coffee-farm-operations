import type { CuppingProtocol } from "@/lib/types";
import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for opening a cupping session (P2-S6 — ADR-002). The single
 * write door is `record_cupping_session`, which inserts the session row
 * (idempotent on idempotency_key) the scores then attach to. Mirrors the
 * recordCherryIntake pattern: a friendly validator + a thin command over the one
 * `.rpc()` it needs, testable with no database. The SQL CHECK (protocol in
 * ('sca-cva','legacy-100')) is the real enforcement.
 */

const PROTOCOLS: readonly CuppingProtocol[] = ["sca-cva", "legacy-100"];

/** Coerce a checkbox / string truthy value to a boolean. */
function toBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  const s = trimmed(v).toLowerCase();
  return s === "true" || s === "on" || s === "1" || s === "yes";
}

export interface CuppingSessionInput {
  greenLotCode: string;
  cupperId: string;
  protocol: CuppingProtocol;
  isCalibration: boolean;
  deviceId: string;
  deviceSeq: number;
  idempotencyKey: string;
}

export function validateCuppingSession(
  raw: Record<string, unknown>,
): ValidationResult<CuppingSessionInput> {
  const errors: Record<string, string> = {};

  const greenLotCode = trimmed(raw.greenLotCode);
  if (!greenLotCode) errors.greenLotCode = "Choose a green lot.";

  const cupperId = trimmed(raw.cupperId);
  if (!cupperId) errors.cupperId = "Choose a cupper.";

  const protocol = trimmed(raw.protocol) as CuppingProtocol;
  if (!PROTOCOLS.includes(protocol)) errors.protocol = "Choose a scoring protocol.";

  const deviceId = trimmed(raw.deviceId) || "server";
  const deviceSeqRaw = toNumber(raw.deviceSeq);
  const deviceSeq = deviceSeqRaw === null || deviceSeqRaw < 0 ? 0 : deviceSeqRaw;
  const idempotencyKey =
    trimmed(raw.idempotencyKey) || `sess:${greenLotCode}:${cupperId}:${Date.now()}`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      greenLotCode,
      cupperId,
      protocol,
      isCalibration: toBool(raw.isCalibration),
      deviceId,
      deviceSeq,
      idempotencyKey,
    },
  };
}

interface RpcResult {
  data: number | null;
  error: { message: string; code?: string } | null;
}

export interface CuppingSessionStore {
  rpc(fn: "record_cupping_session", args: Record<string, unknown>): Promise<RpcResult>;
}

export type CuppingSessionResult =
  | { ok: true; sessionId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

export async function recordCuppingSession(
  store: CuppingSessionStore,
  raw: Record<string, unknown>,
): Promise<CuppingSessionResult> {
  const parsed = validateCuppingSession(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const occurredAt =
    typeof raw.occurredAt === "string" && raw.occurredAt.trim()
      ? raw.occurredAt.trim()
      : new Date().toISOString();

  const { data, error } = await store.rpc("record_cupping_session", {
    p_green_lot_code: parsed.data.greenLotCode,
    p_cupper_id: parsed.data.cupperId,
    p_protocol: parsed.data.protocol,
    p_is_calibration: parsed.data.isCalibration,
    p_occurred_at: occurredAt,
    p_device_id: parsed.data.deviceId,
    p_device_seq: parsed.data.deviceSeq,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) return { ok: false, message: `record_cupping_session: ${error.message}` };
  return { ok: true, sessionId: Number(data ?? 0) };
}
