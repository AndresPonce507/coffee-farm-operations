import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/* ====================================================================== */
/* P3-S2 — B2B sample tracking READ-port. Samples are the trust step that   */
/* turns an offer into a contract: a buyer asks for a few hundred grams of  */
/* a green lot, cups it, and approves/rejects/counters. A *pre-shipment*    */
/* sample large enough to matter draws ATP via a `lot_shipments` row (so the */
/* REUSED `prevent_oversell` guard fires); offer/type/arbitration samples    */
/* are a side ledger (sub-100 g is below the mass-conservation resolution —  */
/* documented degradation, same spirit as the Phase-1 green_lot_mass         */
/* fallback). The only writers are the SECURITY DEFINER RPCs in the command  */
/* ports (`log_sample`, `record_sample_verdict`). This port only READS.      */
/* Mirrors the pricing.ts / greenlots.ts shape: `Row` interface + pure       */
/* `mapX` mapper + `cache()`'d getters; NULLs (a spec sample's missing buyer, */
/* an un-drawn shipment, an un-scored lot, an un-rendered verdict) are        */
/* PRESERVED, never fabricated to 0 — the UI shows "—" instead of a number.  */
/* ====================================================================== */

/** A sample's kind — mirrors the `sample_kind` enum. */
export type SampleKind = "offer" | "pre_shipment" | "type" | "arbitration";

/** A buyer's cupping verdict on a sample — mirrors the `buyer_verdict` CHECK. */
export type BuyerVerdict = "approved" | "rejected" | "counter";

/** Coerce a nullable numeric (PostgREST may serialize as a string) to a number,
 *  PRESERVING null — a spec sample's missing buyer / un-drawn shipment / un-scored
 *  lot / un-rendered verdict stays null (never a fabricated 0). */
function num(v: number | string | null | undefined): number | null {
  return v == null ? null : Number(v);
}

/* ---------------- v_sample_pipeline ---------------- */

/** Shape of a `v_sample_pipeline` row as returned by PostgREST (snake_case).
 *  OPEN samples only (buyer_verdict IS NULL). `buyer_id`/`buyer_name` are NULL for a
 *  spec/type sample (LEFT JOIN b2b_buyers); `courier`/`tracking_no` are NULL when no
 *  carrier was recorded; `cupping_score` is NULL when QC hasn't scored the lot. */
export interface SamplePipelineRow {
  sample_id: number | string;
  green_lot_code: string;
  buyer_id: number | string | null;
  buyer_name: string | null;
  sample_kind: SampleKind | string;
  grams: number | string;
  courier: string | null;
  tracking_no: string | null;
  dispatched_at: string;
  sca_grade: string;
  cupping_score: number | string | null;
}

/** One OPEN sample awaiting buyer feedback — the sample-pipeline board's row. */
export interface SamplePipelineEntry {
  sampleId: number;
  greenLotCode: string;
  /** The buyer the sample was sent to. NULL ⇒ a spec/type sample (no buyer). */
  buyerId: number | null;
  buyerName: string | null;
  sampleKind: SampleKind | string;
  grams: number;
  /** Carrier name (plain text — no paid carrier API). NULL ⇒ none recorded. */
  courier: string | null;
  /** Tracking number (plain text + a public-tracker deep link). NULL ⇒ none. */
  trackingNo: string | null;
  dispatchedAt: string;
  scaGrade: string;
  /** Farm cupping score for the lot. NULL ⇒ QC hasn't scored it yet (shown as "—"). */
  cuppingScore: number | null;
}

/** Pure row → domain mapper for a pipeline entry (numeric coercion; NULL buyer/
 *  courier/tracking/score preserved, never fabricated). */
export function mapSamplePipelineEntry(
  r: SamplePipelineRow,
): SamplePipelineEntry {
  return {
    sampleId: Number(r.sample_id),
    greenLotCode: r.green_lot_code,
    buyerId: num(r.buyer_id),
    buyerName: r.buyer_name,
    sampleKind: r.sample_kind,
    grams: Number(r.grams),
    courier: r.courier,
    trackingNo: r.tracking_no,
    dispatchedAt: r.dispatched_at,
    scaGrade: r.sca_grade,
    cuppingScore: num(r.cupping_score),
  };
}

