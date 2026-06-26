import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/* ====================================================================== */
/* P3-S7 — Dry-milling readiness + run-skeleton READ-port. The dry mill is  */
/* where a rested parchment lot becomes green: it runs through the chain     */
/* (huller→polisher→screen-grader→gravity-table→optical-sorter) and the      */
/* outturn (green-kg-out ÷ parchment-kg-in) is the single biggest cost/yield */
/* number on the farm. THE GATE: a parchment lot physically CANNOT open a    */
/* milling run until a PASSING `mill_readiness` row exists — in-spec moisture */
/* (10.5–11.5%), in-spec water-activity (aw < 0.60), AND the upstream P2-S4   */
/* reposo clearance — enforced at the DATA layer (the `open_milling_run` RPC),*/
/* not just the UI. The only writers are the SECURITY DEFINER RPCs in the     */
/* command ports (`record_mill_readiness`, `open_milling_run`). This port     */
/* only READS. Mirrors the pricing.ts / samples.ts shape: `Row` interface +   */
/* pure `mapX` mapper + `cache()`'d getters; NULLs (an un-finalized run's      */
/* green_kg_out / outturn_pct, a machine's un-set calibration date) are        */
/* PRESERVED, never fabricated to 0 — the UI shows "—" instead of a number.    */
/* The DB-GENERATED `passed` verdict is carried VERBATIM (never recomputed).   */
/* ====================================================================== */

/** A milling run's lifecycle status — mirrors the `milling_runs.status` CHECK. */
export type MillingRunStatus = "readiness_pending" | "open" | "finalized";

/** A dry-mill machine's kind — mirrors the P3-S6 `pass_type` enum. */
export type PassType =
  | "huller"
  | "polisher"
  | "screen_grader"
  | "gravity_table"
  | "optical_sorter";

/** Coerce a nullable numeric (PostgREST may serialize as a string) to a number,
 *  PRESERVING null — an un-finalized run's green_kg_out / outturn_pct or a machine's
 *  un-set calibration date stays null (never a fabricated 0). */
function num(v: number | string | null | undefined): number | null {
  return v == null ? null : Number(v);
}

/* ---------------- v_milling_runs ---------------- */

/** Shape of a `v_milling_runs` row as returned by PostgREST (snake_case).
 *  `green_kg_out` / `outturn_pct` are NULL until the run is finalized (S7 is the
 *  run skeleton — finalize lands downstream). */
export interface MillingRunRow {
  run_id: number | string;
  parchment_lot_code: string;
  parchment_kg_in: number | string;
  green_kg_out: number | string | null;
  outturn_pct: number | string | null;
  status: MillingRunStatus | string;
  opened_at: string;
}

/** One parchment lot's milling run — the /mill board's row. */
export interface MillingRunEntry {
  runId: number;
  parchmentLotCode: string;
  parchmentKgIn: number;
  /** Green kg produced. NULL ⇒ the run isn't finalized yet (shown as "—"). */
  greenKgOut: number | null;
  /** Outturn fraction (green ÷ parchment). NULL ⇒ not finalized (shown as "—"). */
  outturnPct: number | null;
  status: MillingRunStatus | string;
  openedAt: string;
}

/** Pure row → domain mapper for a milling run (numeric coercion; NULL green-out /
 *  outturn preserved, never fabricated). */
export function mapMillingRun(r: MillingRunRow): MillingRunEntry {
  return {
    runId: Number(r.run_id),
    parchmentLotCode: r.parchment_lot_code,
    parchmentKgIn: Number(r.parchment_kg_in),
    greenKgOut: num(r.green_kg_out),
    outturnPct: num(r.outturn_pct),
    status: r.status,
    openedAt: r.opened_at,
  };
}

/* ---------------- v_mill_readiness ---------------- */

/** Shape of a `v_mill_readiness` row as returned by PostgREST (snake_case) — the
 *  latest readiness measurement per parchment lot. `passed` is a DB-GENERATED
 *  verdict (in-spec moisture + aw + reposo-cleared); the port never recomputes it. */
export interface MillReadinessRow {
  parchment_lot_code: string;
  moisture_pct: number | string;
  water_activity_aw: number | string;
  reposo_ready: boolean;
  passed: boolean;
  measured_at: string;
}

/** The latest readiness reading for a parchment lot — the pre-mill gate panel's row. */
export interface MillReadinessEntry {
  parchmentLotCode: string;
  moisturePct: number;
  waterActivityAw: number;
  /** Snapshot of the upstream P2-S4 reposo clearance at measurement time. */
  reposoReady: boolean;
  /** The DB-GENERATED gate verdict — in-spec moisture AND aw AND reposo-cleared. */
  passed: boolean;
  measuredAt: string;
}

