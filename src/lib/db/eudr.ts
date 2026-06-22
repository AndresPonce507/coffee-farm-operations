import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";
import { getGreenLotAtp } from "@/lib/db/greenlots";
import type {
  EudrOriginPlot,
  EudrStatus,
  LotEudrDossier,
  PlotOriginStatus,
} from "@/lib/types";

/* ====================================================================== */
/* S8 — EUDR due-diligence traceability read-port (ADR-003 derived-read).  */
/* "Provenance IS the product", made auditable: a green lot's plots of      */
/* origin (resolved by the lot_origin_plots UP-walk over the S3 lot graph)  */
/* each carrying the two EUDR facts — geolocated (an S1 GeoJSON polygon)    */
/* and declared deforestation-free since the 2020-12-31 cutoff. The         */
/* eudr_lot_status() RPC is the authoritative verdict (security_invoker —   */
/* RLS-respecting); this port only READS. The sole write path is the        */
/* eudr_declare_plot() command (owned by the Server Action, not here).      */
/* Mirrors the greenlots.ts / cogs.ts shape: Row iface + pure map + cache(). */
/* ====================================================================== */

/** A `lot_origin_plots` row as PostgREST returns it (snake_case). `centroid` is
 *  the plot's GeoJSON Point (jsonb), null when the plot isn't geolocated. */
export interface OriginPlotRow {
  green_lot_code: string;
  plot_id: string;
  plot_name: string;
  established_year: number;
  centroid: { type: "Point"; coordinates: [number, number] } | null;
  geolocated: boolean;
  deforestation_free: boolean;
  decl_basis: string | null;
}

/** Pure row → domain mapper. Flattens the GeoJSON Point to a [lng, lat] tuple
 *  (null when ungeolocated) so the dossier UI never touches raw GeoJSON. */
export function mapOriginPlot(r: OriginPlotRow): EudrOriginPlot {
  return {
    plotId: r.plot_id,
    plotName: r.plot_name,
    establishedYear: r.established_year,
    centroid: r.centroid?.coordinates ?? null,
    geolocated: r.geolocated,
    deforestationFree: r.deforestation_free,
    declBasis: r.decl_basis,
  };
}

/**
 * The authoritative EUDR verdict for one green lot via the `eudr_lot_status` RPC
 * (security_invoker — reads lot_origin_plots under the caller's RLS). Falls back
 * to 'no-origin' on a null/absent verdict — origin that can't be substantiated is
 * surfaced honestly, never silently upgraded to a pass.
 */
export const getLotEudrStatus = cache(
  async (code: string): Promise<EudrStatus> => {
    const { data, error } = await (await getSupabase()).rpc("eudr_lot_status", {
      p_lot_code: code,
    });
    if (error) throw new Error(`getLotEudrStatus: ${error.message}`);
    return (data as EudrStatus | null) ?? "no-origin";
  },
);

/**
 * The plots of origin behind a green lot (the lot_origin_plots UP-walk), ordered
 * by plot id. Each row carries the two EUDR facts the dossier turns on.
 */
export const getLotOriginPlots = cache(
  async (code: string): Promise<EudrOriginPlot[]> => {
    const { data, error } = await (await getSupabase())
      .from("lot_origin_plots")
      .select("*")
      .eq("green_lot_code", code)
      .order("plot_id", { ascending: true });
    if (error) throw new Error(`getLotOriginPlots: ${error.message}`);
    return (data as OriginPlotRow[]).map(mapOriginPlot);
  },
);

/**
 * A green lot's full EUDR dossier — the authoritative RPC verdict + its plots of
 * origin, fetched together. The verdict is the SSOT (computed in-DB over the same
 * rows), so the badge and the per-plot list always agree.
 */
export const getLotEudrDossier = cache(
  async (code: string): Promise<LotEudrDossier> => {
    const [status, originPlots] = await Promise.all([
      getLotEudrStatus(code),
      getLotOriginPlots(code),
    ]);
    return { code, status, originPlots };
  },
);

/**
 * One PLOT's EUDR origin status (for the /plots/[id] dossier, facet-02 §7) — the
 * plot's own due-diligence facts (geolocation + deforestation-free declaration +
 * basis) and the distinct green lots its cherries feed. Reads the same
 * `lot_origin_plots` view the lot dossier reads, narrowed to a single plot: each
 * returned row is the plot under one green lot, all carrying identical plot-level
 * facts, so the first row supplies the facts and every row contributes a fed-lot
 * code. Returns null when the plot feeds no green lot (origin that can't be
 * substantiated is surfaced honestly, never a fabricated pass). Read-only.
 */
export const getPlotOriginStatus = cache(
  async (plotId: string): Promise<PlotOriginStatus | null> => {
    const { data, error } = await (await getSupabase())
      .from("lot_origin_plots")
      .select("*")
      .eq("plot_id", plotId)
      .order("green_lot_code", { ascending: true });
    if (error) throw new Error(`getPlotOriginStatus: ${error.message}`);

    const rows = (data as OriginPlotRow[]) ?? [];
    if (rows.length === 0) return null;

    const facts = mapOriginPlot(rows[0]);
    const feedsLots = Array.from(
      new Set(rows.map((r) => r.green_lot_code)),
    );
    return {
      plotId: facts.plotId,
      plotName: facts.plotName,
      establishedYear: facts.establishedYear,
      centroid: facts.centroid,
      geolocated: facts.geolocated,
      deforestationFree: facts.deforestationFree,
      declBasis: facts.declBasis,
      feedsLots,
    };
  },
);

/**
 * The EUDR compliance summary across every green lot — each green lot's dossier,
 * for the /eudr overview. Reads the green-lot inventory (greenlots port) then
 * resolves each lot's dossier in parallel.
 */
export const getEudrSummary = cache(async (): Promise<LotEudrDossier[]> => {
  const lots = await getGreenLotAtp();
  return Promise.all(lots.map((l) => getLotEudrDossier(l.greenLotCode)));
});
