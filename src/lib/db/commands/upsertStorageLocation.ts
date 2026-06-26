import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for the ONLY `storage_locations` writer (P3-S20 — the
 * controlled-environment config; ADR-002 — every write flows through a SECURITY
 * DEFINER command RPC). `upsert_storage_location` is idempotent on a tenant-qualified
 * key and tenant-clamped: a new code inserts (the RPC keeps the safe defaults for
 * any band left blank), an existing code updates its bands. A blank numeric is
 * forwarded as `null` so the RPC's `coalesce(...)` preserves the prior/default value
 * rather than zeroing a band.
 *
 * Symmetric twin of the read ports: a pure validator (`validateUpsertStorageLocation`,
 * the friendly-error seam, mirroring the band-ordering + aw ∈ (0,1] CHECKs) plus a
 * thin command (`upsertStorageLocation`) that calls the one `.rpc()` it needs (the
 * `UpsertStorageLocationStore` port) so it is testable with no database. The
 * idempotency key is REQUIRED — the action/form layer mints a stable token.
 */

/** Validated, domain-shaped location args (camelCase). Blank bands are null. */
export interface UpsertStorageLocationInput {
  code: string;
  name: string;
  tempMinC: number | null;
  tempMaxC: number | null;
  rhMinPct: number | null;
  rhMaxPct: number | null;
  awMax: number | null;
  idempotencyKey: string;
}

/** Read a band field: blank ⇒ null (the RPC keeps the default); else a number. */
function optionalNumber(
  raw: unknown,
  key: string,
  errors: Record<string, string>,
  label: string,
): number | null {
  if (trimmed(raw) === "") return null;
  const v = toNumber(raw);
  if (v === null) {
    errors[key] = `${label} must be a number.`;
    return null;
  }
  return v;
}

/**
 * Pure validation of a raw location — mirrors the `storage_locations` CHECKs (the
 * band ordering temp_min ≤ temp_max / rh_min ≤ rh_max; aw_max ∈ (0,1]) so errors
 * surface before the round-trip. The tenant clamp + idempotent upsert are the real
 * enforcement (ADR-002, pinned by the migration's PGlite tests).
 */
export function validateUpsertStorageLocation(
  raw: Record<string, unknown>,
): ValidationResult<UpsertStorageLocationInput> {
  const errors: Record<string, string> = {};

  const code = trimmed(raw.code);
  if (!code) errors.code = "A location code is required.";

  const name = trimmed(raw.name);
  if (!name) errors.name = "A location name is required.";

  const tempMinC = optionalNumber(raw.tempMinC, "tempMinC", errors, "Minimum temperature");
  const tempMaxC = optionalNumber(raw.tempMaxC, "tempMaxC", errors, "Maximum temperature");
  const rhMinPct = optionalNumber(raw.rhMinPct, "rhMinPct", errors, "Minimum humidity");
  const rhMaxPct = optionalNumber(raw.rhMaxPct, "rhMaxPct", errors, "Maximum humidity");
  const awMax = optionalNumber(raw.awMax, "awMax", errors, "Water-activity ceiling");

  // band ordering (mirrors storage_locations_band_chk)
  if (tempMinC !== null && tempMaxC !== null && tempMinC > tempMaxC) {
    errors.tempMaxC = "Maximum temperature must be at least the minimum.";
  }
  if (rhMinPct !== null && rhMaxPct !== null && rhMinPct > rhMaxPct) {
    errors.rhMaxPct = "Maximum humidity must be at least the minimum.";
  }
  // aw ceiling (mirrors aw_max > 0 and aw_max <= 1)
  if (awMax !== null && (awMax <= 0 || awMax > 1)) {
    errors.awMax = "The water-activity ceiling must be between 0 and 1.";
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: { code, name, tempMinC, tempMaxC, rhMinPct, rhMaxPct, awMax, idempotencyKey },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` `upsert_storage_location` needs. */
export interface UpsertStorageLocationStore {
  rpc(
    fn: "upsert_storage_location",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the location's id, or friendly/labelled errors. */
export type UpsertStorageLocationResult =
  | { ok: true; locationId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Validate then upsert: calls `upsert_storage_location` exactly once with the
 * snake_case argument envelope. Bad input never reaches the RPC (friendly errors);
 * a failure surfaces as a labelled message. Exactly-once on `idempotencyKey`.
 */
export async function upsertStorageLocation(
  store: UpsertStorageLocationStore,
  raw: Record<string, unknown>,
): Promise<UpsertStorageLocationResult> {
  const parsed = validateUpsertStorageLocation(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("upsert_storage_location", {
    p_code: parsed.data.code,
    p_name: parsed.data.name,
    p_temp_min_c: parsed.data.tempMinC,
    p_temp_max_c: parsed.data.tempMaxC,
    p_rh_min_pct: parsed.data.rhMinPct,
    p_rh_max_pct: parsed.data.rhMaxPct,
    p_aw_max: parsed.data.awMax,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return { ok: false, message: `Couldn't save the storage location: ${error.message}` };
  }
  if (data == null) {
    return { ok: false, message: "The storage location couldn't be saved. Please try again." };
  }
  return { ok: true, locationId: Number(data) };
}
