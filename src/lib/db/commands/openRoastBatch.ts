import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for opening a roast batch (P3-S10 — roasting; ADR-002 — every
 * write flows through a SECURITY DEFINER command RPC). `open_roast_batch` is THE
 * KEYSTONE with two data-layer gates:
 *   (1) the profile must be GOLDEN ('approved') — can't roast against a draft/retired
 *       curve;
 *   (2) the green draw is committed by inserting a `lot_shipments` row, so the SHIPPED
 *       `prevent_oversell` trigger physically rejects roasting green that is already
 *       sold/reserved to a buyer (or more green than the lot's ATP). The money
 *       guarantee is REUSED, never rebuilt (§0.2 names "a roast draw" explicitly).
 * The RPC appends a `roast_batch_opened` lot_event and is idempotent on a tenant-
 * qualified key (a replay returns the same batch id, no second draw).
 *
 * Symmetric twin of the read ports: a pure validator plus a thin command that calls
 * the one `.rpc()` it needs (the `OpenRoastBatchStore` port), testable with no
 * database. Its load-bearing job is translating BOTH keystone rejections (not-golden,
 * oversell) into CLEAN, family-readable sentences (raw Postgres text never leaks).
 * The idempotency key is REQUIRED.
 */

/** Validated, domain-shaped open-batch args (camelCase). */
export interface OpenRoastBatchInput {
  /** The green lot to roast (composite-FK'd to green_lots / lots). */
  greenLotCode: string;
  /** The GOLDEN profile to roast against (`roast_profiles.id`, positive integer). */
  profileId: number;
  /** The roaster running the batch (`roasters.id`, positive integer). */
  roasterId: number;
  /** Green mass drawn to the roaster, kg (the `green_in_kg > 0` CHECK + ATP gate). */
  greenInKg: number;
  /** Exactly-once anchor — the DB dedupes on a tenant-qualified key. */
  idempotencyKey: string;
}

/** A positive integer id (the bigint identity columns). */
function isPositiveIntId(n: number | null): n is number {
  return n !== null && Number.isInteger(n) && n > 0;
}

/**
 * Pure validation of a raw open-batch request — mirrors the `roast_batches`
 * preconditions (`green_in_kg > 0`, real profile/roaster ids) so errors surface before
 * the round-trip. The golden-profile gate + the prevent_oversell trigger inside the
 * RPC are the actual enforcement, surfaced as friendly messages below.
 */
export function validateOpenRoastBatch(
  raw: Record<string, unknown>,
): ValidationResult<OpenRoastBatchInput> {
  const errors: Record<string, string> = {};

  const greenLotCode = trimmed(raw.greenLotCode);
  if (!greenLotCode) errors.greenLotCode = "Choose a green lot to roast.";

  const profileId = toNumber(raw.profileId);
  if (!isPositiveIntId(profileId)) errors.profileId = "Choose a roast profile.";

  const roasterId = toNumber(raw.roasterId);
  if (!isPositiveIntId(roasterId)) errors.roasterId = "Choose a roaster.";

  const greenInKg = toNumber(raw.greenInKg);
  if (greenInKg === null || greenInKg <= 0) {
    errors.greenInKg = "Green mass (kg) must be greater than 0.";
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      greenLotCode,
      profileId: profileId as number,
      roasterId: roasterId as number,
      greenInKg: greenInKg as number,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint batch id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method `open_roast_batch` needs. */
export interface OpenRoastBatchStore {
  rpc(
    fn: "open_roast_batch",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the batch id, or friendly/labelled errors. */
export type OpenRoastBatchResult =
  | { ok: true; batchId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `open_roast_batch` onto a family-readable sentence —
 * the golden gate + prevent_oversell trigger are the real guards, but the family must
 * never see raw PG text (the `available-to-promise` engine phrase, errcodes, the
 * `(approved)` enum literal). Returns null for anything unrecognised so the caller can
 * fall back to a generic message. Ordering: the golden gate and the oversell rejection
 * use distinct keywords, so order is safe.
 */
export function friendlyOpenRoastBatchError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  // GATE (1): the profile isn't locked golden.
  if (/golden|can be roasted against/.test(m)) {
    return "This roast profile isn't locked golden yet. Lock the profile before roasting against it.";
  }
  // GATE (2): the money guarantee — roasting green that's already sold/reserved (or
  // more than the lot's ATP). Covers the RPC's friendly pre-check AND the trigger.
  if (/oversell|available-to-promise|already sold|already reserved|sold\/reserved/.test(m)) {
    return "There isn't enough green available to roast that much — some of this lot is already sold or reserved. Lower the batch size or pick another lot.";
  }
  // Unknown roaster.
  if (/unknown roaster/.test(m)) {
    return "That roaster couldn't be found. Pick a roaster and try again.";
  }
  // Unknown green lot (the composite FK / the RPC's own raise).
  if (error.code === "23503" || /unknown green lot|foreign key/.test(m)) {
    return "That green lot couldn't be found. Pick a green lot and try again.";
  }
  return null;
}

/**
 * Validate then open: calls `open_roast_batch` exactly once with the snake_case
 * argument envelope. Bad input never reaches the RPC (friendly errors); BOTH keystone
 * rejections (not-golden, oversell) surface as CLEAN sentences, any other failure
 * surfaces labelled. Exactly-once on `idempotencyKey` — a replay returns the same
 * batch id with no second green draw.
 */
export async function openRoastBatch(
  store: OpenRoastBatchStore,
  raw: Record<string, unknown>,
): Promise<OpenRoastBatchResult> {
  const parsed = validateOpenRoastBatch(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("open_roast_batch", {
    p_green_lot_code: parsed.data.greenLotCode,
    p_profile_id: parsed.data.profileId,
    p_roaster_id: parsed.data.roasterId,
    p_green_in_kg: parsed.data.greenInKg,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyOpenRoastBatchError(error) ??
        "This roast batch couldn't be opened right now. Please check the details and try again.",
    };
  }
  if (data == null) {
    return {
      ok: false,
      message: "This roast batch couldn't be opened right now. Please try again.",
    };
  }
  return { ok: true, batchId: Number(data) };
}