/* ---------------- green_samples (the append-only ledger) ---------------- */

/** Shape of a `green_samples` ledger row (snake_case) for per-lot history.
 *  `shipment_id` is set iff a pre-shipment ATP draw fired; `buyer_score`/
 *  `buyer_verdict`/`verdict_at` are NULL until a verdict is recorded. */
export interface GreenSampleRow {
  id: number | string;
  green_lot_code: string;
  buyer_id: number | string | null;
  sample_kind: SampleKind | string;
  grams: number | string;
  courier: string | null;
  tracking_no: string | null;
  shipment_id: number | string | null;
  buyer_score: number | string | null;
  buyer_verdict: BuyerVerdict | string | null;
  verdict_at: string | null;
  dispatched_at: string;
  created_at: string;
}

/** One sample in the append-only ledger — open or with a recorded verdict. */
export interface GreenSample {
  id: number;
  greenLotCode: string;
  buyerId: number | null;
  sampleKind: SampleKind | string;
  grams: number;
  courier: string | null;
  trackingNo: string | null;
  /** The `lot_shipments.id` of the ATP draw. NULL ⇒ no draw (offer/type/arbitration). */
  shipmentId: number | null;
  /** The buyer's score. NULL ⇒ no verdict yet, or a verdict without a number. */
  buyerScore: number | null;
  /** The buyer's verdict. NULL ⇒ still open (awaiting feedback). */
  buyerVerdict: BuyerVerdict | string | null;
  verdictAt: string | null;
  dispatchedAt: string;
  createdAt: string;
}

/** Pure row → domain mapper for a sample (numeric coercion; NULL buyer/shipment/
 *  score/verdict preserved, never fabricated). */
export function mapGreenSample(r: GreenSampleRow): GreenSample {
  return {
    id: Number(r.id),
    greenLotCode: r.green_lot_code,
    buyerId: num(r.buyer_id),
    sampleKind: r.sample_kind,
    grams: Number(r.grams),
    courier: r.courier,
    trackingNo: r.tracking_no,
    shipmentId: num(r.shipment_id),
    buyerScore: num(r.buyer_score),
    buyerVerdict: r.buyer_verdict,
    verdictAt: r.verdict_at,
    dispatchedAt: r.dispatched_at,
    createdAt: r.created_at,
  };
}

/* ---------------- getters (request-scoped cache) ---------------- */

/**
 * The open sample pipeline (`v_sample_pipeline`) — every sample still awaiting buyer
 * feedback (`buyer_verdict IS NULL`), joined to the buyer name and the lot's grade/
 * score. Ordered oldest-dispatched first, so the longest-waiting (the most overdue for
 * a chase) leads the board. The verdict writer (`record_sample_verdict`) drops a sample
 * off this list the moment a verdict is recorded.
 */
export const getSamplePipeline = cache(
  async (): Promise<SamplePipelineEntry[]> => {
    const { data, error } = await (await getSupabase())
      .from("v_sample_pipeline")
      .select("*")
      .order("dispatched_at");
    if (error) throw new Error(`getSamplePipeline: ${error.message}`);
    return (data as SamplePipelineRow[]).map(mapSamplePipelineEntry);
  },
);

/**
 * One green lot's full sample history (`green_samples` filtered to the lot), newest
 * dispatched first — open samples and recorded verdicts alike. The contract-workspace /
 * lot-detail surface reads this to show the sample story (and, for a reserve contract,
 * whether an approved pre-shipment sample has unlocked the contract sign).
 */
export const listSamplesForLot = cache(
  async (lot: string): Promise<GreenSample[]> => {
    const { data, error } = await (await getSupabase())
      .from("green_samples")
      .select("*")
      .eq("green_lot_code", lot)
      .order("dispatched_at", { ascending: false });
    if (error) throw new Error(`listSamplesForLot: ${error.message}`);
    return (data as GreenSampleRow[]).map(mapGreenSample);
  },
);