/** Pure row → domain mapper for a readiness reading (numeric coercion of moisture/aw;
 *  the DB-GENERATED `passed` + `reposo_ready` booleans carried verbatim). */
export function mapMillReadiness(r: MillReadinessRow): MillReadinessEntry {
  return {
    parchmentLotCode: r.parchment_lot_code,
    moisturePct: Number(r.moisture_pct),
    waterActivityAw: Number(r.water_activity_aw),
    reposoReady: r.reposo_ready,
    passed: r.passed,
    measuredAt: r.measured_at,
  };
}

/* ---------------- mill_machines ---------------- */

/** Shape of a `mill_machines` registry row (snake_case). `calibration_due` is NULL
 *  when no calibration date is set. */
export interface MillMachineRow {
  id: number | string;
  kind: PassType | string;
  name: string;
  hours_run: number | string;
  calibration_due: string | null;
  created_at: string;
}

/** One dry-mill machine in the chain registry (huller→…→optical-sorter). */
export interface MillMachine {
  id: number;
  kind: PassType | string;
  name: string;
  hoursRun: number;
  /** ISO date the machine is next due for calibration. NULL ⇒ none set. */
  calibrationDue: string | null;
  createdAt: string;
}

/** Pure row → domain mapper for a mill machine (numeric coercion of id/hours;
 *  NULL calibration date preserved). */
export function mapMillMachine(r: MillMachineRow): MillMachine {
  return {
    id: Number(r.id),
    kind: r.kind,
    name: r.name,
    hoursRun: Number(r.hours_run),
    calibrationDue: r.calibration_due,
    createdAt: r.created_at,
  };
}

/* ---------------- getters (request-scoped cache) ---------------- */

/**
 * Every milling run (`v_milling_runs`), newest-opened first — the /mill board read
 * model. Open runs show their parchment-kg-in; finalized runs carry green-kg-out and
 * the outturn fraction (NULL on both until finalize lands, surfaced as "—").
 */
export const getMillingRuns = cache(async (): Promise<MillingRunEntry[]> => {
  const { data, error } = await (await getSupabase())
    .from("v_milling_runs")
    .select("*")
    .order("opened_at", { ascending: false });
  if (error) throw new Error(`getMillingRuns: ${error.message}`);
  return (data as MillingRunRow[]).map(mapMillingRun);
});

/**
 * The latest readiness reading per parchment lot (`v_mill_readiness`) — the gate
 * panel's data, ordered by lot. Each row's `passed` is the DB's verdict (in-spec
 * moisture + aw + reposo-cleared); a lot with no passing reading can't open a run.
 */
export const getMillReadiness = cache(
  async (): Promise<MillReadinessEntry[]> => {
    const { data, error } = await (await getSupabase())
      .from("v_mill_readiness")
      .select("*")
      .order("parchment_lot_code");
    if (error) throw new Error(`getMillReadiness: ${error.message}`);
    return (data as MillReadinessRow[]).map(mapMillReadiness);
  },
);

/**
 * One parchment lot's latest readiness reading (`v_mill_readiness` filtered to the
 * lot), or `null` when the lot has no reading yet — the blocking "Reposo / Spec gate"
 * modal reads this to decide whether the run can open (and to show why it can't).
 */
export const getMillReadinessForLot = cache(
  async (lot: string): Promise<MillReadinessEntry | null> => {
    const { data, error } = await (await getSupabase())
      .from("v_mill_readiness")
      .select("*")
      .eq("parchment_lot_code", lot);
    if (error) throw new Error(`getMillReadinessForLot: ${error.message}`);
    const rows = (data as MillReadinessRow[] | null) ?? [];
    return rows.length > 0 ? mapMillReadiness(rows[0]) : null;
  },
);

/**
 * The dry-mill chain registry (`mill_machines`) — the five seeded stages with their
 * hours-run and calibration-due dates. A read-only reference surface for the /mill UI
 * (the registry is owner-seeded; there is no client write path in S7).
 */
export const listMillMachines = cache(async (): Promise<MillMachine[]> => {
  const { data, error } = await (await getSupabase())
    .from("mill_machines")
    .select("*")
    .order("id");
  if (error) throw new Error(`listMillMachines: ${error.message}`);
  return (data as MillMachineRow[]).map(mapMillMachine);
});
