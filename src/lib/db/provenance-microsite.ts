import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/* ====================================================================== */
/* P3-S13 — PUBLIC per-lot QR provenance microsite READ-port (THE security- */
/* critical slice). Binds to the surface the                                */
/* 20260706092000_provenance_microsite.sql migration ships:                 */
/*   • VIEW  sku_provenance_public    — the curated, PUBLISHED-only          */
/*       projection: the ONE anon-readable door in all of Phase 3. Exposes   */
/*       ONLY whitelisted columns (NO worker PII/wage, NO cost, NO buyer, NO */
/*       warehouse location); cupping_score + sca_grade are the only quality */
/*       facts. The migration's PGlite guard pins the no-leak invariant.     */
/*   • RPC   resolve_provenance(p_slug) — the SECURITY DEFINER anon resolver: */
/*       the ASSEMBLED public JSON for a PUBLISHED slug (NULL for            */
/*       unpublished/unknown). Reads ONLY the whitelisted projection + the    */
/*       EUDR / origin-plot / anonymized-crew / leak-safe timeline facts.     */
/*   • TABLE provenance_pages         — the owner curation record (tenant-    */
/*       scoped read for the admin UI; writes flow through the SECDEF RPCs in */
/*       @/lib/db/commands/{publish,unpublish}Provenance — never client UPDATE). */
/* This port only READS. Mirrors the pricing.ts / eudr.ts shape: Row iface + */
/* pure mapper + cache()'d getters; NULLs (unknown cup score / no gtin /      */
/* no story) are PRESERVED, never fabricated.                                */
/* ====================================================================== */

/** Retail pack format (the `pack_format` enum). */
export type PackFormat = "whole-bean" | "ground";

/** Retail bag size (the `bag_size` enum). */
export type BagSize = "250g" | "340g" | "454g" | "1kg" | "12oz";

/** Coerce a nullable numeric (PostgREST may serialize as a string) to a number,
 *  PRESERVING null — an unknown cup score stays null, never a fabricated 0. */
function num(v: number | string | null | undefined): number | null {
  return v == null ? null : Number(v);
}

/* ---------------- sku_provenance_public (the curated anon view) ---------------- */

/** Shape of a `sku_provenance_public` row as PostgREST returns it (snake_case). */
export interface SkuProvenancePublicRow {
  slug: string;
  gtin: string | null;
  curated_story: string | null;
  green_lot_code: string;
  pack_format: PackFormat | string;
  bag_size: BagSize | string;
  product_name: string;
  variety: string | null;
  process: string | null;
  cupping_score: number | string | null;
  sca_grade: string | null;
  is_single_origin: boolean | null;
}

/** The curated, published-only public projection of one retail bag's lot story. */
export interface SkuProvenancePublic {
  slug: string;
  gtin: string | null;
  curatedStory: string | null;
  greenLotCode: string;
  packFormat: PackFormat | string;
  bagSize: BagSize | string;
  productName: string;
  variety: string | null;
  process: string | null;
  /** The lot's cup score. NULL when the lot has no cupping yet (never fabricated). */
  cuppingScore: number | null;
  scaGrade: string | null;
  isSingleOrigin: boolean | null;
}

/** Pure row → domain mapper for the curated public projection (numeric coercion of
 *  the cup score; NULL gtin/story/score/grade preserved, never fabricated). */
export function mapSkuProvenancePublic(
  r: SkuProvenancePublicRow,
): SkuProvenancePublic {
  return {
    slug: r.slug,
    gtin: r.gtin,
    curatedStory: r.curated_story,
    greenLotCode: r.green_lot_code,
    packFormat: r.pack_format,
    bagSize: r.bag_size,
    productName: r.product_name,
    variety: r.variety,
    process: r.process,
    cuppingScore: num(r.cupping_score),
    scaGrade: r.sca_grade,
    isSingleOrigin: r.is_single_origin,
  };
}

/* ---------------- resolve_provenance (the assembled anon JSON) ---------------- */

/** One origin plot in the assembled provenance JSON (the leak-safe public facts:
 *  plot name + EUDR signals + GeoJSON Point centroid — NEVER a worker/cost field). */
export interface ProvenanceOriginPlot {
  plot_name: string;
  established_year: number;
  centroid: { type: "Point"; coordinates: [number, number] } | null;
  geolocated: boolean;
  deforestation_free: boolean;
}

/** One processing milestone in the assembled JSON — leak-safe: kind + occurred_at
 *  ONLY, never the free-form lot_event payload (which could carry anything). */
export interface ProvenanceTimelineEvent {
  kind: string;
  occurred_at: string;
}

