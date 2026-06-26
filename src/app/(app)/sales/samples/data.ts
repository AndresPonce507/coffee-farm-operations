import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/**
 * /sales/samples read port (P3-S2 B2B sample tracking).
 *
 * Co-located with the route on purpose: it binds DIRECTLY to the authoritative SQL
 * surface the P3-S2 migration shipped — the `v_sample_pipeline` view (open samples
 * awaiting a buyer verdict) — plus two granted, tenant-scoped lookup surfaces for the
 * "log a sample" form (`v_lot_price_book` for the green-lot options, `b2b_buyers` for
 * the buyer options). A parallel fan-out builds the shared `@/lib/db` ports in sibling
 * files; importing a not-yet-existent module hard-fails Vite's import-analysis at both
 * test and build time, so this slice reads the frozen view/column names directly. The
 * Wiring pass can collapse this into a shared port (one import swap) once it lands.
 *
 * READ-ONLY. Every write goes through the SECURITY DEFINER RPCs in `actions.ts`
 * (`log_sample`, `record_sample_verdict`) — the one write door (rail §1).
 */

export type SampleKind = "offer" | "pre_shipment" | "type" | "arbitration";

/** One open sample on the pipeline (mirrors `v_sample_pipeline`). */
export interface SamplePipelineRow {
  sampleId: number;
  greenLotCode: string;
  buyerId: number | null;
  /** NULL = a spec/type sample (no requesting buyer). */
  buyerName: string | null;
  sampleKind: SampleKind;
  grams: number;
  courier: string | null;
  trackingNo: string | null;
  dispatchedAt: string;
  scaGrade: string | null;
  cuppingScore: number | null;
}

/** Raw `v_sample_pipeline` row (PostgREST may serialize numerics as strings). */
export interface SampleViewRow {
  sample_id: number;
  green_lot_code: string;
  buyer_id: number | null;
  buyer_name: string | null;
  sample_kind: string;
  grams: number | string;
  courier: string | null;
  tracking_no: string | null;
  dispatched_at: string;
  sca_grade: string | null;
  cupping_score: number | string | null;
}

/** A green-lot option for the log-a-sample form. */
export interface LotOption {
  code: string;
  scaGrade: string | null;
  cuppingScore: number | null;
}

/** A buyer option for the log-a-sample form. */
export interface BuyerOption {
  id: number;
  name: string;
}

export interface SampleFormOptions {
  lots: LotOption[];
  buyers: BuyerOption[];
}

/** Coerce a PostgREST numeric (which may arrive as a string) to number|null. */
const n = (v: number | string | null | undefined): number | null =>
  v == null ? null : Number(v);

/** Map a `v_sample_pipeline` row to the camelCase domain shape. */
export function mapSamplePipelineRow(r: SampleViewRow): SamplePipelineRow {
  return {
    sampleId: r.sample_id,
    greenLotCode: r.green_lot_code,
    buyerId: r.buyer_id,
    buyerName: r.buyer_name,
    sampleKind: r.sample_kind as SampleKind,
    grams: Number(r.grams),
    courier: r.courier,
    trackingNo: r.tracking_no,
    dispatchedAt: r.dispatched_at,
    scaGrade: r.sca_grade,
    cuppingScore: n(r.cupping_score),
  };
}

/**
 * The reserve-band visual hint: a Presidential/Specialty lot is priced on its own
 * merit (the reserve regime), so an approved pre-shipment sample of one is the gate
 * that unlocks the contract sign. The database is the real wall (`price_regime_for_lot`
 * + the keystone guard in `sign_sales_contract`); this is the UI's mirror of it.
 */
export function isReserveBand(scaGrade: string | null): boolean {
  return scaGrade === "Presidential" || scaGrade === "Specialty";
}

/**
 * A $0 public-tracker deep link from the plain-text courier + tracking number — NO
 * paid carrier API (the slice's paid-gate, spec §221). Known carriers get their public
 * tracking page; an unknown courier falls back to a generic web search for the number.
 * Returns null when there is no tracking number to link.
 */
export function trackingUrl(
  courier: string | null,
  trackingNo: string | null,
): string | null {
  if (!trackingNo || !trackingNo.trim()) return null;
  const code = encodeURIComponent(trackingNo.trim());
  const c = (courier ?? "").toLowerCase();
  if (c.includes("dhl")) {
    return `https://www.dhl.com/en/express/tracking.html?AWB=${code}`;
  }
  if (c.includes("fedex")) {
    return `https://www.fedex.com/fedextrack/?trknbr=${code}`;
  }
  if (c.includes("ups")) {
    return `https://www.ups.com/track?tracknum=${code}`;
  }
  // No carrier API and an unrecognised courier — a generic web search is the $0 path.
  return `https://www.google.com/search?q=${code}`;
}

/**
 * The open sample pipeline: every dispatched sample still awaiting a buyer verdict,
 * newest first. The view is tenant-scoped (security_invoker + RLS) and verdict-open
 * only — a recorded verdict drops the row off this board.
 */
export const getSamplePipeline = cache(async (): Promise<SamplePipelineRow[]> => {
  const sb = await getSupabase();
  const { data, error } = await sb
    .from("v_sample_pipeline")
    .select("*")
    .order("dispatched_at", { ascending: false });
  if (error) throw new Error(`getSamplePipeline: ${error.message}`);
  return (data as SampleViewRow[]).map(mapSamplePipelineRow);
});

/**
 * The option lists the "log a sample" form needs: every green lot (from the granted,
 * tenant-scoped price-book view) and every buyer on file. Both degrade to an empty
 * list rather than throwing the page — a sample can still be logged against a typed
 * lot code if the lookup is momentarily empty.
 */
export const getSampleFormOptions = cache(
  async (): Promise<SampleFormOptions> => {
    const sb = await getSupabase();
    const [lotsRes, buyersRes] = await Promise.all([
      sb
        .from("v_lot_price_book")
        .select("green_lot_code, sca_grade, cupping_score")
        .order("green_lot_code"),
      sb.from("b2b_buyers").select("id, name").order("name"),
    ]);

    const lots: LotOption[] = (
      (lotsRes.data as
        | { green_lot_code: string; sca_grade: string | null; cupping_score: number | string | null }[]
        | null) ?? []
    ).map((l) => ({
      code: l.green_lot_code,
      scaGrade: l.sca_grade,
      cuppingScore: n(l.cupping_score),
    }));

    const buyers: BuyerOption[] = (
      (buyersRes.data as { id: number; name: string }[] | null) ?? []
    ).map((b) => ({ id: b.id, name: b.name }));

    return { lots, buyers };
  },
);
