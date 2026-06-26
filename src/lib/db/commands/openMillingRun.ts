import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for opening a milling run (P3-S7 — THE no-mill-out-of-spec gate;
 * ADR-002 — all writes flow through a SECURITY DEFINER command RPC). The single write
 * door is `open_milling_run`, which RAISES (check_violation) unless a PASSING
 * `mill_readiness` row exists for the lot — in-spec moisture (10.5–11.5%), in-spec
 * water-activity (aw < 0.60), AND the upstream reposo clearance. The single biggest
 * outturn-killer (milling green that is still too wet / unrested) is blocked at the DATA
 * layer, not just the UI. The RPC appends a `mill_run_opened` lot_event and is idempotent
 * on a tenant-qualified key (a replay returns the same run id, no second run).
 *
 * Symmetric twin of the read ports: a pure validator plus a thin command that calls the
 * one `.rpc()` it needs (the `OpenMillingRunStore` port), testable with no database. The
 * idempotency key is REQUIRED. This command's load-bearing job is translating the keystone
 * gate's rejection into a CLEAN, family-readable sentence (raw Postgres text never leaks).
 */

/** Validated, domain-shaped open-run args (camelCase). */
export interface OpenMillingRunInput {
  /** The parchment lot to mill (composite-FK'd to lots). */
  parchmentLotCode: string;
  /** Parchment mass entering the chain, kg (the `parchment_kg_in > 0` CHECK guards it). */
  parchmentKgIn: number;
  /** Exactly-once anchor — the DB dedupes on a tenant-qualified key. */
  idempotencyKey: string;
}

/**
 * Pure validation of a raw open-run request — mirrors the `milling_runs` precondition
 * (`parchment_kg_in > 0`) so errors surface before the round-trip. The keystone gate
 * (a passing `mill_readiness` must exist) is the RPC's enforcement, surfaced as a friendly
 * message below.
 */
export function validateOpenMillingRun(
  raw: Record<string, unknown>,
): ValidationResult<OpenMillingRunInput> {
  const errors: Record<string, string> = {};

  const parchmentLotCode = trimmed(raw.parchmentLotCode);
  if (!parchmentLotCode) errors.parchmentLotCode = "Choose a parchment lot.";

  const parchmentKgIn = toNumber(raw.parchmentKgIn);
  if (parchmentKgIn === null || parchmentKgIn <= 0) {
    errors.parchmentKgIn = "Parchment mass (kg) must be greater than 0.";
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      parchmentLotCode,
      parchmentKgIn: parchmentKgIn as number,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint run id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method `open_milling_run` needs. */
export interface OpenMillingRunStore {
  rpc(
    fn: "open_milling_run",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the run id, or friendly/labelled errors. */
export type OpenMillingRunResult =
  | { ok: true; runId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `open_milling_run` onto a family-readable sentence —
 * the RPC is the real guard, but the family must never see raw PG text (the
 * `no-mill-out-of-spec:` engine prefix, the `mill_readiness` table name, errcodes).
 * Returns null for anything unrecognised so the caller can fall back to a generic message.
 */
export function friendlyOpenMillingRunError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  // THE KEYSTONE GATE: no passing readiness for the lot (too wet / unrested / no reading).
  if (/no-mill-out-of-spec|no passing mill_readiness|mill_readiness|reposo/.test(m)) {
    return "This lot isn't ready to mill yet. Record a passing reposo/spec reading first — moisture 10.5–11.5%, water activity below 0.60, and reposo cleared.";
  }
  // Unknown parchment lot (the composite FK to lots).
  if (error.code === "23503" || /foreign key|parchment_lot_tfk/.test(m)) {
    return "That parchment lot couldn't be found. Pick a lot from the list and try again.";
  }
  return null;
}

/**
 * Validate then open: calls `open_milling_run` exactly once with the snake_case argument
 * envelope. Bad input never reaches the RPC (friendly errors); the keystone gate's
 * fail-closed rejection (no passing readiness) surfaces as a CLEAN sentence, any other
 * failure surfaces labelled. Exactly-once on `idempotencyKey` — a replay returns the same
 * run id with no second run.
 */
export async function openMillingRun(
  store: OpenMillingRunStore,
  raw: Record<string, unknown>,
): Promise<OpenMillingRunResult> {
  const parsed = validateOpenMillingRun(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("open_milling_run", {
    p_parchment_lot_code: parsed.data.parchmentLotCode,
    p_parchment_kg_in: parsed.data.parchmentKgIn,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyOpenMillingRunError(error) ??
        "This milling run couldn't be opened right now. Please check the details and try again.",
    };
  }
  if (data == null) {
    return {
      ok: false,
      message: "This milling run couldn't be opened right now. Please try again.",
    };
  }
  return { ok: true, runId: Number(data) };
}
