import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/**
 * /p/[slug] PUBLIC read port (P3-S13 provenance microsite).
 *
 * Binds to the ONE anon door in all of Phase 3: the `resolve_provenance(slug)`
 * SECURITY DEFINER resolver. It returns the ASSEMBLED public JSON for a PUBLISHED
 * slug ONLY (NULL for unpublished/unknown), reading ONLY the curated whitelist —
 * it can never reach `workers.phone`/`daily_rate_usd`, `cost_entry`/`mv_lot_cost`,
 * `lot_reservations`/buyer, the green-lot `location`, or an unpublished SKU. The
 * keystone (no PII/cost/oversell/unpublished leak) is enforced in the database; this
 * port only maps the already-curated payload to a camelCase domain shape.
 *
 * READ-ONLY and anon-capable: the cookie-aware client runs as the `anon` role for an
 * unauthenticated visitor, which is exactly who scans a bag QR. There is NO write
 * path here — curation (publish/unpublish) lives in the owner-only /(app)/provenance.
 */

/** One origin plot on the lot's UP-walk (lot_origin_plots, PII-free). */
export interface OriginPlot {
  plotName: string | null;
  establishedYear: number | null;
  /** GeoJSON Point reused from the Phase-1 plot centroid; null when ungeolocated. */
  centroid: { type: string; coordinates: [number, number] } | null;
  geolocated: boolean;
  deforestationFree: boolean;
}

/** One leak-safe processing step: kind + when ONLY (the payload is never projected). */
export interface TimelineEvent {
  kind: string;
  occurredAt: string;
}

/** The curated public story of one bag — EXACTLY the whitelisted facts, nothing more. */
export interface Provenance {
  slug: string;
  gtin: string | null;
  curatedStory: string | null;
  greenLotCode: string;
  packFormat: string | null;
  bagSize: string | null;
  productName: string | null;
  variety: string | null;
  process: string | null;
  /** One of the TWO permitted quality facts; NULL when uncupped. */
  cuppingScore: number | null;
  /** The other permitted quality fact (generated band); NULL when uncupped. */
  scaGrade: string | null;
  isSingleOrigin: boolean | null;
  /** 'compliant' | 'incomplete' | 'no-origin' (from eudr_lot_status). */
  eudrStatus: string;
  originPlots: OriginPlot[];
  /** Anonymized crew LABELS only — never a worker name/phone/wage. */
  crewLabels: string[];
  processingTimeline: TimelineEvent[];
}

/** The raw `resolve_provenance` jsonb shape (snake_case keys, as the DB assembles). */
interface ProvenanceJson {
  slug: string;
  gtin: string | null;
  curated_story: string | null;
  green_lot_code: string;
  pack_format: string | null;
  bag_size: string | null;
  product_name: string | null;
  variety: string | null;
  process: string | null;
  cupping_score: number | string | null;
  sca_grade: string | null;
  is_single_origin: boolean | null;
  eudr_status: string | null;
  origin_plots: Array<{
    plot_name: string | null;
    established_year: number | null;
    centroid: { type: string; coordinates: [number, number] } | null;
    geolocated: boolean | null;
    deforestation_free: boolean | null;
  }> | null;
  crew_labels: Array<string | null> | null;
  processing_timeline: Array<{ kind: string; occurred_at: string }> | null;
}

const n = (v: number | string | null | undefined): number | null =>
  v == null ? null : Number(v);

function mapProvenance(j: ProvenanceJson): Provenance {
  return {
    slug: j.slug,
    gtin: j.gtin ?? null,
    curatedStory: j.curated_story ?? null,
    greenLotCode: j.green_lot_code,
    packFormat: j.pack_format ?? null,
    bagSize: j.bag_size ?? null,
    productName: j.product_name ?? null,
    variety: j.variety ?? null,
    process: j.process ?? null,
    cuppingScore: n(j.cupping_score),
    scaGrade: j.sca_grade ?? null,
    isSingleOrigin: j.is_single_origin ?? null,
    eudrStatus: j.eudr_status ?? "no-origin",
    originPlots: (j.origin_plots ?? []).map((p) => ({
      plotName: p.plot_name ?? null,
      establishedYear: p.established_year ?? null,
      centroid: p.centroid ?? null,
      geolocated: Boolean(p.geolocated),
      deforestationFree: Boolean(p.deforestation_free),
    })),
    crewLabels: (j.crew_labels ?? []).filter(
      (c): c is string => typeof c === "string" && c.length > 0,
    ),
    processingTimeline: (j.processing_timeline ?? []).map((e) => ({
      kind: e.kind,
      occurredAt: e.occurred_at,
    })),
  };
}

/**
 * Resolve a published bag's public story, or null for an unpublished/unknown slug.
 * cache()'d so generateMetadata + the page de-dupe to a single resolver call.
 */
export const getProvenance = cache(
  async (slug: string): Promise<Provenance | null> => {
    const sb = await getSupabase();
    const { data, error } = await sb.rpc("resolve_provenance", { p_slug: slug });
    if (error) throw new Error(`getProvenance: ${error.message}`);
    if (data == null) return null;
    return mapProvenance(data as ProvenanceJson);
  },
);
