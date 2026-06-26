import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for the ONE-WAY golden lock (P3-S10 — roasting; ADR-002). The
 * SECURITY DEFINER `lock_roast_profile` RPC transitions a profile draft→approved
 * (golden), appending a `roast_profile_locked` lot_event — tenant-clamped, idempotent
 * (a replay on an already-golden profile returns its status without re-locking).
 *
 * THE ONE-WAY GUARD (the data layer, not just this command): the status is MONOTONIC
 * (draft < approved < retired); a golden profile can only retire, never re-open — so a
 * re-tune is a NEW version, never a mutation. The RPC RAISES unless the profile is a
 * draft. This command surfaces that rejection as a CLEAN, family-readable sentence.
 *
 * Symmetric twin of the read ports: a pure validator plus a thin command that calls
 * the one `.rpc()` it needs (the `LockRoastProfileStore` port), testable with no
 * database. The idempotency key is REQUIRED.
 */

/** Validated, domain-shaped lock args (camelCase). */
export interface LockRoastProfileInput {
  /** The draft `roast_profiles.id` to lock golden (positive integer). */
  profileId: number;
  /** Exactly-once anchor — the DB dedupes on a tenant-qualified key. */
  idempotencyKey: string;
}

/**
 * Pure validation of a raw lock — mirrors the `lock_roast_profile` precondition (a
 * real profile id). The one-way guard inside the RPC is the actual enforcement.
 */
export function validateLockRoastProfile(
  raw: Record<string, unknown>,
): ValidationResult<LockRoastProfileInput> {
  const errors: Record<string, string> = {};

  const profileId = toNumber(raw.profileId);
  if (profileId === null || !Number.isInteger(profileId) || profileId <= 0) {
    errors.profileId = "Choose a roast profile to lock.";
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, data: { profileId: profileId as number, idempotencyKey } };
}

/** The PostgREST shape the command returns from `.rpc()` (the new status text). */
interface RpcResult {
  data: string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method `lock_roast_profile` needs. */
export interface LockRoastProfileStore {
  rpc(
    fn: "lock_roast_profile",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the locked status ('approved'), or friendly/labelled errors. */
export type LockRoastProfileResult =
  | { ok: true; status: string }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `lock_roast_profile` onto a family-readable sentence —
 * the one-way guard is the real enforcement, but the family must never see raw PG text
 * (the `roast_profiles` table name, errcodes). Returns null for anything unrecognised
 * so the caller can fall back to a generic message.
 */
export function friendlyLockRoastProfileError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  // THE ONE-WAY GUARD — only a draft can be locked golden.
  if (/only a draft|versioning is one-way|locked golden/.test(m)) {
    return "Only a draft profile can be locked golden. Once golden, a profile is versioned, never changed — re-tune it as a new version instead.";
  }
  // Unknown profile.
  if (error.code === "23503" || /unknown roast profile|foreign key/.test(m)) {
    return "That roast profile couldn't be found. Refresh and try again.";
  }
  return null;
}

/**
 * Validate then lock: calls `lock_roast_profile` exactly once with the snake_case
 * argument envelope. Bad input never reaches the RPC (friendly errors); the one-way
 * guard rejection surfaces as a CLEAN sentence, any other failure surfaces labelled.
 * Exactly-once on `idempotencyKey` — a replay returns the same 'approved' status.
 */
export async function lockRoastProfile(
  store: LockRoastProfileStore,
  raw: Record<string, unknown>,
): Promise<LockRoastProfileResult> {
  const parsed = validateLockRoastProfile(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("lock_roast_profile", {
    p_profile_id: parsed.data.profileId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyLockRoastProfileError(error) ??
        "This roast profile couldn't be locked right now. Please try again.",
    };
  }
  if (data == null) {
    return {
      ok: false,
      message: "This roast profile couldn't be locked right now. Please try again.",
    };
  }
  return { ok: true, status: data };
}
