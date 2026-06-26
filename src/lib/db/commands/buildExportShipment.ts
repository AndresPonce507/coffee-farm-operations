import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for minting an EXPORT SHIPMENT (P3-S3 — the headline
 * export-doc-pack slice; ADR-002 — every write flows through a SECURITY DEFINER
 * RPC). One consignment per contract; the gap-free `JC-S-NNNN` number is minted
 * inside the `build_export_shipment` RPC under a per-tenant advisory lock (no
 * client-side counter). The port/bag-weight are OPTIONAL — blank forwards null so
 * the RPC applies the house defaults ('Balboa, PA' / 30 kg). The idempotency key is
 * REQUIRED (the action/form layer mints a stable token) — a replay returns the same
 * shipment id with no second mint.
 *
 * Symmetric twin of the read port: a pure validator (`validateBuildExportShipment`)
 * + a friendly-error mapper + a thin command (`buildExportShipment`) that calls the
 * one `.rpc()` it needs (the `BuildExportShipmentStore` port), testable with no DB.
 */

/** Validated, domain-shaped build args (camelCase). */
export interface BuildExportShipmentInput {
  /** The contract this consignment ships (the `contract_id` FK). */
  contractId: number;
  /** Port of loading; null ⇒ the RPC defaults to 'Balboa, PA'. */
  portOfLoading: string | null;
  /** Bag weight (kg); null ⇒ the RPC defaults to 30. The `> 0` CHECK guards it. */
  bagWeightKg: number | null;
  /** Exactly-once anchor — the DB dedupes on a tenant-qualified key. */
  idempotencyKey: string;
}

/** Is `v` blank (absent / empty after trim)? */
function isBlank(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "");
}

/**
 * Pure validation of a raw build request — mirrors the `build_export_shipment`
 * constraints so errors surface before the round-trip (a contract is required; a
 * supplied bag weight must be > 0). The tenant clamp + the contract-exists check
 * are the actual enforcement (ADR-002).
 */
export function validateBuildExportShipment(
  raw: Record<string, unknown>,
): ValidationResult<BuildExportShipmentInput> {
  const errors: Record<string, string> = {};

  const contractId = toNumber(raw.contractId);
  if (contractId === null || contractId <= 0) {
    errors.contractId = "Choose a contract to ship.";
  }

  // port: optional; blank ⇒ null (the RPC defaults to 'Balboa, PA').
  const portOfLoading = trimmed(raw.portOfLoading) || null;

  // bag weight: optional; blank ⇒ null (RPC default 30); a value must be > 0.
  let bagWeightKg: number | null = null;
  if (!isBlank(raw.bagWeightKg)) {
    const w = toNumber(raw.bagWeightKg);
    if (w === null || w <= 0) {
      errors.bagWeightKg = "Bag weight (kg) must be greater than 0.";
    } else {
      bagWeightKg = w;
    }
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      contractId: contractId as number,
      portOfLoading,
      bagWeightKg,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint shipment id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method the command needs. */
export interface BuildExportShipmentStore {
  rpc(
    fn: "build_export_shipment",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the shipment id, or friendly/labelled errors. */
export type BuildExportShipmentResult =
  | { ok: true; shipmentId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `build_export_shipment` onto a family-readable
 * sentence — the family must never see raw PG text (errcodes, the `for tenant`
 * engine suffix). Returns null for anything unrecognised so the caller falls back
 * to a generic labelled message.
 */
export function friendlyBuildExportShipmentError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  if (error.code === "23503" || /unknown contract|foreign key/.test(m)) {
    return "That contract couldn't be found. Pick a signed contract and try again.";
  }
  return null;
}

/**
 * Validate then mint: calls `build_export_shipment` exactly once with the snake_case
 * argument envelope. Bad input never reaches the RPC (friendly errors); a failure
 * surfaces as a clean labelled message (raw Postgres never leaks). Exactly-once on
 * `idempotencyKey` — a replay returns the same shipment id with no second mint.
 */
export async function buildExportShipment(
  store: BuildExportShipmentStore,
  raw: Record<string, unknown>,
): Promise<BuildExportShipmentResult> {
  const parsed = validateBuildExportShipment(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("build_export_shipment", {
    p_contract_id: parsed.data.contractId,
    p_port_of_loading: parsed.data.portOfLoading,
    p_bag_weight_kg: parsed.data.bagWeightKg,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyBuildExportShipmentError(error) ??
        "This shipment couldn't be created right now. Please try again.",
    };
  }
  if (data == null) {
    return {
      ok: false,
      message: "This shipment couldn't be created right now. Please try again.",
    };
  }
  return { ok: true, shipmentId: Number(data) };
}
