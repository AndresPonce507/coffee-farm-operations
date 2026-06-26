"use server";

import { getTranslations } from "next-intl/server";

import { getSupabase } from "@/lib/supabase/server";

/**
 * /margins WRITE port — the canonical FX-rate recorder (P3-S16).
 *
 * `record_fx_rate` is the ONLY `fx_rate` writer (the SSOT door, rail §6): one place a
 * rate lives, never hardcoded. The free ECB daily feed (a Supabase scheduled fn, not
 * a paid FX API) calls this RPC; this Server Action is the manual, no-cost fallback —
 * a deliberate, human-entered figure (ADR-002 / rail §7: only ever invoked by an
 * authenticated human submitting a form, never driven by untrusted inbound). It is
 * NOT a money-shaped inventory commit — recording a reference rate moves no ATP — so
 * it busts no consumer route; the island calls router.refresh() to re-read the book.
 *
 * The action validates the shape the DB enforces BEFORE the network hop, then appends
 * through the SECURITY DEFINER RPC. The RPC is idempotent on its key, so an
 * exactly-once retry collapses to the same row. Author-written guard messages pass
 * through verbatim (they are family-readable); structural Postgres errors map to clean
 * copy — never a raw SQLSTATE leak.
 */

export interface RecordFxRateInput {
  /** YYYY-MM-DD — the day the rate applies to. */
  asOf: string;
  base: string;
  quote: string;
  rate: number;
  /** 'manual' | 'ecb'. */
  source: string;
  idempotencyKey: string;
}

export type RecordFxRateResult =
  | { ok: true; rateId: number }
  | { ok: false; error: string };

interface PgError {
  message: string;
  code?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isPositive = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;

/**
 * Map a Postgres error to family-readable copy. The SECURITY DEFINER writer raises
 * author-written messages (e.g. "no tenant in session") with safe, clear SQLSTATEs
 * that pass through verbatim; a duplicate-pair unique violation and an access denial
 * get canned guidance; everything else gets the generic line. Nothing raw ever leaks.
 */
function friendlyError(
  error: PgError,
  msgs: { generic: string; duplicate: string; access: string },
): string {
  switch (error.code) {
    case "23514": // check_violation — author-written guard messages
    case "P0001": // raise_exception ("no tenant in session")
    case "P0002": // no_data_found
    case "23503": // foreign_key_violation
      return error.message;
    case "42501": // insufficient_privilege
      return msgs.access;
    case "23505": // unique_violation — same day + pair already on the books
      return msgs.duplicate;
    default:
      return msgs.generic;
  }
}

export async function recordFxRateAction(
  input: RecordFxRateInput,
): Promise<RecordFxRateResult> {
  const t = await getTranslations("margins");

  const base = input.base?.trim() ?? "";
  const quote = input.quote?.trim() ?? "";

  if (!base) return { ok: false, error: t("errors.baseRequired") };
  if (!quote) return { ok: false, error: t("errors.quoteRequired") };
  if (!isPositive(input.rate)) return { ok: false, error: t("errors.ratePositive") };
  if (!input.asOf || !DATE_RE.test(input.asOf)) {
    return { ok: false, error: t("errors.dateRequired") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("record_fx_rate", {
    p_as_of: input.asOf,
    p_base: base.toUpperCase(),
    p_quote: quote.toUpperCase(),
    p_rate: input.rate,
    p_source: input.source?.trim() || "manual",
    p_idempotency_key: input.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      error: friendlyError(error as PgError, {
        generic: t("errors.generic"),
        duplicate: t("errors.duplicate"),
        access: t("errors.access"),
      }),
    };
  }

  return { ok: true, rateId: Number(data) };
}