/**
 * The ASSEMBLED public JSON `resolve_provenance(p_slug)` returns for a PUBLISHED
 * slug (snake_case — it is the raw definer-built jsonb the public `/p/[slug]`
 * microsite renders). The whitelist is enforced in the DB; this type names exactly
 * what the resolver may surface. `null` for an unpublished/unknown slug.
 */
export interface ResolvedProvenance {
  slug: string;
  gtin: string | null;
  curated_story: string | null;
  green_lot_code: string;
  pack_format: PackFormat | string;
  bag_size: BagSize | string;
  product_name: string;
  variety: string | null;
  process: string | null;
  cupping_score: number | null;
  sca_grade: string | null;
  is_single_origin: boolean | null;
  /** The authoritative EUDR verdict ('compliant' | 'incomplete' | 'no-origin'). */
  eudr_status: string;
  origin_plots: ProvenanceOriginPlot[];
  /** Anonymized crew LABELS only — never a worker name/phone/wage. */
  crew_labels: string[];
  processing_timeline: ProvenanceTimelineEvent[];
}

/* ---------------- provenance_pages (the owner curation record) ---------------- */

/** Shape of a `provenance_pages` row as PostgREST returns it (snake_case). */
export interface ProvenancePageRow {
  id: number;
  sku_id: number;
  slug: string;
  gtin: string | null;
  is_published: boolean;
  curated_story: string | null;
  created_at: string;
  updated_at: string;
}

/** The owner's per-SKU curation record (for the admin curation UI). */
export interface ProvenancePage {
  id: number;
  skuId: number;
  slug: string;
  gtin: string | null;
  isPublished: boolean;
  curatedStory: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Pure row → domain mapper for a curation record. */
export function mapProvenancePage(r: ProvenancePageRow): ProvenancePage {
  return {
    id: Number(r.id),
    skuId: Number(r.sku_id),
    slug: r.slug,
    gtin: r.gtin,
    isPublished: r.is_published,
    curatedStory: r.curated_story,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/* ---------------- getters (request-scoped cache) ---------------- */

/**
 * Every PUBLISHED bag's curated public projection (`sku_provenance_public`), ordered
 * by slug — the owner's "what's live on jansoncoffee.com" index. Only published rows
 * appear (the view's `where is_published` gate); nothing PII/cost/buyer can surface.
 */
export const getPublicProvenance = cache(
  async (): Promise<SkuProvenancePublic[]> => {
    const { data, error } = await (await getSupabase())
      .from("sku_provenance_public")
      .select("*")
      .order("slug");
    if (error) throw new Error(`getPublicProvenance: ${error.message}`);
    return (data as SkuProvenancePublicRow[]).map(mapSkuProvenancePublic);
  },
);

/**
 * One PUBLISHED bag's curated projection by slug (`sku_provenance_public` filtered),
 * or `null` when no published page matches (notFound() territory for `/p/[slug]`).
 */
export const getPublicProvenanceBySlug = cache(
  async (slug: string): Promise<SkuProvenancePublic | null> => {
    const { data, error } = await (await getSupabase())
      .from("sku_provenance_public")
      .select("*")
      .eq("slug", slug);
    if (error) throw new Error(`getPublicProvenanceBySlug: ${error.message}`);
    const rows = (data as SkuProvenancePublicRow[] | null) ?? [];
    return rows.length > 0 ? mapSkuProvenancePublic(rows[0]) : null;
  },
);

/**
 * The ASSEMBLED public provenance JSON for a slug via the SECURITY DEFINER
 * `resolve_provenance` RPC — the public `/p/[slug]` microsite read (served to anon).
 * Returns the full assembled story (product + cup score + SCA grade + EUDR status +
 * origin plots + anonymized crew + leak-safe processing timeline) for a PUBLISHED
 * slug, or `null` for an unpublished/unknown slug (the curation gate). The resolver
 * is the SSOT: the whitelist lives in the DB, so this read can never reach worker
 * PII, cost, a buyer, or an unpublished page.
 */
export const resolveProvenance = cache(
  async (slug: string): Promise<ResolvedProvenance | null> => {
    const { data, error } = await (await getSupabase()).rpc(
      "resolve_provenance",
      { p_slug: slug },
    );
    if (error) throw new Error(`resolveProvenance: ${error.message}`);
    return (data as ResolvedProvenance | null) ?? null;
  },
);

/**
 * The owner's curation records (`provenance_pages`) — tenant-scoped by RLS — for the
 * admin curation UI (published + draft). Newest-touched first. Anon never sees this
 * table; it only ever reads the published view + the resolver.
 */
export const getProvenancePages = cache(async (): Promise<ProvenancePage[]> => {
  const { data, error } = await (await getSupabase())
    .from("provenance_pages")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`getProvenancePages: ${error.message}`);
  return (data as ProvenancePageRow[]).map(mapProvenancePage);
});
