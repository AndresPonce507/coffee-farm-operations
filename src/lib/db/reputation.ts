import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/* ====================================================================== */
/* P3-S19 — Reputation ledger READ-port (ADR-003 derived-read). The shared  */
/* sibling port the Wiring pass collapses the co-located /reputation        */
/* `data.ts` into (one import swap). Binds DIRECTLY to the authoritative SQL */
/* surface the P3-S19 migration shipped:                                    */
/*   • v_lot_reputation        — the per-lot aggregate (best LIVE cup score, */
/*       award/cert/press counts + name arrays, reconciled to the QC truth   */
/*       in green_lots.cupping_score / sca_grade).                           */
/*   • lot_accolades           — the append-only ledger (originals + the     */
/*       'score-revision' reversing rows).                                   */
/*   • verify_chain('accolade:<lot>')  — the tamper-evident chain stamp.     */
/*   • v_lot_reputation_public — the NARROW public projection (title/score/  */
/*       awarded_by/award_year); authenticated-only here, anon in P3-S13.    */
/* READ-ONLY: every write goes through the SECURITY DEFINER command ports    */
/* (`@/lib/db/commands/recordAccolade` / `reviseAccolade`). A NULL cup/QC    */
/* score is PRESERVED as null ("not cupped"), never fabricated to a 0 floor  */
/* (rail §5). Mirrors the pricing.ts / greenlots.ts shape: Row interface +   */
/* pure mapper + cache()'d getters.                                          */
/* ====================================================================== */

export type AccoladeKind =
  | "cup-score"
  | "award"
  | "certification"
  | "press-mention"
  | "score-revision";

/** Coerce a nullable numeric (PostgREST may serialize as a string) to a number,
 *  PRESERVING null — an un-cupped lot's score stays null, never a fabricated 0. */
const n = (v: number | string | null | undefined): number | null =>
  v == null ? null : Number(v);

/** Coerce a count column to a plain integer (null ⇒ 0). */
const count = (v: number | string | null | undefined): number =>
  v == null ? 0 : Number(v);

/* ---------------- v_lot_reputation (the per-lot aggregate) ---------------- */

/** Shape of a `v_lot_reputation` row as returned by PostgREST (snake_case). The
 *  score columns are numerics that may arrive as strings; counts/arrays can be null. */
export interface ReputationViewRow {
  lot_code: string;
  qc_cupping_score: number | string | null;
  sca_grade: string | null;
  best_cup_score: number | string | null;
  accolade_count: number | string | null;
  award_count: number | string | null;
  awards: string[] | null;
  cert_count: number | string | null;
  certs: string[] | null;
  press_count: number | string | null;
  last_accolade_at: string | null;
}

/** Card-level reputation for one lot (mirrors a `v_lot_reputation` row, enriched with
 *  the lot's variety). A NULL cup/QC score means "not cupped yet" (never a 0). */
export interface ReputationSummary {
  lotCode: string;
  variety: string | null;
  /** The QC truth the view reconciles to; null ⇒ the lot is not cupped yet. */
  qcCuppingScore: number | null;
  scaGrade: string | null;
  /** Best LIVE cup score (excludes reversed rows); null ⇒ no cup accolade on file. */
  bestCupScore: number | null;
  accoladeCount: number;
  awardCount: number;
  awards: string[];
  certCount: number;
  certs: string[];
  pressCount: number;
  lastAccoladeAt: string | null;
}

/** Pure row → domain mapper for the aggregate (numeric coercion; NULL cup/QC score
 *  preserved; null counts → 0; null name arrays → []; the variety is folded in). */
export function mapReputationSummary(
  r: ReputationViewRow,
  variety: string | null,
): ReputationSummary {
  return {
    lotCode: r.lot_code,
    variety,
    qcCuppingScore: n(r.qc_cupping_score),
    scaGrade: r.sca_grade,
    bestCupScore: n(r.best_cup_score),
    accoladeCount: count(r.accolade_count),
    awardCount: count(r.award_count),
    awards: r.awards ?? [],
    certCount: count(r.cert_count),
    certs: r.certs ?? [],
    pressCount: count(r.press_count),
    lastAccoladeAt: r.last_accolade_at,
  };
}

/* ---------------- lot_accolades (the append-only ledger) ---------------- */

