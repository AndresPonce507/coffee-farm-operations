import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for posting a jury mark (P3-S4 — specialty auctions; ADR-002 —
 * all writes flow through a SECURITY DEFINER command RPC). The `auction_scoresheets`
 * ledger is APPEND-ONLY (immutability triggers reject UPDATE/DELETE): a correction
 * is a NEW mark, never an edit. The single write door is `record_auction_scoresheet`
 * — tenant-clamped, idempotent on a tenant-qualified key — and it bumps the auction
 * 'entered'→'scored' once jury capture begins. Each row is one juror's score for one
 * CVA attribute; `v_auction_final_score` aggregates the panel average.
 *
 * Symmetric twin of the read ports: a pure validator (`validateRecordAuctionScoresheet`)
 * plus a thin command (`recordAuctionScoresheet`) that calls the one `.rpc()` method
 * it needs (the `RecordAuctionScoresheetStore` port), testable with no database. The
 * idempotency key is REQUIRED. Mirrors recordAuctionComp.
 */

/** Validated, domain-shaped jury-mark args (camelCase). */
export interface RecordAuctionScoresheetInput {
  /** The `auction_entries.id` this mark scores (a positive integer). */
  entryId: number;
  /** The juror who posted the mark. */
  juror: string;
  /** The CVA attribute scored (e.g. "Aroma", "Flavor", "Aftertaste"). */
  attribute: string;
  /** The mark, 0–100 (the `score >= 0 and score <= 100` CHECK). */
  score: number;
  /** Exactly-once anchor — the DB dedupes on a tenant-qualified key. */
  idempotencyKey: string;
}

/**
 * Pure validation of a raw mark — mirrors the `record_auction_scoresheet` /
 * `auction_scoresheets` constraints (a real entry id, a juror, an attribute, score
 * 0–100) so errors surface before the round-trip. The append-only triggers + tenant
 * clamp are the actual enforcement (ADR-002).
 */
export function validateRecordAuctionScoresheet(
  raw: Record<string, unknown>,
): ValidationResult<RecordAuctionScoresheetInput> {
  const errors: Record<string, string> = {};

  const entryId = toNumber(raw.entryId);
  if (entryId === null || !Number.isInteger(entryId) || entryId <= 0) {
    errors.entryId = "Choose an auction entry to score.";
  }

  const juror = trimmed(raw.juror);
  if (!juror) errors.juror = "A juror is required.";

  const attribute = trimmed(raw.attribute);
  if (!attribute) errors.attribute = "An attribute is required.";

  // score is REQUIRED — a blank value (which would coerce to 0) is rejected, not
  // silently treated as a 0 mark.
  const scoreBlank = raw.score == null || trimmed(raw.score) === "";
  const score = toNumber(raw.score);
  if (scoreBlank || score === null || score < 0 || score > 100) {
    errors.score = "The score must be between 0 and 100.";
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      entryId: entryId as number,
      juror,
      attribute,
      score: score as number,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint mark id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method
 *  `record_auction_scoresheet` needs. */
export interface RecordAuctionScoresheetStore {
  rpc(
    fn: "record_auction_scoresheet",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the posted mark's id, or friendly/labelled errors. */
export type RecordAuctionScoresheetResult =
  | { ok: true; scoresheetId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Validate then post: calls `record_auction_scoresheet` exactly once with the
 * snake_case argument envelope. Bad input never reaches the RPC (friendly errors); a
 * failure surfaces labelled (raw Postgres text never leaks). Exactly-once on
 * `idempotencyKey`.
 */
export async function recordAuctionScoresheet(
  store: RecordAuctionScoresheetStore,
  raw: Record<string, unknown>,
): Promise<RecordAuctionScoresheetResult> {
  const parsed = validateRecordAuctionScoresheet(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("record_auction_scoresheet", {
    p_entry_id: parsed.data.entryId,
    p_juror: parsed.data.juror,
    p_attribute: parsed.data.attribute,
    p_score: parsed.data.score,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return { ok: false, message: `Couldn't post the jury mark: ${error.message}` };
  }
  if (data == null) {
    return { ok: false, message: "The jury mark couldn't be posted. Please try again." };
  }
  return { ok: true, scoresheetId: Number(data) };
}
