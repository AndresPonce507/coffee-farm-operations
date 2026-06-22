import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";
import {
  mapPlotPhiStatus,
  mapSprayLogEntry,
  mapIpmThreshold,
  type PlotPhiStatusRow,
  type SprayLogRow,
  type IpmThresholdRow,
} from "@/lib/db/remote-sensing";
import { getWorkers } from "@/lib/db/workers";
import type {
  IpmThresholdStatus,
  Plot,
  PlotPhiStatus,
  SprayLogEntry,
} from "@/lib/types";

/* ====================================================================== */
/* /plots/[id] DOSSIER (US-03) — plot-scoped composition getters.          */
/*                                                                          */
/* Thin, additive, READ-ONLY. Each one NARROWS an existing derived view to  */
/* a single plot (the same v_plot_phi_status / v_spray_history /            */
/* v_ipm_threshold the /satellite + /scouting boards read), so the dossier  */
/* never re-implements a query or touches the command-RPC write door. They  */
/* live in this dossier-scoped file (NOT appended to the shared             */
/* remote-sensing.ts / plots.ts getter files) so the parallel DELIVER fleet */
/* stays file-disjoint. The anchor getter (getPlotById) and the cross-      */
/* dossier getters (getHarvestsForPlot, getPlotOriginStatus, getPlotCost,   */
/* getPlotVegetation) already exist and are imported read-only by the page. */
/* ====================================================================== */

/**
 * The active PHI/REI windows for ONE plot — the dossier's "sprays + PHI status"
 * section (the harvest-block chips). Narrows the same `v_plot_phi_status` view the
 * /satellite + /scouting boards read to a single plot, most-recent application
 * first. Returns [] when the plot has no active window (honest empty, not a
 * throw) so the section renders its empty state. Read-only.
 */
export const getPlotPhiWindows = cache(
  async (plotId: string): Promise<PlotPhiStatus[]> => {
    const { data, error } = await (await getSupabase())
      .from("v_plot_phi_status")
      .select("*")
      .eq("plot_id", plotId)
      .order("phi_clears_on", { ascending: false });
    if (error) throw new Error(`getPlotPhiWindows: ${error.message}`);
    return (data as PlotPhiStatusRow[]).map(mapPlotPhiStatus);
  },
);

/**
 * The append-only spray log for ONE plot — the dossier's spray-history list (each
 * row's applicator links to that worker's dossier). Narrows `v_spray_history` to a
 * single plot, most-recent first. [] for a plot never sprayed (honest empty).
 * Read-only.
 */
export const getPlotSprayHistory = cache(
  async (plotId: string): Promise<SprayLogEntry[]> => {
    const { data, error } = await (await getSupabase())
      .from("v_spray_history")
      .select("*")
      .eq("plot_id", plotId)
      .order("applied_at", { ascending: false });
    if (error) throw new Error(`getPlotSprayHistory: ${error.message}`);
    return (data as SprayLogRow[]).map(mapSprayLogEntry);
  },
);

/**
 * The latest IPM scouting threshold status per pest for ONE plot — the dossier's
 * "scouting" section (the recommend/hold calls from the economic-threshold
 * engine). Narrows `v_ipm_threshold` to a single plot, recommend-first so a pest
 * needing a control intervention surfaces at the top. [] when the plot has no
 * scouting reads (honest empty). Read-only.
 */
export const getPlotScouting = cache(
  async (plotId: string): Promise<IpmThresholdStatus[]> => {
    const { data, error } = await (await getSupabase())
      .from("v_ipm_threshold")
      .select("*")
      .eq("plot_id", plotId)
      .order("recommend", { ascending: false })
      .order("incidence_pct", { ascending: false });
    if (error) throw new Error(`getPlotScouting: ${error.message}`);
    return (data as IpmThresholdRow[]).map(mapIpmThreshold);
  },
);

/**
 * Resolve a worker NAME → its stable worker id, for the harvest section's
 * picker → /workers/[id] link. `harvests_view.picker` is the worker's display
 * name (not its id), but EntityLink/`entityHref.worker` route by id — so the
 * dossier maps name → id once here from the live roster. Returns a plain
 * `Record<name, id>`; an unknown picker (a name with no matching worker row)
 * simply has no entry, and the section renders that picker as plain text rather
 * than a broken link. Read-only.
 */
export const getPickerIdByName = cache(
  async (): Promise<Record<string, string>> => {
    const workers = await getWorkers();
    return Object.fromEntries(workers.map((w) => [w.name, w.id]));
  },
);

/**
 * The season yield rollup for ONE plot — a pure, derived view over the plot's own
 * `expectedYieldKg` / `harvestedKg` fields (already on the anchor `Plot`), so the
 * dossier's "yield" section reads a single shaped object instead of recomputing
 * the ratio inline. `pct` is null when the season target is 0/undeclared (no
 * divide-by-zero — the UI shows "—", never a fabricated 0%). Read-only; takes the
 * already-resolved anchor plot (no extra fetch).
 */
export interface PlotYield {
  plotId: string;
  expectedYieldKg: number;
  harvestedKg: number;
  /** harvested ÷ expected as a percentage, null when expected is 0/undeclared. */
  pct: number | null;
}

export function getPlotYield(plot: Plot): PlotYield {
  const pct =
    plot.expectedYieldKg > 0
      ? (plot.harvestedKg / plot.expectedYieldKg) * 100
      : null;
  return {
    plotId: plot.id,
    expectedYieldKg: plot.expectedYieldKg,
    harvestedKg: plot.harvestedKg,
    pct,
  };
}
