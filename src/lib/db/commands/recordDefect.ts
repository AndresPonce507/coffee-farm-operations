import type { DefectCategory } from "@/lib/types";
import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for a green-grading defect tally (P2-S6 — ADR-002: all writes
 * flow through a SECURITY DEFINER command RPC). The single write door is
 * `record_defect`, which appends one immutable row to the `green_defects` append-only
 * ledger (exactly-once on idempotency_key). This is the MISSING write half of the
 * defect ledger: the table, the RPC, the read port (getGreenDefects) and the
 * v_qc_status primary/secondary tallies all already exist, but no app path could
 * ever append a row — so the tallies were permanently 0/0. This pure command mirrors
 * recordCupScore: a friendly validator + a thin command over the one `.rpc()` it
 * needs, testable against a fake store with no database. The SQL CHECKs
 * (count >= 0, category in ('primary','secondary')) + the append-only block trigger
 * are the REAL enforcement.
 */

const CATEGORIES: readonly DefectCategory[] = ["primary", "secondary"];

/** Validated, domain-shaped defect args (camelCase). */
export interface DefectInput {
  greenLotCode: string;
  defectKind: string;
  count: number;
  category: DefectCategory;
  deviceId: string;
  deviceSeq: number;
  idempotencyKey: string;
}

/** Pure validation — mirrors the `record_defect` / `green_defects` CHECKs so errors
 *  surface before the round-trip. The SQL is the actual enforcement. */
export function validateDefect(
  raw: Record<string, unknown>,
): ValidationResult<DefectInput> {
  const errors: Record<string, string> = {};

  const greenLotCode = trimmed(raw.greenLotCode);
  if (!greenLotCode) errors.greenLotCode = "Choose a green lot.";

  const defectKind = trimmed(raw.defectKind);
  if (!defectKind) errors.defectKind = "A defect kind is required.";

  const count = toNumber(raw.count);
  if (count === null || count < 0 || !Number.isInteger(count)) {
    errors.count = "Count must be a whole number of 0 or more.";
  }

  const category = trimmed(raw.category) as DefectCategory;
  if (!CATEGORIES.includes(category)) {
    errors.category = "Choose a defect band (primary or secondary).";
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
      greenLotCode,
      defectKind,
      count: count as number,
      category,
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
export interface DefectStore {
  rpc(fn: "record_defect", args: Record<string, unknown>): Promise<RpcResult>;
}

export type DefectResult =
  | { ok: true; defectId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/** Validate then append: calls `record_defect` once with the snake_case envelope.
 *  Bad input never reaches the RPC; a replay is exactly-once in the DB. */
export async function recordDefect(
  store: DefectStore,
  raw: Record<string, unknown>,
): Promise<DefectResult> {
  const parsed = validateDefect(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("record_defect", {
    p_green_lot_code: parsed.data.greenLotCode,
    p_defect_kind: parsed.data.defectKind,
    p_count: parsed.data.count,
    p_category: parsed.data.category,
    p_device_id: parsed.data.deviceId,
    p_device_seq: parsed.data.deviceSeq,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) return { ok: false, message: `record_defect: ${error.message}` };
  return { ok: true, defectId: Number(data ?? 0) };
}
