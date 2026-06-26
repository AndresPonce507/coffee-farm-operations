import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for loading an EXPORT SHIPMENT LINE (P3-S3; ADR-002 — every
 * write flows through a SECURITY DEFINER RPC). Loading a contract line onto a
 * shipment ALSO inserts a `lot_shipments` claim (net_kg = bags × the shipment's
 * bag_weight) INSIDE the `add_shipment_line` RPC, so the EXISTING prevent_oversell
 * trigger guards physical over-shipment for free — there is NO parallel counter and
 * `green_lots_atp.shipped_kg` stays the single truth. The RPC also enforces that the
 * shipment is still 'building' and that the contract line belongs to the shipment's
 * contract (a shipment can't load a lot it didn't reserve).
 *
 * THE GUARDS the data layer (not this command) enforces: oversell (prevent_oversell),
 * an open QC-hold (_prevent_held_lot_commit), a non-'building' shipment, a
 * wrong-contract line. This command's job is the friendly-validation seam (bags must
 * be a WHOLE number > 0 — the integer column + `bags > 0` CHECK) and translating those
 * rejections into clean, family-readable sentences. The idempotency key is REQUIRED.
 */

/** Validated, domain-shaped load args (camelCase). */
export interface AddShipmentLineInput {
  /** The shipment to load (the `export_shipments.id`). */
  shipmentId: number;
  /** The contract line being shipped (the `contract_lines.id`). */
  contractLineId: number;
  /** Whole bag count (> 0). net_kg = bags × the shipment's bag_weight. */
  bags: number;
  /** Exactly-once anchor — the DB dedupes on a tenant-qualified key (no second draw). */
  idempotencyKey: string;
}

/**
 * Pure validation of a raw load request — mirrors the `add_shipment_line` constraints
 * so errors surface before the round-trip (bags is a positive INTEGER; the oversell /
 * hold / status / contract guards are the real enforcement, ADR-002).
 */
export function validateAddShipmentLine(
  raw: Record<string, unknown>,
): ValidationResult<AddShipmentLineInput> {
  const errors: Record<string, string> = {};

  const shipmentId = toNumber(raw.shipmentId);
  if (shipmentId === null || shipmentId <= 0) {
    errors.shipmentId = "Choose a shipment.";
  }

  const contractLineId = toNumber(raw.contractLineId);
  if (contractLineId === null || contractLineId <= 0) {
    errors.contractLineId = "Choose a contract line to load.";
  }

  const bags = toNumber(raw.bags);
  if (bags === null || bags <= 0) {
    errors.bags = "Bag count must be greater than 0.";
  } else if (!Number.isInteger(bags)) {
    errors.bags = "Bag count must be a whole number.";
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      shipmentId: shipmentId as number,
      contractLineId: contractLineId as number,
      bags: bags as number,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint line id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method the command needs. */
export interface AddShipmentLineStore {
  rpc(
    fn: "add_shipment_line",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the line id, or friendly/labelled errors. */
export type AddShipmentLineResult =
  | { ok: true; lineId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `add_shipment_line` onto a family-readable sentence
 * — the data-layer guards are the real enforcement, but the family must never see
 * raw PG text (the `oversell guard:` / `qc-hold:` engine prefixes, errcodes). Returns
 * null for anything unrecognised so the caller falls back to a generic message.
 */
export function friendlyAddShipmentLineError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  // The money guarantee: not enough available-to-promise for this many bags.
  if (/oversell guard|available-to-promise|would exceed/.test(m)) {
    return "There isn't enough available coffee in that lot to ship this many bags. Reduce the bag count and try again.";
  }
  // An open QC-hold blocks reserving/shipping the lot.
  if (/qc-hold|under an open qc/.test(m)) {
    return "That lot is under a QC hold and can't be shipped until the hold is released.";
  }
  // The shipment is no longer 'building' (docs issued / departed / closed).
  if (/must be building|cannot load more lines/.test(m)) {
    return "This shipment is already past loading — you can't add more lines.";
  }
  // The contract line isn't on this shipment's contract.
  if (/does not belong|did not reserve/.test(m)) {
    return "That line isn't on this shipment's contract. Pick a line from the same contract.";
  }
  // Unknown shipment / contract line.
  if (error.code === "23503" || /unknown shipment|unknown contract line|foreign key/.test(m)) {
    return "That shipment or line couldn't be found. Refresh and try again.";
  }
  return null;
}

/**
 * Validate then load: calls `add_shipment_line` exactly once with the snake_case
 * argument envelope. Bad input never reaches the RPC (friendly errors); the
 * data-layer guards (oversell, QC-hold, status, wrong-contract line) surface as
 * CLEAN, family-readable sentences; any other failure surfaces labelled. Exactly-once
 * on `idempotencyKey` — a replay returns the same line id with no second draw.
 */
export async function addShipmentLine(
  store: AddShipmentLineStore,
  raw: Record<string, unknown>,
): Promise<AddShipmentLineResult> {
  const parsed = validateAddShipmentLine(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("add_shipment_line", {
    p_shipment_id: parsed.data.shipmentId,
    p_contract_line_id: parsed.data.contractLineId,
    p_bags: parsed.data.bags,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyAddShipmentLineError(error) ??
        "This line couldn't be loaded right now. Please check the details and try again.",
    };
  }
  if (data == null) {
    return {
      ok: false,
      message: "This line couldn't be loaded right now. Please try again.",
    };
  }
  return { ok: true, lineId: Number(data) };
}
