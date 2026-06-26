import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for binding a NEW accolade to a lot (P3-S19). The
 * `lot_accolades` ledger is APPEND-ONLY (immutability triggers reject UPDATE/DELETE):
 * a cup score, award, certification or press mention is an immutable row, and a
 * correction is a 'score-revision' REVERSING row (see `reviseAccolade`), never an edit.
 * The single write door is `record_accolade` — SECURITY DEFINER, tenant-clamped,
 * idempotent on a tenant-qualified key, appending a `lot_event` onto the lot's
 * provenance chain in the same txn. Accolades are OWNER-AUTHORED evidence (rail §7):
 * never driven by untrusted inbound, not money-shaped.
 *
 * Symmetric twin of the read port: a pure validator (`validateRecordAccolade`) plus a
 * thin command (`recordAccolade`) that calls the one `.rpc()` method it needs (the
 * `RecordAccoladeStore` port), testable with no database. The keystone invariants are
 * mirrored so the form fails fast — a cup-score MUST carry a score in [0,100] (the
 * `lot_accolades_cupscore_chk`); an award/cert/press needs a name; 'score-revision' is
 * REFUSED here (it flows only through `revise_accolade`, which carries the reverses_id
 * binding) — but the DB CHECK/FK/triggers are the real enforcement (ADR-002).
 */

/** A NEW accolade's kind. 'score-revision' is deliberately excluded — it is a revision,
 *  posted only via `revise_accolade`. */
export type RecordAccoladeKind =
  | "cup-score"
  | "award"
  | "certification"
  | "press-mention";

const RECORD_KINDS: readonly RecordAccoladeKind[] = [
  "cup-score",
  "award",
  "certification",
  "press-mention",
];

/** Validated, domain-shaped accolade args (camelCase). Optional fields are null when
 *  blank; `score` is the validated cup score for a 'cup-score' and null for every
 *  other kind (mirrors what the action forwards as `p_score`). */
export interface RecordAccoladeInput {
  lotCode: string;
  kind: RecordAccoladeKind;
  title: string | null;
  /** [0,100] for a cup-score; null for award/cert/press (the DB CHECK only binds cup-score). */
  score: number | null;
  awardedBy: string | null;
  awardYear: number | null;
  evidenceUrl: string | null;
  sourceSessionId: number | null;
  idempotencyKey: string;
}

/** Trim to a non-empty string, or null when blank. */
function optionalText(v: unknown): string | null {
  const t = trimmed(v);
  return t === "" ? null : t;
}

/** Is `v` blank (absent / empty after trim)? Optional fields treat blank as null. */
function isBlank(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "");
}

/**
 * Pure validation of a raw accolade — mirrors the `record_accolade` / `lot_accolades`
 * constraints (lot code required for the FK; a known kind; a cup-score's score in
 * [0,100]; a non-cup accolade needs a title; an award year, if given, a whole year in
 * [1900,2200]) so errors surface before the round-trip. The append-only triggers,
 * unknown-lot FK and cup-score CHECK are the real enforcement.
 */
export function validateRecordAccolade(
  raw: Record<string, unknown>,
): ValidationResult<RecordAccoladeInput> {
  const errors: Record<string, string> = {};

  const lotCode = trimmed(raw.lotCode);
  if (!lotCode) errors.lotCode = "A lot is required.";

  const kindRaw = trimmed(raw.kind);
  const isKnownKind = (RECORD_KINDS as readonly string[]).includes(kindRaw);
  if (kindRaw === "score-revision") {
    errors.kind = "A score revision is posted through the revise path, not here.";
  } else if (!isKnownKind) {
    errors.kind = "Choose a cup score, award, certification or press mention.";
  }
  const kind = isKnownKind ? (kindRaw as RecordAccoladeKind) : undefined;

  const title = optionalText(raw.title);

  // cup-score: a score in [0,100] is mandatory (the cup_score CHECK). Other kinds
  // carry no score (forwarded null) but DO need a title — an award/cert/press mention
  // is meaningless without a name.
  let score: number | null = null;
  if (kind === "cup-score") {
    if (isBlank(raw.score)) {
      errors.score = "A cup score is required.";
    } else {
      const s = toNumber(raw.score);
      if (s === null || s < 0 || s > 100) {
        errors.score = "Cup score must be between 0 and 100.";
      } else {
        score = s;
      }
    }
  } else if (kind && !title) {
    errors.title = "A name is required for an award, certification or press mention.";
  }

  // award year: optional, but if provided a whole year in [1900,2200] (the CHECK).
  let awardYear: number | null = null;
  if (!isBlank(raw.awardYear)) {
    const y = toNumber(raw.awardYear);
    if (y === null || !Number.isInteger(y) || y < 1900 || y > 2200) {
      errors.awardYear = "Enter a four-digit year between 1900 and 2200.";
    } else {
      awardYear = y;
    }
  }

  // source cupping session: optional soft reference (un-FK'd by name); a whole id.
  let sourceSessionId: number | null = null;
  if (!isBlank(raw.sourceSessionId)) {
    const sid = toNumber(raw.sourceSessionId);
    if (sid === null || !Number.isInteger(sid) || sid <= 0) {
      errors.sourceSessionId = "Invalid cupping session reference.";
    } else {
      sourceSessionId = sid;
    }
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      lotCode,
      kind: kind as RecordAccoladeKind,
      title,
      score,
      awardedBy: optionalText(raw.awardedBy),
      awardYear,
      evidenceUrl: optionalText(raw.evidenceUrl),
      sourceSessionId,
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
 *  `record_accolade` needs (satisfied structurally by the Supabase client + a test stub). */
export interface RecordAccoladeStore {
  rpc(
    fn: "record_accolade",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the posted accolade's id, or friendly/labelled errors. */
export type RecordAccoladeResult =
  | { ok: true; accoladeId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Validate then post: calls `record_accolade` exactly once with the snake_case `p_`
 * argument envelope. Bad input never reaches the RPC (friendly errors); a failure
 * surfaces labelled (the author-written guard messages are family-readable, raw
 * Postgres text never leaks). Exactly-once on `idempotencyKey`.
 */
export async function recordAccolade(
  store: RecordAccoladeStore,
  raw: Record<string, unknown>,
): Promise<RecordAccoladeResult> {
  const parsed = validateRecordAccolade(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("record_accolade", {
    p_lot_code: parsed.data.lotCode,
    p_kind: parsed.data.kind,
    p_title: parsed.data.title,
    p_score: parsed.data.score,
    p_awarded_by: parsed.data.awardedBy,
    p_award_year: parsed.data.awardYear,
    p_evidence_url: parsed.data.evidenceUrl,
    p_source_session_id: parsed.data.sourceSessionId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return { ok: false, message: `Couldn't record the accolade: ${error.message}` };
  }
  if (data == null) {
    return { ok: false, message: "The accolade couldn't be recorded. Please try again." };
  }
  return { ok: true, accoladeId: Number(data) };
}
