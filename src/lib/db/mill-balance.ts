import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/* ====================================================================== */
/* P3-S8 — Dry-milling machine-pass chain + byproducts + THE closed mass    */
/* balance READ-port (ADR-003 derived-read). The /mill cockpit reads this:  */
/* the ordered machine-chain rail (`mill_passes`), the sellable byproduct    */
/* nodes (`mill_byproducts`), the Sankey-style mass-balance gauge            */
/* (`mill_run_balance` — parchment_in → green / byproduct / reject /         */
/* moisture-loss, with `balance_ok` flipping forest-green only when the       */
/* unaccounted residual sits under the lot_yield_curve-derived ceiling), and  */
/* the per-variety outturn KPI (`mill_outturn_by_variety`). The ONLY writers  */
/* are the SECURITY DEFINER RPCs in the command ports (`@/lib/db/commands/    */
/* recordMillPass`, `recordMillByproduct`). This port only READS. Mirrors the */
/* pricing.ts / cogs.ts shape: `Row` interface + pure `mapX` mapper +         */
/* `cache()`'d getters; NULLs (an unfinalized green-out, a no-pass outturn)   */
/* are PRESERVED, never fabricated to 0 — the UI shows "—", not a fake number.*/
/* ====================================================================== */

/** The `pass_type` enum (P3-S6) — the dry-mill machine kinds in chain order. */
export type MillPassMachineKind =
  | "huller"
  | "polisher"
  | "screen_grader"
  | "gravity_table"
  | "optical_sorter";

/** The `byproduct_kind` enum (P3-S6) — the sellable byproduct streams. */
export type MillByproductKind = "husk" | "chaff" | "screen_rejects" | "defects";

/** Coerce a nullable numeric (PostgREST may serialize as a string) to a number,
 *  PRESERVING null — an unfinalized green-out / no-pass outturn stays null
 *  (never a fabricated 0). */
function num(v: number | string | null | undefined): number | null {
  return v == null ? null : Number(v);
}

/* ---------------- mill_passes (the machine-chain rail) ---------------- */

/** Shape of a `mill_passes` row as returned by PostgREST (snake_case). */
export interface MillPassRow {
  id: number;
  run_id: number;
  pass_no: number;
  machine_kind: MillPassMachineKind | string;
  input_kg: number | string;
  output_kg: number | string;
  reject_kg: number | string;
  recorded_at: string;
  created_at: string;
}

/** One machine pass in a milling run's ordered chain (huller→polisher→…). */
export interface MillPass {
  id: number;
  runId: number;
  passNo: number;
  machineKind: MillPassMachineKind | string;
  inputKg: number;
  outputKg: number;
  rejectKg: number;
  recordedAt: string;
  createdAt: string;
}

/** Pure row → domain mapper for a machine pass (numeric coercion of the kg legs). */
export function mapMillPass(r: MillPassRow): MillPass {
  return {
    id: Number(r.id),
    runId: Number(r.run_id),
    passNo: Number(r.pass_no),
    machineKind: r.machine_kind,
    inputKg: Number(r.input_kg),
    outputKg: Number(r.output_kg),
    rejectKg: Number(r.reject_kg),
    recordedAt: r.recorded_at,
    createdAt: r.created_at,
  };
}

/* ---------------- mill_byproducts (the sellable nodes) ---------------- */

/** Shape of a `mill_byproducts` row (snake_case). `byproduct_lot_code` is the
 *  minted `lots` node (a real, traceable, sellable lot). */
export interface MillByproductRow {
  id: number;
  run_id: number;
  byproduct_lot_code: string;
  kind: MillByproductKind | string;
  kg: number | string;
  recorded_at: string;
  created_at: string;
}

/** One recorded byproduct stream — its minted lot node, kind and conserved mass. */
export interface MillByproduct {
  id: number;
  runId: number;
  byproductLotCode: string;
  kind: MillByproductKind | string;
  kg: number;
  recordedAt: string;
  createdAt: string;
}

/** Pure row → domain mapper for a byproduct (numeric coercion of kg). */
export function mapMillByproduct(r: MillByproductRow): MillByproduct {
  return {
    id: Number(r.id),
    runId: Number(r.run_id),
    byproductLotCode: r.byproduct_lot_code,
    kind: r.kind,
    kg: Number(r.kg),
    recordedAt: r.recorded_at,
    createdAt: r.created_at,
  };
}

/* ---------------- mill_run_balance (THE closed-outturn gauge) ---------------- */

/** Shape of a `mill_run_balance` row (snake_case). `green_out` is NULL until the
 *  run records a green-out / a final pass (an unfinalized run); the loss legs are
 *  derived (coalesced to 0 in the view). `balance_ok` is a real boolean. */
export interface MillRunBalanceRow {
  run_id: number;
  parchment_lot_code: string;
  parchment_in: number | string;
  sum_pass_output: number | string;
  sum_reject: number | string;
  sum_byproduct: number | string;
  green_out: number | string | null;
  accounted_moisture_loss: number | string;
  unaccounted_loss: number | string;
  loss_ceiling: number | string;
  balance_ok: boolean;
}

/** The closed mass-balance readout for one run: parchment in vs. green / byproduct
 *  / reject / moisture-loss out, the unaccounted residual, and `balanceOk` — TRUE
 *  only when no mass appears and none silently vanishes (the residual sits in
 *  [−1e-9, ceiling]). The "weight-loss mystery" the gauge must kill. */
