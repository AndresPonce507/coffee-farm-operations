import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/**
 * /mill read port (P3-S7 mill readiness + run skeleton).
 *
 * Co-located with the route on purpose: it binds DIRECTLY to the authoritative SQL
 * surface the P3-S7 migration shipped — the `v_milling_runs` / `v_mill_readiness`
 * views, the `mill_machines` registry, and the upstream Phase-2 `v_reposo_status`
 * (the reposo clearance the doc calls "cleared_for_milling"). A parallel fan-out
 * builds the shared `@/lib/db/*` ports in sibling files; importing a not-yet-landed
 * module would hard-fail Vite's import-analysis at BOTH test and build time, so this
 * port talks to the frozen view/column names directly. The Wiring pass can collapse
 * it into a shared port (one import swap) once that lands.
 *
 * READ-ONLY. Every write goes through the SECURITY DEFINER RPCs in `actions.ts`
 * (`record_mill_readiness`, `open_milling_run`). The board NEVER fabricates a gate
 * verdict: a lot with no reposo clearance and no passing reading reads "blocked",
 * not "ready".
 */

/** The dry-mill chain registry (huller -> polisher -> ... -> optical sorter). */
export interface MillMachine {
  id: number;
  kind: string;
  name: string;
  hoursRun: number;
  calibrationDue: string | null;
}

/** The latest mill-readiness measurement for a parchment lot (the spec gate). */
export interface MillReadinessSnapshot {
  moisturePct: number;
  waterActivityAw: number;
  /** snapshot of reposo_status(lot).ready taken at measurement time. */
  reposoReady: boolean;
  /** GENERATED in the DB: moisture 10.5-11.5% AND aw < 0.60 AND reposoReady. */
  passed: boolean;
  measuredAt: string;
}

/** A milling run (skeleton in S7: open at creation; green_kg_out lands downstream). */
export interface MillRunSnapshot {
  runId: number;
  parchmentKgIn: number;
  greenKgOut: number | null;
  /** fraction (green/parchment); NULL until green_kg_out is known. */
  outturnPct: number | null;
  status: string;
  openedAt: string;
}

/** One parchment lot's place in the mill pipeline: reposo + readiness + run state. */
export interface MillLotRow {
  parchmentLotCode: string;
  /** v_reposo_status.ready — the live upstream clearance; NULL if not resting. */
  reposoReady: boolean | null;
  reposoReason: string | null;
  latestMoisture: number | null;
  readiness: MillReadinessSnapshot | null;
  run: MillRunSnapshot | null;
}

interface MachineRow {
  id: number;
  kind: string;
  name: string;
  hours_run: number | string | null;
  calibration_due: string | null;
}

interface ReadinessViewRow {
  parchment_lot_code: string;
  moisture_pct: number | string | null;
  water_activity_aw: number | string | null;
  reposo_ready: boolean | null;
  passed: boolean | null;
  measured_at: string;
}

interface RunViewRow {
  run_id: number;
  parchment_lot_code: string;
  parchment_kg_in: number | string | null;
  green_kg_out: number | string | null;
  outturn_pct: number | string | null;
  status: string;
  opened_at: string;
}

interface ReposoViewRow {
  lot_code: string;
  latest_moisture: number | string | null;
  ready: boolean | null;
  reason: string | null;
}

/** Coerce a PostgREST numeric (which may arrive as a string) to number|null. */
const n = (v: number | string | null | undefined): number | null =>
  v == null ? null : Number(v);

/** Rank a row for the board sort: open runs first, then ready, then blocked, then done. */
function rank(row: MillLotRow): number {
  if (row.run?.status === "open") return 0;
  if (row.run == null && row.readiness?.passed && row.reposoReady) return 1;
  if (row.run == null) return 2;
  return 3; // finalized
}

