import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for posting a reserve auction comp (P3-S0). The
 * `auction_comps` ledger is APPEND-ONLY (immutability triggers reject
 * UPDATE/DELETE): a correction is a NEW comp, never an edit. The single write
 * door is `record_auction_comp` — tenant-clamped, idempotent on a tenant-qualified
 * key. These public Best-of-Panama / Cup-of-Excellence results are the reserve
 * price story the model clamps quotes to (the $30,204/kg washed-Geisha anchor).
 *
 * Symmetric twin of the read ports: a pure validator (`validateRecordAuctionComp`)
 * plus a thin command (`recordAuctionComp`) that calls the one `.rpc()` method it
 * needs (the `RecordAuctionCompStore` port), testable with no database. Only
 * `auctionName` + `priceUsdPerKg` are required; the descriptive fields are optional
 * and forwarded as null when blank. The idempotency key is REQUIRED (the action
 * layer mints a stable token).
 */

/** Validated, domain-shaped comp args (camelCase). Optional fields are null when blank. */
export interface RecordAuctionCompInput {
  auctionName: string;
  lotLabel: string | null;
  variety: string | null;
  process: string | null;
  /** Cup score 0–100 (the `cup_score` CHECK), or null when unknown. */
  cupScore: number | null;
  /** The hammer price, USD per kg (the `price_usd_per_kg > 0` CHECK). */
  priceUsdPerKg: number;
  resultYear: number | null;
  idempotencyKey: string;
}

/** Is `v` blank (absent / empty after trim)? Optional fields treat blank as null. */
function isBlank(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "");
}

/** Trim to a non-empty string, or null when blank. */
function optionalText(v: unknown): string | null {
  const t = trimmed(v);
  return t === "" ? null : t;
}

/**
 * Pure validation of a raw comp — mirrors the `record_auction_comp` / `auction_comps`
 * constraints (auction name required, price > 0, cup score 0–100) so errors surface
 * before the round-trip. The append-only triggers + tenant clamp are the real
 * enforcement (ADR-002).
 */
export function validateRecordAuctionComp(
  raw: Record<string, unknown>,
): ValidationResult<RecordAuctionCompInput> {
  const errors: Record<string, string> = {};

  const auctionName = trimmed(raw.auctionName);
  if (!auctionName) errors.auctionName = "An auction name is required.";

  const priceUsdPerKg = toNumber(raw.priceUsdPerKg);
  if (priceUsdPerKg === null || priceUsdPerKg <= 0) {
    errors.priceUsdPerKg = "The comp price ($/kg) must be greater than 0.";
  }

  // cup score: optional, but if provided must be in [0, 100].
  let cupScore: number | null = null;
  if (!isBlank(raw.cupScore)) {
    const c = toNumber(raw.cupScore);
    if (c === null || c < 0 || c > 100) {
      errors.cupScore = "Cup score must be between 0 and 100.";
    } else {
      cupScore = c;
    }
  }

  // result year: optional, but if provided must be a whole year.
  let resultYear: number | null = null;
  if (!isBlank(raw.resultYear)) {
    const y = toNumber(raw.resultYear);
    if (y === null || !Number.isInteger(y)) {
      errors.resultYear = "Enter a four-digit year.";
    } else {
      resultYear = y;
    }
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      auctionName,
      lotLabel: optionalText(raw.lotLabel),
      variety: optionalText(raw.variety),
      process: optionalText(raw.process),
      cupScore,
      priceUsdPerKg: priceUsdPerKg as number,
      resultYear,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port the command depends on — exactly the one `.rpc()` method
 *  `record_auction_comp` needs. */
export interface RecordAuctionCompStore {
  rpc(
    fn: "record_auction_comp",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the posted comp's id, or friendly/labelled errors. */
export type RecordAuctionCompResult =
  | { ok: true; compId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Validate then post: calls `record_auction_comp` exactly once with the snake_case
 * argument envelope. Bad input never reaches the RPC (friendly errors); a failure
 * surfaces labelled (raw Postgres text never leaks). Exactly-once on `idempotencyKey`.
 */
export async function recordAuctionComp(
  store: RecordAuctionCompStore,
  raw: Record<string, unknown>,
): Promise<RecordAuctionCompResult> {
  const parsed = validateRecordAuctionComp(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("record_auction_comp", {
    p_auction_name: parsed.data.auctionName,
    p_lot_label: parsed.data.lotLabel,
    p_variety: parsed.data.variety,
    p_process: parsed.data.process,
    p_cup_score: parsed.data.cupScore,
    p_price_usd_per_kg: parsed.data.priceUsdPerKg,
    p_result_year: parsed.data.resultYear,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return { ok: false, message: `Couldn't post the auction comp: ${error.message}` };
  }
  if (data == null) {
    return { ok: false, message: "The auction comp couldn't be posted. Please try again." };
  }
  return { ok: true, compId: Number(data) };
}
