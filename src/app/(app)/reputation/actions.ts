"use server";

import { getTranslations } from "next-intl/server";

import { getSupabase } from "@/lib/supabase/server";

/**
 * /reputation WRITE port — the record + revise Server Actions (P3-S19).
 *
 * Server Actions are the one driving port (rail §7: only ever invoked by an
 * authenticated human submitting a form). Accolades are OWNER-AUTHORED evidence —
 * cup scores, awards, certifications, press — never driven by untrusted inbound, and
 * not money-shaped. Each action validates the shape the DB enforces BEFORE the network
 * hop, then appends through a single SECURITY DEFINER command RPC:
 *   • record_accolade — binds a NEW accolade to a lot; a cup-score must carry a score
 *     in [0,100] (the DB CHECK, mirrored here so the form fails fast).
 *   • revise_accolade — the ONLY correction path: posts a 'score-revision' REVERSING
 *     row; the original is never edited, just superseded. Append-only at the data
 *     layer (lot_accolades has no client UPDATE/DELETE).
 *
 * The keystone guards (cup-score-needs-a-score CHECK, unknown-lot FK, the append-only
 * triggers, the already-revised guard) all live in the database; these actions surface
 * the author-written guard messages verbatim (they are family-readable) and map
 * structural Postgres errors to clean copy — never a raw SQLSTATE leak. The
 * idempotency_key is CLIENT-minted (rail §1) so an exactly-once retry collapses to the
 * same row.
 *
 * REVALIDATION: an accolade moves NO inventory and no ATP — it changes only the
 * reputation wall + this lot's ledger. There is no inventory-shaped EventKind to
 * ripple and src/lib/revalidate.ts is a shared contract file (single-author in the
 * Wiring pass), so these actions intentionally bust nothing; the client island calls
 * router.refresh() to re-render the current route after a write. WIRING SEAM: add an
 * "accolade-recorded" EventKind whose RIPPLE routes are ["/reputation",
 * "/reputation/[lot]", "/lots/[code]"] and repoint here.
 */

export interface RecordAccoladeInput {
  lotCode: string;
  kind: "cup-score" | "award" | "certification" | "press-mention";
  title: string | null;
  score: number | null;
  awardedBy: string | null;
  awardYear: number | null;
  evidenceUrl: string | null;
  sourceSessionId: number | null;
  idempotencyKey: string;
}

export interface ReviseAccoladeInput {
  accoladeId: number;
  newScore: number;
  note: string | null;
  idempotencyKey: string;
}

export type AccoladeResult =
  | { ok: true; accoladeId: number }
  | { ok: false; error: string };

interface PgError {
  message: string;
  code?: string;
}

/**
 * Map a Postgres error to family-readable copy. Our SECURITY DEFINER guards raise
 * author-written messages with these SQLSTATEs (cup-score range, unknown lot, the
 * append-only / already-revised guards) — all safe and clear, so they pass through
 * verbatim. Structural codes get canned guidance; nothing raw ever leaks.
 */
function friendlyError(error: PgError, generic: string): string {
  switch (error.code) {
    case "23514": // check_violation — author-written guard messages
    case "P0001": // raise_exception
    case "P0002": // no_data_found
    case "23503": // foreign_key_violation ("unknown lot / accolade")
      return error.message;
    case "42501": // insufficient_privilege
      return "You don't have access to record accolades on this lot.";
    case "23505": // unique_violation — idempotent replay collided
      return "That accolade was already recorded.";
    default:
      return generic;
  }
}

const KINDS = ["cup-score", "award", "certification", "press-mention"] as const;

const isScoreInRange = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;

const trimOrNull = (v: string | null): string | null => {
  if (v == null) return null;
  const t = v.trim();
  return t === "" ? null : t;
};

export async function recordAccoladeAction(
  input: RecordAccoladeInput,
): Promise<AccoladeResult> {
  const t = await getTranslations("reputation");

  const lotCode = input.lotCode?.trim();
  if (!lotCode) return { ok: false, error: t("errors.lotRequired") };

  if (!KINDS.includes(input.kind)) {
    return { ok: false, error: t("errors.kindRequired") };
  }

  const title = trimOrNull(input.title);

  if (input.kind === "cup-score") {
    if (input.score == null) {
      return { ok: false, error: t("errors.scoreRequired") };
    }
    if (!isScoreInRange(input.score)) {
      return { ok: false, error: t("errors.scoreRange") };
    }
  } else if (!title) {
    // An award / certification / press mention is meaningless without a name.
    return { ok: false, error: t("errors.titleRequired") };
  }

  if (
    input.awardYear != null &&
    !(
      Number.isInteger(input.awardYear) &&
      input.awardYear >= 1900 &&
      input.awardYear <= 2200
    )
  ) {
    return { ok: false, error: t("errors.yearRange") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("record_accolade", {
    p_lot_code: lotCode,
    p_kind: input.kind,
    p_title: title,
    p_score: input.kind === "cup-score" ? input.score : null,
    p_awarded_by: trimOrNull(input.awardedBy),
    p_award_year: input.awardYear,
    p_evidence_url: trimOrNull(input.evidenceUrl),
    p_source_session_id: input.sourceSessionId,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return {
      ok: false,
      error: friendlyError(error as PgError, t("errors.generic")),
    };
  }

  // An accolade moves no inventory; nothing to ripple. The island router.refresh()es.
  return { ok: true, accoladeId: Number(data) };
}

export async function reviseAccoladeAction(
  input: ReviseAccoladeInput,
): Promise<AccoladeResult> {
  const t = await getTranslations("reputation");

  if (!Number.isInteger(input.accoladeId) || input.accoladeId <= 0) {
    return { ok: false, error: t("errors.accoladeRequired") };
  }
  if (!isScoreInRange(input.newScore)) {
    return { ok: false, error: t("errors.scoreRange") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("revise_accolade", {
    p_accolade_id: input.accoladeId,
    p_new_score: input.newScore,
    p_note: trimOrNull(input.note),
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return {
      ok: false,
      error: friendlyError(error as PgError, t("errors.reviseGeneric")),
    };
  }

  return { ok: true, accoladeId: Number(data) };
}
