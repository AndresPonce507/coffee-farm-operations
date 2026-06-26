import { isISODate, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for creating an auction header (P3-S4 — specialty auctions,
 * the highest-multiplier channel; ADR-002 — all writes flow through a SECURITY
 * DEFINER command RPC). The single write door is `create_auction` — tenant-clamped,
 * idempotent on a tenant-qualified key. `platform` must be one of the
 * `auction_platform` enum values; `name` is required; the two deadlines are
 * optional (a blank forwards null, the column is nullable).
 *
 * Symmetric twin of the read ports: a pure validator (`validateCreateAuction`, the
 * friendly-error seam) plus a thin command (`createAuction`) that calls the single
 * `.rpc()` method it needs (the `CreateAuctionStore` port) so it is testable against
 * a fake store with no database. The idempotency key is REQUIRED — the action/form
 * layer mints a stable token. Mirrors recordAuctionComp.
 */

/** The `auction_platform` enum — the four channels a lot can be entered into. */
export const AUCTION_PLATFORMS = [
  "best_of_panama",
  "cup_of_excellence",
  "algrano",
  "private",
] as const;
export type AuctionPlatform = (typeof AUCTION_PLATFORMS)[number];

/** Validated, domain-shaped auction args (camelCase). Deadlines null when blank. */
export interface CreateAuctionInput {
  platform: AuctionPlatform;
  name: string;
  /** ISO entry deadline; null ⇒ none set (the column is nullable). */
  entryDeadline: string | null;
  /** ISO scoring deadline; null ⇒ none set. */
  scoringDeadline: string | null;
  idempotencyKey: string;
}

/** Is `v` one of the recognised auction platforms? (mirrors the enum) */
function isAuctionPlatform(v: string): v is AuctionPlatform {
  return (AUCTION_PLATFORMS as readonly string[]).includes(v);
}

/** Is `v` a recognised ISO-8601 timestamp (e.g. "2026-03-01T00:00:00.000Z")? */
function isISOTimestamp(v: string): boolean {
  if (v === "") return false;
  const t = Date.parse(v);
  return Number.isFinite(t) && /\d{4}-\d{2}-\d{2}T/.test(v);
}

/** Validate an optional deadline: blank → null; otherwise must parse as an ISO
 *  date or timestamp. Returns `{ value }` on success, `{ error: true }` on a
 *  malformed non-blank value. */
function optionalDeadline(
  v: unknown,
): { value: string | null } | { error: true } {
  const raw = trimmed(v);
  if (!raw) return { value: null };
  if (!isISOTimestamp(raw) && !isISODate(raw)) return { error: true };
  return { value: raw };
}

/**
 * Pure validation of a raw auction — mirrors the `create_auction` / `auctions`
 * constraints (the platform enum, a required name) so errors surface before the
 * round-trip. The tenant clamp + idempotency are the actual enforcement (ADR-002).
 */
export function validateCreateAuction(
  raw: Record<string, unknown>,
): ValidationResult<CreateAuctionInput> {
  const errors: Record<string, string> = {};

  const platform = trimmed(raw.platform);
  if (!platform) {
    errors.platform = "Choose an auction platform.";
  } else if (!isAuctionPlatform(platform)) {
    errors.platform = "Choose a valid auction platform.";
  }

  const name = trimmed(raw.name);
  if (!name) errors.name = "An auction name is required.";

  const entry = optionalDeadline(raw.entryDeadline);
  if ("error" in entry) errors.entryDeadline = "Enter a valid entry deadline.";

  const scoring = optionalDeadline(raw.scoringDeadline);
  if ("error" in scoring) errors.scoringDeadline = "Enter a valid scoring deadline.";

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      platform: platform as AuctionPlatform,
      name,
      entryDeadline: "error" in entry ? null : entry.value,
      scoringDeadline: "error" in scoring ? null : scoring.value,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method `create_auction` needs. */
export interface CreateAuctionStore {
  rpc(
    fn: "create_auction",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the auction's id, or friendly/labelled errors. */
export type CreateAuctionResult =
  | { ok: true; auctionId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Validate then create: calls `create_auction` exactly once with the snake_case
 * argument envelope the SECURITY DEFINER RPC expects. Bad input never reaches the
 * RPC (friendly errors); a failure surfaces as a labelled message (raw Postgres
 * text never leaks). Exactly-once on `idempotencyKey`.
 */
export async function createAuction(
  store: CreateAuctionStore,
  raw: Record<string, unknown>,
): Promise<CreateAuctionResult> {
  const parsed = validateCreateAuction(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("create_auction", {
    p_platform: parsed.data.platform,
    p_name: parsed.data.name,
    p_entry_deadline: parsed.data.entryDeadline,
    p_scoring_deadline: parsed.data.scoringDeadline,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return { ok: false, message: `Couldn't create the auction: ${error.message}` };
  }
  if (data == null) {
    return { ok: false, message: "The auction couldn't be created. Please try again." };
  }
  return { ok: true, auctionId: Number(data) };
}