/** The dry-mill chain registry, in physical chain order (id asc). */
export const getMillChain = cache(async (): Promise<MillMachine[]> => {
  const sb = await getSupabase();
  const { data, error } = await sb
    .from("mill_machines")
    .select("id, kind, name, hours_run, calibration_due")
    .order("id");
  if (error) throw new Error(`getMillChain: ${error.message}`);
  return (data as MachineRow[]).map((r) => ({
    id: r.id,
    kind: r.kind,
    name: r.name,
    hoursRun: n(r.hours_run) ?? 0,
    calibrationDue: r.calibration_due,
  }));
});

/**
 * The mill board: every parchment lot in the milling pipeline, joined across the
 * upstream reposo clearance, its latest spec reading, and its run state. The lot
 * universe is the union of (a) lots resting toward the mill (`v_reposo_status`),
 * (b) lots with a recorded readiness, and (c) lots with a run — so a lot shows up the
 * moment it starts resting (ready for the gate) and never drops off once it has a run.
 */
export const getMillBoard = cache(async (): Promise<MillLotRow[]> => {
  const sb = await getSupabase();
  const [readiness, runs, reposo] = await Promise.all([
    sb
      .from("v_mill_readiness")
      .select(
        "parchment_lot_code, moisture_pct, water_activity_aw, reposo_ready, passed, measured_at",
      ),
    sb
      .from("v_milling_runs")
      .select(
        "run_id, parchment_lot_code, parchment_kg_in, green_kg_out, outturn_pct, status, opened_at",
      )
      .order("opened_at", { ascending: false }),
    sb.from("v_reposo_status").select("lot_code, latest_moisture, ready, reason"),
  ]);

  if (readiness.error) throw new Error(`getMillBoard(readiness): ${readiness.error.message}`);
  if (runs.error) throw new Error(`getMillBoard(runs): ${runs.error.message}`);
  if (reposo.error) throw new Error(`getMillBoard(reposo): ${reposo.error.message}`);

  const readinessByLot = new Map<string, MillReadinessSnapshot>();
  for (const r of readiness.data as ReadinessViewRow[]) {
    readinessByLot.set(r.parchment_lot_code, {
      moisturePct: n(r.moisture_pct) ?? 0,
      waterActivityAw: n(r.water_activity_aw) ?? 0,
      reposoReady: r.reposo_ready === true,
      passed: r.passed === true,
      measuredAt: r.measured_at,
    });
  }

  // Latest run per lot (the view is ordered opened_at desc, so the first wins).
  const runByLot = new Map<string, MillRunSnapshot>();
  for (const r of runs.data as RunViewRow[]) {
    if (runByLot.has(r.parchment_lot_code)) continue;
    runByLot.set(r.parchment_lot_code, {
      runId: r.run_id,
      parchmentKgIn: n(r.parchment_kg_in) ?? 0,
      greenKgOut: n(r.green_kg_out),
      outturnPct: n(r.outturn_pct),
      status: r.status,
      openedAt: r.opened_at,
    });
  }

  const reposoByLot = new Map<string, ReposoViewRow>();
  for (const r of reposo.data as ReposoViewRow[]) {
    reposoByLot.set(r.lot_code, r);
  }

  const codes = new Set<string>([
    ...reposoByLot.keys(),
    ...readinessByLot.keys(),
    ...runByLot.keys(),
  ]);

  const rows: MillLotRow[] = [...codes].map((code) => {
    const rep = reposoByLot.get(code);
    return {
      parchmentLotCode: code,
      reposoReady: rep ? rep.ready === true : null,
      reposoReason: rep?.reason ?? null,
      latestMoisture: rep ? n(rep.latest_moisture) : null,
      readiness: readinessByLot.get(code) ?? null,
      run: runByLot.get(code) ?? null,
    };
  });

  rows.sort((a, b) => {
    const dr = rank(a) - rank(b);
    return dr !== 0 ? dr : a.parchmentLotCode.localeCompare(b.parchmentLotCode);
  });
  return rows;
});
