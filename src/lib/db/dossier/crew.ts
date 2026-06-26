import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";
import {
  mapDispatchCard,
  type DispatchCardPlotRow,
  type DispatchCardRow,
} from "@/lib/db/dispatch";
import {
  mapWeighByPicker,
  type WeighByPickerRow,
} from "@/lib/db/weigh";
import type { DispatchCard } from "@/lib/types";

/* ====================================================================== */
/* Phase 5 L2 — /crew/[id] DOSSIER read-port (crew-dossier-scoped).        */
/*                                                                         */
/* The crew dossier's anchor + roster come from the FROZEN people read-    */
/* port (getCrewById / getCrewRoster in people.ts — imported read-only by  */
/* the page, never duplicated here). THIS file owns only the three NEW,    */
/* additive, schema-lane-free getters the dossier's deeper sections need,  */
/* each composed from EXISTING views (no migration, no new table, no write */
/* door): the crew's dispatch HISTORY (every run across dates), the        */
/* distinct PLOTS that history assigns the crew to, and today's per-picker */
/* PRODUCTIVITY tally for the crew. Mirrors the dispatch.ts / weigh.ts      */
/* shape: cache()'d getter, snake_case → camelCase via the existing pure   */
/* mappers, numeric coercion via Number(). Writes never flow through here.  */
/* ====================================================================== */

/* ---------------------------------------------------------------------- */
/* Dispatch history — v_dispatch_card (crew-scoped, NOT date-pinned)       */
/* ---------------------------------------------------------------------- */

/**
 * EVERY dispatch run this crew has received, across all mornings — the crew
 * dossier's dispatch-history section. Unlike `getDispatchToday` (date-pinned to
 * one morning's board) this is keyed purely on `crew_id`, so the dossier shows
 * the crew's full run timeline (newest morning first). Reads `v_dispatch_card`
 * for the headers, then `v_dispatch_card_plots` for this crew's runs in one
 * query (grouped by run in memory — no N+1), and assembles each card with its
 * plot lines in display order via the existing `mapDispatchCard`.
 *
 * Returns `[]` for a crew with no runs (honest empty — the section shows its
 * zero state, never a fabricated run). Read-only.
 */
export const getCrewDispatchHistory = cache(
  async (crewId: string): Promise<DispatchCard[]> => {
    const client = await getSupabase();

    const { data: cardData, error: cardError } = await client
      .from("v_dispatch_card")
      .select("*")
      .eq("crew_id", crewId)
      .order("dispatch_date", { ascending: false });
    if (cardError) {
      throw new Error(`getCrewDispatchHistory: ${cardError.message}`);
    }

    const cardRows = cardData as DispatchCardRow[];
    if (cardRows.length === 0) return [];

    const runIds = cardRows.map((c) => Number(c.id));
    const { data: plotData, error: plotError } = await client
      .from("v_dispatch_card_plots")
      .select("*")
      .in("dispatch_run_id", runIds);
    if (plotError) {
      throw new Error(`getCrewDispatchHistory: ${plotError.message}`);
    }

    // Group the plot lines by their run id once (avoids a per-card query).
    const plotsByRun = new Map<number, DispatchCardPlotRow[]>();
    for (const row of plotData as DispatchCardPlotRow[]) {
      const runId = Number(row.dispatch_run_id);
      const bucket = plotsByRun.get(runId);
      if (bucket) bucket.push(row);
      else plotsByRun.set(runId, [row]);
    }

    return cardRows.map((cardRow) =>
      mapDispatchCard(cardRow, plotsByRun.get(Number(cardRow.id)) ?? []),
    );
  },
);

/* ---------------------------------------------------------------------- */
/* Assigned plots — derived from the crew's dispatch history               */
/* ---------------------------------------------------------------------- */

/** One distinct plot this crew is assigned to (derived from its dispatch runs). */
export interface CrewAssignedPlot {
  plotId: string;
  plotName: string;
  variety: string;
  altitudeMasl: number;
  /** How many of the crew's runs include this plot (the assignment frequency). */
  runCount: number;
  /** The most recent morning a run sent the crew to this plot (ISO date). */
  lastDispatchDate: string;
}

