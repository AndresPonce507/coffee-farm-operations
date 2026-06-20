import type { CoffeeVariety } from "@/lib/types";
import {
  isISODate,
  toNumber,
  trimmed,
  type ValidationResult,
} from "@/lib/validation/shared";

/**
 * Write-side command for cherry intake (ADR-002 — all writes flow through a
 * `SECURITY DEFINER` command RPC, one per business intent).
 *
 * This is the symmetric twin of the read ports in `src/lib/db/*.ts`: a pure
 * validator (`validateCherryIntake`, the friendly-error seam) plus a thin
 * command (`recordCherryIntake`) that calls the *single write door*,
 * `record_cherry_intake`, the canonical gap-free monotonic JC-NNN minter. The
 * command takes only the one `.rpc()` method it needs (the `CherryIntakeStore`
 * port) so it is testable against a fake store with no database — the SQL
 * CHECK/raise inside the RPC is the *real* enforcement; the Zod-style validation
 * here exists purely to surface friendly errors before the round-trip.
 *
 * Mirrors the established `@/lib/validation/*` `ValidationResult` contract
 * (the repo's friendly-error convention; zod is not a project dependency).
 */

/** The recognised coffee varieties — mirrors the `coffee_variety` enum. */
const VARIETIES: readonly CoffeeVariety[] = [
  "Geisha",
  "Caturra",
  "Catuaí",
  "Pacamara",
  "Typica",
];

/** Validated, domain-shaped intake args (camelCase). */
export interface CherryIntakeInput {
  plotId: string;
  workerId: string;
  cherriesKg: number;
  variety: CoffeeVariety;
  /** Field wall-clock — `occurred_at`, the key every metric computes on (D5). */
  occurredAt: string;
  /** Offline node identity — synthetic `"server"` for online writes today (D5). */
  deviceId: string;
  /** Per-device monotonic Lamport counter — `device_seq` (D4 replay safety). */
  deviceSeq: number;
  /** Exactly-once anchor — the DB dedupes on this (`idempotency_key`, D4). */
  idempotencyKey: string;
}

/** Is `v` a recognised, ISO-8601 timestamp (e.g. "2026-06-20T14:03:00.000Z")? */
function isISOTimestamp(v: string): boolean {
  if (v === "") return false;
  const t = Date.parse(v);
  return Number.isFinite(t) && /\d{4}-\d{2}-\d{2}T/.test(v);
}

/**
 * Pure validation of a raw intake (form record or object) — mirrors the
 * `record_cherry_intake` DB constraints so errors surface before the round-trip.
 * The SQL CHECK/raise is the actual enforcement (ADR-002).
 */
export function validateCherryIntake(
  raw: Record<string, unknown>,
): ValidationResult<CherryIntakeInput> {
  const errors: Record<string, string> = {};

  const plotId = trimmed(raw.plotId);
  if (!plotId) errors.plotId = "Choose a plot.";

  const workerId = trimmed(raw.workerId);
  if (!workerId) errors.workerId = "Choose a picker.";

  const cherriesKg = toNumber(raw.cherriesKg);
  if (cherriesKg === null || cherriesKg <= 0) {
    errors.cherriesKg = "Cherries (kg) must be greater than 0.";
  }

  const variety = trimmed(raw.variety) as CoffeeVariety;
  if (!VARIETIES.includes(variety)) errors.variety = "Choose a coffee variety.";

  const occurredAt = trimmed(raw.occurredAt);
  if (!isISOTimestamp(occurredAt) && !isISODate(occurredAt)) {
    errors.occurredAt = "A valid intake time is required.";
  }

  const deviceId = trimmed(raw.deviceId);
  if (!deviceId) errors.deviceId = "A device id is required.";

  const deviceSeq = toNumber(raw.deviceSeq);
  if (deviceSeq === null || deviceSeq < 0 || !Number.isInteger(deviceSeq)) {
    errors.deviceSeq = "A device sequence is required.";
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) {
    errors.idempotencyKey = "An idempotency key is required.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      plotId,
      workerId,
      cherriesKg: cherriesKg as number,
      variety,
      occurredAt,
      deviceId,
      deviceSeq: deviceSeq as number,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()`. */
interface RpcResult {
  data: string | null;
  error: { message: string } | null;
}

/**
 * The narrow write port the command depends on — exactly the one `.rpc()`
 * method `record_cherry_intake` needs. A Supabase client satisfies this
 * structurally; a hand-rolled stub satisfies it in pure-domain tests.
 */
export interface CherryIntakeStore {
  rpc(fn: "record_cherry_intake", args: Record<string, unknown>): Promise<RpcResult>;
}

/** Outcome of the command: the minted lot code, or friendly/labelled errors. */
export type CherryIntakeResult =
  | { ok: true; lotCode: string }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Validate then mint: calls `record_cherry_intake` exactly once with the
 * snake_case argument envelope the SECURITY DEFINER RPC expects. Bad input
 * never reaches the RPC (friendly errors); RPC failures surface labelled. The
 * RPC is exactly-once on `idempotencyKey` — a replay returns the originally
 * minted code, no second lot, no second event.
 */
export async function recordCherryIntake(
  store: CherryIntakeStore,
  raw: Record<string, unknown>,
): Promise<CherryIntakeResult> {
  const parsed = validateCherryIntake(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("record_cherry_intake", {
    p_plot_id: parsed.data.plotId,
    p_worker_id: parsed.data.workerId,
    p_cherries_kg: parsed.data.cherriesKg,
    p_variety: parsed.data.variety,
    p_occurred_at: parsed.data.occurredAt,
    p_device_id: parsed.data.deviceId,
    p_device_seq: parsed.data.deviceSeq,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return { ok: false, message: `record_cherry_intake: ${error.message}` };
  }
  if (!data) {
    return { ok: false, message: "record_cherry_intake: no lot code returned" };
  }
  return { ok: true, lotCode: data };
}
