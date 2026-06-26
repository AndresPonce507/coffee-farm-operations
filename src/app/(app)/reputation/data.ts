import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/**
 * /reputation read port (P3-S19 reputation ledger).
 *
 * Co-located with the route on purpose: it binds DIRECTLY to the authoritative SQL
 * surface the P3-S19 migration shipped — the `v_lot_reputation` aggregate view, the
 * append-only `lot_accolades` ledger, and `verify_chain('accolade:<lot>')` — rather
 * than a sibling `@/lib/db` port. Importing a not-yet-written module would hard-fail
 * Vite import-analysis at test AND build time; the only load-bearing contract here is
 * the view/column/RPC names, which are frozen. The Wiring pass can collapse this into
 * a shared port (one import swap).
 *
 * READ-ONLY. Every write goes through the SECURITY DEFINER RPCs in `actions.ts`
 * (record_accolade / revise_accolade). A NULL cup score is PRESERVED as null and shown
 * as "not cupped" — never fabricated to a 0 floor (rail §5, the honest-provenance
 * posture the costing/EUDR surfaces share).
 */

export type AccoladeKind =
  | "cup-score"
  | "award"
  | "certification"
  | "press-mention"
  | "score-revision";

/** Card-level reputation for one lot (mirrors a `v_lot_reputation` row, enriched). */
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

/** The full detail payload for one lot's reputation page. */
export interface LotReputationDetail extends ReputationSummary {
  /** The whole ledger (originals + revisions), chronological. */
  accolades: Accolade[];
  /** `verify_chain('accolade:<lot>')` — the tamper-evident stamp. */
  chainVerified: boolean;
}

interface ReputationViewRow {
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

interface AccoladeRow {
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

/** Coerce a PostgREST numeric (which may arrive as a string) to number|null. */
const n = (v: number | string | null | undefined): number | null =>
  v == null ? null : Number(v);

/** Coerce a count column to a plain integer (null ⇒ 0). */
const count = (v: number | string | null | undefined): number =>
  v == null ? 0 : Number(v);

function mapSummary(
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

/**
 * The wall of fame: every lot that carries a live accolade, ranked by its best cup
 * score (then by how decorated it is). Lots with zero accolades simply don't appear
 * (the view is grouped over the live ledger) — the empty board is the honest state.
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
      .map((r) => mapSummary(r, varietyByCode.get(r.lot_code) ?? null))
      .sort((a, b) => {
        const sa = a.bestCupScore ?? -Infinity;
        const sb2 = b.bestCupScore ?? -Infinity;
        if (sb2 !== sa) return sb2 - sa;
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
 * but carries no accolades resolves to a real detail with an empty ledger, so the
 * owner can record the first one. The chain stamp is honest: it is only "verified"
 * when `verify_chain` returns true (an empty chain verifies; an error never claims a
 * green stamp).
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

    // Which entries are reversed by a later 'score-revision' (excluded from net live).
    const reversedIds = new Set<number>();
    for (const r of rows) {
      const rid = n(r.reverses_id);
      if (rid != null) reversedIds.add(rid);
    }

    const accolades: Accolade[] = rows.map((r) => {
      const id = Number(r.id);
      return {
        id,
        kind: r.kind as AccoladeKind,
        title: r.title,
        score: n(r.score),
        awardedBy: r.awarded_by,
        awardYear: r.award_year,
        evidenceUrl: r.evidence_url,
        reversesId: n(r.reverses_id),
        occurredAt: r.occurred_at,
        reversed: reversedIds.has(id),
      };
    });

    // The aggregate view drives the card; fall back to zeros + the QC truth from
    // green_lots when the lot has no accolades yet (so the card still renders).
    const base: ReputationSummary = repRow
      ? mapSummary(repRow, variety)
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
      accolades.length === 0
        ? true
        : !chainRes.error && chainRes.data === true;

    return { ...base, accolades, chainVerified };
  },
);
