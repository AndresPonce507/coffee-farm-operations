import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for adding a line to a draft sales contract (P3-S1; ADR-002 —
 * all writes flow through a SECURITY DEFINER command RPC). The load-bearing step
 * (inside `add_contract_line`) inserts a `lot_reservations` row keyed buyer=contract_no
 * FIRST, so the EXISTING `prevent_oversell` BEFORE-INSERT trigger fires before the
 * line commits — the money guarantee is REUSED, not rebuilt (no parallel counter).
 * An over-commit rolls the WHOLE transaction back. The RPC requires the contract in
 * `status='draft'` and is idempotent on a tenant-qualified key.
 *
 * A line is EITHER a fixed leg (`unit_price`, $/kg) OR a differential leg
 * (`differential_cents` over the "C", cents/lb, + `ice_c_contract_month`). The
 * `_contract_line_basis_chk` trigger rejects a reserve-mandatory lot on a differential
 * contract. This command pins the friendly mapping of those rejections.
 *
 * Symmetric twin of the read ports: a pure validator plus a thin command that calls
 * the one `.rpc()` it needs (the `AddContractLineStore` port), testable with no DB.
 */

/** Validated, domain-shaped contract-line args (camelCase). */
export interface AddContractLineInput {
  contractId: number;
  greenLotCode: string;
  /** Mass to commit (kg) — the `kg > 0` CHECK guards it. */
  kg: number;
  /** Fixed-leg unit price ($/kg); null ⇒ a differential line. */
  unitPrice: number | null;
  /** Differential over the "C" (cents/lb); may be negative (a grade discount); null ⇒ a fixed line. */
  differentialCents: number | null;
  /** ICE "C" contract month for the differential leg; null ⇒ unset. */
  iceCContractMonth: string | null;
  idempotencyKey: string;
}

/** Is `v` blank (absent / empty after trim)? */
function isBlank(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "");
}

/**
 * Pure validation of a raw contract line — mirrors the `contract_lines` constraints
 * (kg NOT NULL CHECK > 0; the fixed/differential leg split) so errors surface before
 * the round-trip. The oversell + basis-check + draft-only triggers are the REAL
 * enforcement. A differential may be negative; a unit price, when present, must be > 0.
 */
export function validateAddContractLine(
  raw: Record<string, unknown>,
): ValidationResult<AddContractLineInput> {
  const errors: Record<string, string> = {};

  const contractId = toNumber(raw.contractId);
  if (contractId === null || !Number.isInteger(contractId) || contractId <= 0) {
    errors.contractId = "Choose a contract.";
  }

  const greenLotCode = trimmed(raw.greenLotCode);
  if (!greenLotCode) errors.greenLotCode = "Choose a green lot.";

  const kg = toNumber(raw.kg);
  if (kg === null || kg <= 0) errors.kg = "Mass (kg) must be greater than 0.";

  // unit_price: optional (a differential line omits it); if present must be > 0.
  let unitPrice: number | null = null;
  if (!isBlank(raw.unitPrice)) {
    const p = toNumber(raw.unitPrice);
    if (p === null || p <= 0) errors.unitPrice = "Unit price must be greater than 0.";
    else unitPrice = p;
  }

  // differential_cents: optional; any finite number (a discount differential is negative).
  let differentialCents: number | null = null;
  if (!isBlank(raw.differentialCents)) {
    const d = toNumber(raw.differentialCents);
    if (d === null) errors.differentialCents = "Differential must be a number.";
    else differentialCents = d;
  }

  const iceCContractMonth = trimmed(raw.iceCContractMonth) || null;

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      contractId: contractId as number,
      greenLotCode,
      kg: kg as number,
      unitPrice,
      differentialCents,
      iceCContractMonth,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint line id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method `add_contract_line` needs. */
export interface AddContractLineStore {
  rpc(
    fn: "add_contract_line",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the line id, or friendly/labelled errors. */
export type AddContractLineResult =
  | { ok: true; lineId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `add_contract_line` onto a family-readable sentence —
 * the triggers/RPC are the real guard, but the family must never see raw PG text (the
 * `oversell guard:` / `basis check:` engine prefixes, errcodes). Returns null for
 * anything unrecognised so the caller can fall back to a generic labelled message.
 */
export function friendlyAddContractLineError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  // The REUSED money guarantee — the reservation insert hit prevent_oversell.
  if (/oversell|available-to-promise|would exceed|no declared mass/.test(m)) {
    return "There isn't enough available-to-promise on this lot to add that quantity. Lower the kilograms or pick another lot.";
  }
  // The basis check — a reserve-only lot can't go on a differential (commodity) contract.
  if (/basis|reserve/.test(m)) {
    return "This lot is reserve-only — it can't be added to a differential (commodity) contract. Use a fixed-price contract instead.";
  }
  // The draft-only status guard.
  if (/draft|not in draft|status/.test(m)) {
    return "Lines can only be added while the contract is a draft. This contract is already signed or closed.";
  }
  // Unknown contract / lot.
  if (error.code === "23503" || /unknown (contract|green lot)|foreign key/.test(m)) {
    return "That contract or green lot couldn't be found. Refresh and try again.";
  }
  return null;
}

/**
 * Validate then add: calls `add_contract_line` exactly once with the snake_case
 * argument envelope. Bad input never reaches the RPC (friendly errors); the
 * fail-closed oversell / basis / draft rejections surface as CLEAN sentences, any
 * other failure surfaces labelled. Exactly-once on `idempotencyKey` — a replay
 * returns the same line id with no second reservation.
 */
export async function addContractLine(
  store: AddContractLineStore,
  raw: Record<string, unknown>,
): Promise<AddContractLineResult> {
  const parsed = validateAddContractLine(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("add_contract_line", {
    p_contract_id: parsed.data.contractId,
    p_green_lot_code: parsed.data.greenLotCode,
    p_kg: parsed.data.kg,
    p_unit_price: parsed.data.unitPrice,
    p_differential_cents: parsed.data.differentialCents,
    p_ice_c_contract_month: parsed.data.iceCContractMonth,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyAddContractLineError(error) ??
        "This line couldn't be added right now. Please check the details and try again.",
    };
  }
  if (data == null) {
    return { ok: false, message: "This line couldn't be added right now. Please try again." };
  }
  return { ok: true, lineId: Number(data) };
}