/**
 * Collapse a list of dispatch cards into the DISTINCT plots the crew has been
 * assigned to — the dossier's "assigned plots" section. Each plot carries how
 * many of the crew's runs include it and the most recent morning it was sent, so
 * the section reads as "where this crew works", ordered by recency then name.
 *
 * Pure derivation (no I/O) so it is unit-testable with fixture cards and shared
 * by the getter + any caller that already holds the history.
 */
export function deriveAssignedPlots(history: DispatchCard[]): CrewAssignedPlot[] {
  const byPlot = new Map<string, CrewAssignedPlot>();
  for (const card of history) {
    for (const line of card.plots) {
      const existing = byPlot.get(line.plotId);
      if (existing) {
        existing.runCount += 1;
        if (card.dispatchDate > existing.lastDispatchDate) {
          existing.lastDispatchDate = card.dispatchDate;
        }
      } else {
        byPlot.set(line.plotId, {
          plotId: line.plotId,
          plotName: line.plotName,
          variety: line.variety,
          altitudeMasl: line.altitudeMasl,
          runCount: 1,
          lastDispatchDate: card.dispatchDate,
        });
      }
    }
  }
  return Array.from(byPlot.values()).sort(
    (a, b) =>
      b.lastDispatchDate.localeCompare(a.lastDispatchDate) ||
      a.plotName.localeCompare(b.plotName),
  );
}

/**
 * The distinct plots this crew is assigned to, derived from its full dispatch
 * history. Composes `getCrewDispatchHistory` then `deriveAssignedPlots`. Returns
 * `[]` for a crew with no runs. Read-only.
 */
export const getCrewAssignedPlots = cache(
  async (crewId: string): Promise<CrewAssignedPlot[]> => {
    const history = await getCrewDispatchHistory(crewId).catch((e: unknown) => {
      throw new Error(
        `getCrewAssignedPlots: ${(e as Error).message.replace(
          /^getCrewDispatchHistory: /,
          "",
        )}`,
      );
    });
    return deriveAssignedPlots(history);
  },
);

/* ---------------------------------------------------------------------- */
/* Productivity — v_weigh_today_by_picker (crew-scoped)                    */
/* ---------------------------------------------------------------------- */

import type { WeighByPicker } from "@/lib/db/weigh";

/** The crew's productivity roll-up for today — its members' weigh tallies plus
 *  the crew totals the dossier's productivity section headlines. */
export interface CrewProductivity {
  /** Per-member tally today (kg + lata count), highest kg first. */
  pickers: WeighByPicker[];
  /** Σ kg captured by the crew today. */
  totalKg: number;
  /** Σ latas captured by the crew today. */
  totalLatas: number;
  /** How many of the crew's members have weighed in today. */
  pickerCount: number;
}

/** Pure roll-up of per-picker tallies into the crew productivity shape. */
export function summarizeProductivity(pickers: WeighByPicker[]): CrewProductivity {
  const sorted = [...pickers].sort((a, b) => b.kgToday - a.kgToday);
  return {
    pickers: sorted,
    totalKg: sorted.reduce((sum, p) => sum + p.kgToday, 0),
    totalLatas: sorted.reduce((sum, p) => sum + p.lataCount, 0),
    pickerCount: sorted.length,
  };
}

/**
 * Today's per-picker productivity for this crew — reads the SAME
 * `v_weigh_today_by_picker` view the weigh board reads, narrowed to the crew's
 * members via `crew_id`, then rolled up (Σ kg / Σ latas / picker count). The
 * crew dossier's productivity section headlines the totals and lists each member
 * (linkable to their /workers/[id] dossier). Honest-empty: a crew that has not
 * weighed in today returns zeroed totals + no pickers. Read-only.
 */
export const getCrewProductivity = cache(
  async (crewId: string): Promise<CrewProductivity> => {
    const { data, error } = await (await getSupabase())
      .from("v_weigh_today_by_picker")
      .select("*")
      .eq("crew_id", crewId)
      .order("kg_today", { ascending: false });
    if (error) throw new Error(`getCrewProductivity: ${error.message}`);
    const pickers = (data as WeighByPickerRow[]).map(mapWeighByPicker);
    return summarizeProductivity(pickers);
  },
);
