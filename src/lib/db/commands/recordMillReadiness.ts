import {
  isISODate,
  toNumber,
  trimmed,
  type ValidationResult,
} from "@/lib/validation/shared";

/**
 * Write-side command for recording a pre-mill readiness measurement (P3-S7 — mill
 * readiness + run skeleton, the no-mill-out-of-spec gate; ADR-002 — all writes flow
 * through a SECURITY DEFINER command RPC). The `mill_readiness` ledger is APPEND-ONLY
 * (immutability triggers reject UPDATE/DELETE): a correction is a NEW measurement, never
 * an edit. The single write door is `record_mill_readiness` — tenant-clamped, idempotent
 * on a tenant-qualified key, which SNAPSHOTS the upstream P2-S4 reposo clearance and lets
 * the DB-GENERATED `passed` column fold moisture/aw spec AND that snapshot together. A
 * FAILING reading (too wet / not rested) is a legitimate append — it documents the failure
 * and simply won't satisfy the `open_milling_run` gate. `measured_at` is optional — a blank
 * stamps `now()` in the RPC.
 *
 * Symmetric twin of the read ports: a pure validator (`validateRecordMillReadiness`, the
 * friendly-error seam) plus a thin command (`recordMillReadiness`) that calls the single
 * `.rpc()` method it needs (the `RecordMillReadinessStore` port) so it is testable against a
 * fake store with no database. The idempotency key is REQUIRED — the action/form layer mints
 * a stable token (mirrors recordIceCQuote / advanceProcessingStage).
 */

/** Validated, domain-shaped readiness args (camelCase). */
export interface RecordMillReadinessInput {
  /** The parchment lot being measured (composite-FK'd to lots). */
  parchmentLotCode: string;
  /** Moisture reading, percent (the `0 ≤ moisture_pct ≤ 100` CHECK guards it). */
  moisturePct: number;
  /** Water-activity reading, aw (the `0 ≤ water_activity_aw ≤ 1` CHECK guards it). */
  waterActivityAw: number;
  /** Field wall-clock of the measurement; null ⇒ the RPC stamps now(). */
  measuredAt: string | null;
  /** Exactly-once anchor — the DB dedupes on a tenant-qualified key. */
  idempotencyKey: string;
}

/** Is `v` a recognised ISO-8601 timestamp (e.g. "2026-06-24T08:00:00.000Z")? */
function isISOTimestamp(v: string): boolean {
  if (v === "") return false;
  const t = Date.parse(v);
  return Number.isFinite(t) && /\d{4}-\d{2}-\d{2}T/.test(v);
}

/**
 * Pure validation of a raw readiness measurement — mirrors the `mill_readiness`
 * CHECK BOUNDS (moisture 0–100%, aw 0–1) so errors surface before the round-trip.
 * NB it validates the *physical bounds*, NOT the pass thresholds (10.5–11.5% / 0.60):
 * an out-of-spec reading is a valid append — the DB's GENERATED `passed` is the verdict,
 * and the `open_milling_run` gate is the enforcement. The append-only triggers + reposo
 * snapshot + tenant clamp are the actual enforcement (ADR-002).
 */
export function validateRecordMillReadiness(
  raw: Record<string, unknown>,
): ValidationResult<RecordMillReadinessInput> {
  const errors: Record<string, string> = {};

  const parchmentLotCode = trimmed(raw.parchmentLotCode);
  if (!parchmentLotCode) errors.parchmentLotCode = "Choose a parchment lot.";

  const moisturePct = toNumber(raw.moisturePct);
  if (moisturePct === null || moisturePct < 0 || moisturePct > 100) {
    errors.moisturePct = "Moisture must be between 0 and 100%.";
  }

  const waterActivityAw = toNumber(raw.waterActivityAw);
  if (waterActivityAw === null || waterActivityAw < 0 || waterActivityAw > 1) {
    errors.waterActivityAw = "Water activity (aw) must be between 0 and 1.";
  }

  // Blank measured_at means "not provided" → null (the RPC stamps now()).
  const rawMeasuredAt = trimmed(raw.measuredAt);
  let measuredAt: string | null = null;
  if (rawMeasuredAt) {
    if (!isISOTimestamp(rawMeasuredAt) && !isISODate(rawMeasuredAt)) {
      errors.measuredAt = "A valid measurement time is required.";
    } else {
      measuredAt = rawMeasuredAt;
    }
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      parchmentLotCode,
      moisturePct: moisturePct as number,
      waterActivityAw: waterActivityAw as number,
      measuredAt,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint readiness id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/**
 * The narrow write port the command depends on — exactly the one `.rpc()` method
 * `record_mill_readiness` needs. A Supabase client satisfies this structurally; a
 * hand-rolled stub satisfies it in pure-domain tests.
 */
export interface RecordMillReadinessStore {
  rpc(
    fn: "record_mill_readiness",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the readiness measurement's id, or friendly/labelled errors. */
export type RecordMillReadinessResult =
  | { ok: true; readinessId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `record_mill_readiness` onto a family-readable sentence
 * — the family must never see raw PG text (constraint names, errcodes). Returns null for
 * anything unrecognised so the caller can fall back to a generic labelled message.
 */
export function friendlyRecordMillReadinessError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  // Unknown parchment lot (the composite FK to lots).
  if (error.code === "23503" || /foreign key|parchment_lot_tfk/.test(m)) {
    return "That parchment lot couldn't be found. Pick a lot from the list and try again.";
  }
  return null;
}

/**
 * Validate then record: calls `record_mill_readiness` exactly once with the snake_case
 * argument envelope the SECURITY DEFINER RPC expects. Bad input never reaches the RPC
 * (friendly errors); a failure surfaces as a labelled message (raw Postgres text never
 * leaks). Exactly-once on `idempotencyKey` — a replay returns the same readiness id with
 * no second insert.
 */
export async function recordMillReadiness(
  store: RecordMillReadinessStore,
  raw: Record<string, unknown>,
): Promise<RecordMillReadinessResult> {
  const parsed = validateRecordMillReadiness(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("record_mill_readiness", {
    p_parchment_lot_code: parsed.data.parchmentLotCode,
    p_moisture_pct: parsed.data.moisturePct,
    p_water_activity_aw: parsed.data.waterActivityAw,
    p_measured_at: parsed.data.measuredAt,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyRecordMillReadinessError(error) ??
        "That reading couldn't be recorded right now. Please check the details and try again.",
    };
  }
  if (data == null) {
    return {
      ok: false,
      message: "That reading couldn't be recorded right now. Please try again.",
    };
  }
  return { ok: true, readinessId: Number(data) };
}