/** Shape of a `lot_accolades` row as read for the ledger (snake_case). */
export interface AccoladeRow {
  id: number | string;
  kind: string;
  title: string | null;
  score: number | string | null;
  awarded_by: string | null;
  award_year: number | null;
  evidence_url: string | null;
  reverses_id: number | string | null;
  occurred_at: string;
}

/** One entry on a lot's append-only ledger (a row of `lot_accolades`). */
export interface Accolade {
  id: number;
  kind: AccoladeKind;
  title: string | null;
  score: number | null;
  awardedBy: string | null;
  awardYear: number | null;
  evidenceUrl: string | null;
  /** Set on a 'score-revision' to the entry it supersedes. */
  reversesId: number | null;
  occurredAt: string;
  /** Derived: this entry is reversed by a later revision (excluded from the net live). */
  reversed: boolean;
}

/** Pure row → domain mapper for one ledger entry (numeric coercion; the `reversed`
 *  flag is supplied by the caller — it is a property of the whole ledger, see
 *  `mapAccoladeLedger`). */
export function mapAccolade(r: AccoladeRow, reversed: boolean): Accolade {
  return {
    id: Number(r.id),
    kind: r.kind as AccoladeKind,
    title: r.title,
    score: n(r.score),
    awardedBy: r.awarded_by,
    awardYear: r.award_year,
    evidenceUrl: r.evidence_url,
    reversesId: n(r.reverses_id),
    occurredAt: r.occurred_at,
    reversed,
  };
}

/** Map a full ledger, deriving each row's `reversed` flag from the set of `reverses_id`
 *  the ledger carries (a row a later 'score-revision' reverses is excluded from the net
 *  live view, the same rule `v_lot_reputation` applies). Pure. */
export function mapAccoladeLedger(rows: AccoladeRow[]): Accolade[] {
  const reversedIds = new Set<number>();
  for (const r of rows) {
    const rid = n(r.reverses_id);
    if (rid != null) reversedIds.add(rid);
  }
  return rows.map((r) => mapAccolade(r, reversedIds.has(Number(r.id))));
}

/* ---------------- LotReputationDetail (one lot's whole page) ---------------- */

/** The full detail payload for one lot's reputation page. */
export interface LotReputationDetail extends ReputationSummary {
  /** The whole ledger (originals + revisions), chronological. */
  accolades: Accolade[];
  /** `verify_chain('accolade:<lot>')` — the tamper-evident stamp (honest: an empty
   *  ledger verifies; otherwise only true when verify_chain returns true). */
  chainVerified: boolean;
}

/* ---------------- v_lot_reputation_public (the narrow public projection) ---------------- */

/** Shape of a `v_lot_reputation_public` row (snake_case) — the curated public surface
 *  (title/score/awarded_by/award_year only). Authenticated-only here; P3-S13 grants it
 *  to anon. */
export interface ReputationPublicRow {
  lot_code: string;
  title: string | null;
  score: number | string | null;
  awarded_by: string | null;
  award_year: number | null;
}

/** A single live, public-facing accolade line (the microsite/offer "why this lot" panel). */
export interface LotReputationPublic {
  lotCode: string;
  title: string | null;
  score: number | null;
  awardedBy: string | null;
  awardYear: number | null;
}

/** Pure row → domain mapper for the narrow public projection (numeric coercion of the
 *  score; null title/score/awardedBy/year passthrough). */
export function mapReputationPublic(r: ReputationPublicRow): LotReputationPublic {
  return {
    lotCode: r.lot_code,
    title: r.title,
    score: n(r.score),
    awardedBy: r.awarded_by,
    awardYear: r.award_year,
  };
}

/* ---------------- getters (request-scoped cache) ---------------- */

/**
 * The wall of fame: every lot that carries a live accolade (`v_lot_reputation`),
 * ranked by best cup score (nulls last), then by how decorated it is, then by code.
 * Lots with zero accolades simply don't appear (the view groups over the live ledger)
 * — the empty board is the honest state.
 */
