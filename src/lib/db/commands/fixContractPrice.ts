import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for fixing a differential contract line's "C" leg (P3-S1;
 * ADR-002 — all writes flow through a SECURITY DEFINER command RPC). The single write
 * door is `fix_contract_price(p_contract_line_id bigint, p_idempotency_key text)` —
 * tenant-clamped, idempotent on a tenant-qualified key. The RPC reads the P3-S0
 * `v_ice_c_latest` "C" mark, computes `unit_price = (C + differential_cents/100) ×
 * convert_qty(1,'kg','[lb]')` (the convert_qty-backed lb→kg factor — NEVER a 2.2046
 * literal), flips the contract to 'fixed', and appends a `'price_fixed'` lot_event.
 * It refuses to fix a line whose reservation was cancelled (no phantom kg).
 *
 * Symmetric twin of the read ports: a pure validator plus a thin command that calls
 * the one `.rpc()` it needs (the `FixContractPriceStore` port), testable with no DB.
 */

/** Validated, domain-shaped fixation args (camelCase). */
export interface FixContractPriceInput {
  contractLineId: number;
  idempotencyKey: string;
}

/**
 * Pure validation of a raw fixation request — a real contract-line id + an idempotency
 * key. The differential-only / live-mark / cancelled-reservation gates are the RPC's
 * job (the real enforcement); this is the friendly pre-check.
 */
export function validateFixContractPrice(
  raw: Record<string, unknown>,
): ValidationResult<FixContractPriceInput> {
  const errors: Record<string, string> = {};

  const contractLineId = toNumber(raw.contractLineId);
  if (
    contractLineId === null ||
    !Number.isInteger(contractLineId) ||
    contractLineId <= 0
  ) {
    errors.contractLineId = "Choose a line to fix.";
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: { contractLineId: contractLineId as number, idempotencyKey },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method `fix_contract_price` needs. */
export interface FixContractPriceStore {
  rpc(
    fn: "fix_contract_price",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the fixed line's id, or friendly/labelled errors. */
export type FixContractPriceResult =
  | { ok: true; lineId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `fix_contract_price` onto a family-readable sentence.
 * Covers no-live-mark, already-fixed / not-differential, and the cancelled-reservation
 * (no phantom kg) rejections. Returns null for anything unrecognised so the caller can
 * fall back to a generic labelled message.
 */
export function friendlyFixContractPriceError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  // No live "C" mark for the line's contract month.
  if (/no ice .*mark|no live mark|no .*c.* mark|contract month/.test(m)) {
    return "There's no live ICE \"C\" mark for this line's contract month yet. Post a current mark first, then fix.";
  }
  // The line's reservation was cancelled — no phantom kg.
  if (/cancelled|canceled|phantom|no reservation/.test(m)) {
    return "This line's reservation was cancelled — it can't be fixed. Re-add the line first.";
  }
  // Already fixed / not a differential line.
  if (/already fixed|cannot be fixed|not differential|fixed leg|not a differential/.test(m)) {
    return "This line can't be fixed — it may already be fixed, or it isn't a differential (commodity) line.";
  }
  // Unknown line.
  if (error.code === "23503" || /unknown line|foreign key|not found/.test(m)) {
    return "That line couldn't be found. Refresh and try again.";
  }
  return null;
}

/**
 * Validate then fix: calls `fix_contract_price` exactly once with the snake_case
 * argument envelope. Bad input never reaches the RPC (friendly errors); the gates
 * (no live mark, already fixed, cancelled reservation) surface as CLEAN sentences,
 * any other failure surfaces labelled. Exactly-once on `idempotencyKey`.
 */
export async function fixContractPrice(
  store: FixContractPriceStore,
  raw: Record<string, unknown>,
): Promise<FixContractPriceResult> {
  const parsed = validateFixContractPrice(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("fix_contract_price", {
    p_contract_line_id: parsed.data.contractLineId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyFixContractPriceError(error) ??
        "This line couldn't be fixed right now. Please try again.",
    };
  }
  if (data == null) {
    return { ok: false, message: "This line couldn't be fixed right now. Please try again." };
  }
  return { ok: true, lineId: Number(data) };
}