export interface MillRunBalance {
  runId: number;
  parchmentLotCode: string;
  parchmentIn: number;
  sumPassOutput: number;
  sumReject: number;
  sumByproduct: number;
  /** Recorded green out (or the final pass's output). NULL ⇒ run not finalized yet. */
  greenOut: number | null;
  accountedMoistureLoss: number;
  unaccountedLoss: number;
  lossCeiling: number;
  balanceOk: boolean;
}

/** Pure row → domain mapper for the balance gauge (numeric coercion; NULL green-out
 *  preserved; `balanceOk` passes the boolean through unchanged). */
export function mapMillRunBalance(r: MillRunBalanceRow): MillRunBalance {
  return {
    runId: Number(r.run_id),
    parchmentLotCode: r.parchment_lot_code,
    parchmentIn: Number(r.parchment_in),
    sumPassOutput: Number(r.sum_pass_output),
    sumReject: Number(r.sum_reject),
    sumByproduct: Number(r.sum_byproduct),
    greenOut: num(r.green_out),
    accountedMoistureLoss: Number(r.accounted_moisture_loss),
    unaccountedLoss: Number(r.unaccounted_loss),
    lossCeiling: Number(r.loss_ceiling),
    balanceOk: r.balance_ok,
  };
}

/* ---------------- mill_outturn_by_variety (the /mill KPI) ---------------- */

/** Shape of a `mill_outturn_by_variety` row (snake_case). `green_kg_out` /
 *  `outturn_pct` are NULL when no green out has been recorded for the variety. */
export interface MillOutturnByVarietyRow {
  variety: string;
  parchment_kg_in: number | string;
  green_kg_out: number | string | null;
  outturn_pct: number | string | null;
}

/** Σ outturn rolled up per variety — parchment in, green out, and the outturn
 *  fraction (green / parchment). NULL green/outturn preserved (never 0). */
export interface MillOutturnByVariety {
  variety: string;
  parchmentKgIn: number;
  greenKgOut: number | null;
  /** Green / parchment as a fraction (e.g. 0.82). NULL when no green recorded. */
  outturnPct: number | null;
}

/** Pure row → domain mapper for the outturn rollup (numeric coercion; NULL
 *  green/outturn preserved). */
export function mapMillOutturnByVariety(
  r: MillOutturnByVarietyRow,
): MillOutturnByVariety {
  return {
    variety: r.variety,
    parchmentKgIn: Number(r.parchment_kg_in),
    greenKgOut: num(r.green_kg_out),
    outturnPct: num(r.outturn_pct),
  };
}

/* ---------------- getters (request-scoped cache) ---------------- */

/**
 * One milling run's ordered machine-chain passes (`mill_passes`, pass_no ascending)
 * — the horizontal machine-chain rail. Append-only: corrections are a corrective
 * run, never an edit (the immutability trigger blocks UPDATE/DELETE).
 */
export const getMillPasses = cache(
  async (runId: number): Promise<MillPass[]> => {
    const { data, error } = await (await getSupabase())
      .from("mill_passes")
      .select("*")
      .eq("run_id", runId)
      .order("pass_no");
    if (error) throw new Error(`getMillPasses: ${error.message}`);
    return (data as MillPassRow[]).map(mapMillPass);
  },
);

/**
 * One milling run's recorded byproduct streams (`mill_byproducts`) — each a real,
 * sellable, traceable `lots` node whose mass is conserved by the shipped
 * lot_edges_conserve_mass() trigger (the reused mass guarantee).
 */
export const getMillByproducts = cache(
  async (runId: number): Promise<MillByproduct[]> => {
    const { data, error } = await (await getSupabase())
      .from("mill_byproducts")
      .select("*")
      .eq("run_id", runId)
      .order("id");
    if (error) throw new Error(`getMillByproducts: ${error.message}`);
    return (data as MillByproductRow[]).map(mapMillByproduct);
  },
);

/**
 * One run's closed mass-balance gauge (`mill_run_balance` filtered to the run), or
 * `null` when the run has no balance row yet. `balanceOk` drives the Sankey gauge's
 * forest-green state; `greenOut` is NULL until the run is finalized (P3-S9).
 */
export const getMillRunBalance = cache(
  async (runId: number): Promise<MillRunBalance | null> => {
    const { data, error } = await (await getSupabase())
      .from("mill_run_balance")
      .select("*")
      .eq("run_id", runId);
    if (error) throw new Error(`getMillRunBalance: ${error.message}`);
    const rows = (data as MillRunBalanceRow[] | null) ?? [];
    return rows.length > 0 ? mapMillRunBalance(rows[0]) : null;
  },
);

/**
 * Every milling run's closed mass-balance (`mill_run_balance`, run_id ascending) —
 * the /mill board's balance column (each run's gauge + its balance_ok status).
 */
export const listMillRunBalances = cache(
  async (): Promise<MillRunBalance[]> => {
    const { data, error } = await (await getSupabase())
      .from("mill_run_balance")
      .select("*")
      .order("run_id");
    if (error) throw new Error(`listMillRunBalances: ${error.message}`);
    return (data as MillRunBalanceRow[]).map(mapMillRunBalance);
  },
);

/**
 * Σ outturn rolled up per variety (`mill_outturn_by_variety`, variety ascending) —
 * the /mill KPI strip (washed Geisha ~80–84%, naturals lower). NULL outturn when a
 * variety has parchment in but no green out recorded yet.
 */
export const getOutturnByVariety = cache(
  async (): Promise<MillOutturnByVariety[]> => {
    const { data, error } = await (await getSupabase())
      .from("mill_outturn_by_variety")
      .select("*")
      .order("variety");
    if (error) throw new Error(`getOutturnByVariety: ${error.message}`);
    return (data as MillOutturnByVarietyRow[]).map(mapMillOutturnByVariety);
  },
);