export const getReputationWall = cache(
  async (): Promise<ReputationSummary[]> => {
    const sb = await getSupabase();
    const [rep, lots] = await Promise.all([
      sb
        .from("v_lot_reputation")
        .select("*")
        .order("best_cup_score", { ascending: false, nullsFirst: false }),
      sb.from("lots").select("code, variety"),
    ]);

    if (rep.error) throw new Error(`getReputationWall: ${rep.error.message}`);
    if (lots.error) {
      throw new Error(`getReputationWall(variety): ${lots.error.message}`);
    }

    const varietyByCode = new Map<string, string | null>(
      (lots.data as { code: string; variety: string | null }[]).map((l) => [
        l.code,
        l.variety,
      ]),
    );

    return (rep.data as ReputationViewRow[])
      .map((r) => mapReputationSummary(r, varietyByCode.get(r.lot_code) ?? null))
      .sort((a, b) => {
        const sa = a.bestCupScore ?? -Infinity;
        const sbScore = b.bestCupScore ?? -Infinity;
        if (sbScore !== sa) return sbScore - sa;
        if (b.accoladeCount !== a.accoladeCount) {
          return b.accoladeCount - a.accoladeCount;
        }
        return a.lotCode.localeCompare(b.lotCode);
      });
  },
);

/**
 * One lot's full reputation ledger. Returns null when the lot_code does not exist in
 * the caller's tenant (the page 404s — never a fabricated record). A lot that exists
 * but carries no accolades resolves to a real detail with an empty ledger (so the owner
 * can record the first one), reconciled to the QC truth from green_lots. The chain
 * stamp is honest: an empty chain verifies; otherwise it is only "verified" when
 * `verify_chain` returns true (an RPC error never fabricates a green stamp).
 */
export const getLotReputation = cache(
  async (code: string): Promise<LotReputationDetail | null> => {
    const sb = await getSupabase();

    const { data: lotRow, error: lotErr } = await sb
      .from("lots")
      .select("code, variety")
      .eq("code", code)
      .maybeSingle();
    if (lotErr) throw new Error(`getLotReputation: ${lotErr.message}`);
    if (!lotRow) return null;
    const variety = (lotRow as { variety: string | null }).variety;

    const [greenRes, repRes, accRes, chainRes] = await Promise.all([
      sb
        .from("green_lots")
        .select("cupping_score, sca_grade")
        .eq("lot_code", code)
        .maybeSingle(),
      sb
        .from("v_lot_reputation")
        .select("*")
        .eq("lot_code", code)
        .maybeSingle(),
      sb
        .from("lot_accolades")
        .select(
          "id, kind, title, score, awarded_by, award_year, evidence_url, reverses_id, occurred_at",
        )
        .eq("lot_code", code)
        .order("occurred_at", { ascending: true })
        .order("id", { ascending: true }),
      sb.rpc("verify_chain", { stream_key: `accolade:${code}` }),
    ]);

    if (accRes.error) {
      throw new Error(`getLotReputation(ledger): ${accRes.error.message}`);
    }

    const green = greenRes.data as
      | { cupping_score: number | string | null; sca_grade: string | null }
      | null;
    const repRow = repRes.data as ReputationViewRow | null;
    const rows = (accRes.data as AccoladeRow[] | null) ?? [];

    const accolades = mapAccoladeLedger(rows);

    // The aggregate view drives the card; fall back to zeros + the QC truth from
    // green_lots when the lot has no accolades yet (so the card still renders).
    const base: ReputationSummary = repRow
      ? mapReputationSummary(repRow, variety)
      : {
          lotCode: code,
          variety,
          qcCuppingScore: n(green?.cupping_score),
          scaGrade: green?.sca_grade ?? null,
          bestCupScore: null,
          accoladeCount: 0,
          awardCount: 0,
          awards: [],
          certCount: 0,
          certs: [],
          pressCount: 0,
          lastAccoladeAt: null,
        };

    // Honest chain stamp: an empty ledger verifies; otherwise trust verify_chain only
    // when it returns true (an RPC error never fabricates a green "verified" badge).
    const chainVerified =
      accolades.length === 0 ? true : !chainRes.error && chainRes.data === true;

    return { ...base, accolades, chainVerified };
  },
);

/**
 * The narrow public projection (`v_lot_reputation_public`) — every live, public-facing
 * accolade line (title/score/awarded_by/award_year only). The single curated surface
 * the offer "why this lot" panel and the public microsite read. Granted to
 * AUTHENTICATED here; P3-S13 owns the anon grant.
 */
export const getLotReputationPublic = cache(
  async (): Promise<LotReputationPublic[]> => {
    const { data, error } = await (await getSupabase())
      .from("v_lot_reputation_public")
      .select("*")
      .order("lot_code");
    if (error) throw new Error(`getLotReputationPublic: ${error.message}`);
    return (data as ReputationPublicRow[]).map(mapReputationPublic);
  },
);
