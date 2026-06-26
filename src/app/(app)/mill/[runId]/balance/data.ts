import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/**
 * /mill/[runId]/balance read port (P3-S8 — machine-pass chain + byproducts + the
 * closed mass balance).
 *
 * Co-located with the route on purpose: it binds DIRECTLY to the authoritative SQL
 * surface the P3-S8 migration shipped — `v_milling_runs` (the run header, S7),
 * `mill_run_balance` (the closed-outturn readout), `mill_passes` (the ordered
 * machine chain) and `mill_byproducts` (each its own sellable, traceable lots node)
 * — rather than to a not-yet-landed shared `@/lib/db/milling` port. Importing a
 * sibling module a parallel fan-out is still authoring would hard-fail Vite's
 * import-analysis at BOTH test and build time; the only load-bearing contract here
 * is the view/column names, which are frozen. The Wiring pass can collapse this into
 * the shared port (one import swap) once it lands.
 *
 * READ-ONLY. Every write goes through the SECURITY DEFINER RPCs in `actions.ts`
 * (`record_mill_pass` / `record_mill_byproduct`). All quantities are kg — no
 * cross-unit math, so no `convert_qty` hop here. NULLs (a green-out not yet
 * recorded) are preserved, never fabricated to 0 (the "margin unknown" posture).
 */

export type MillRunStatus = "readiness_pending" | "open" | "finalized";

/** The five-stage dry-mill chain (the `pass_type` enum, S6). */
export type MachineKind =
  | "huller"
  | "polisher"
  | "screen_grader"
  | "gravity_table"
  | "optical_sorter";

/** The byproduct streams (the `byproduct_kind` enum, S6). */
export type ByproductKind = "husk" | "chaff" | "screen_rejects" | "defects";

export interface MillRunHeader {
  runId: number;
  parchmentLotCode: string;
  variety: string | null;
  parchmentKgIn: number;
  /** clean green recovered; NULL until the run is finalized (P3-S9). */
  greenKgOut: number | null;
  /** green ÷ parchment, a fraction in [0,1]; NULL until finalized. */
  outturnPct: number | null;
  status: MillRunStatus;
  openedAt: string;
}

/** The closed-outturn readout (mirrors `mill_run_balance`). */
export interface MillRunBalance {
  parchmentIn: number;
  sumPassOutput: number;
  sumReject: number;
  sumByproduct: number;
  greenOut: number | null;
  accountedMoistureLoss: number;
  unaccountedLoss: number;
  lossCeiling: number;
  /** TRUE only when the unaccounted residual sits in [-1e-9, lossCeiling]. */
  balanceOk: boolean;
}

export interface MillPass {
  passNo: number;
  machineKind: MachineKind;
  inputKg: number;
  outputKg: number;
  rejectKg: number;
  recordedAt: string;
}

export interface MillByproduct {
  byproductLotCode: string;
  kind: ByproductKind;
  kg: number;
  recordedAt: string;
}

/** Everything the mass-balance workspace needs for one milling run. */
export interface MillRunWorkspace {
  run: MillRunHeader;
  /** the closed-outturn readout; NULL only if the balance view returns no row. */
  balance: MillRunBalance | null;
  passes: MillPass[];
  byproducts: MillByproduct[];
}

interface RunViewRow {
  run_id: number | string;
  parchment_lot_code: string;
  parchment_kg_in: number | string;
  green_kg_out: number | string | null;
  outturn_pct: number | string | null;
  status: string;
  opened_at: string;
}

interface BalanceViewRow {
  parchment_in: number | string | null;
  sum_pass_output: number | string | null;
  sum_reject: number | string | null;
  sum_byproduct: number | string | null;
  green_out: number | string | null;
  accounted_moisture_loss: number | string | null;
  unaccounted_loss: number | string | null;
  loss_ceiling: number | string | null;
  balance_ok: boolean | null;
}

interface PassRow {
  pass_no: number | string;
  machine_kind: string;
  input_kg: number | string;
  output_kg: number | string;
  reject_kg: number | string;
  recorded_at: string;
}

interface ByproductRow {
  byproduct_lot_code: string;
  kind: string;
  kg: number | string;
  recorded_at: string;
}

/** Coerce a PostgREST numeric (which may arrive as a string) to number. */
const n = (v: number | string | null | undefined): number =>
  v == null ? 0 : Number(v);
/** Same, but preserve NULL (never fabricate a 0). */
const nOrNull = (v: number | string | null | undefined): number | null =>
  v == null ? null : Number(v);

function asStatus(v: string): MillRunStatus {
  return v === "open" || v === "finalized" ? v : "readiness_pending";
}

/**
 * The full workspace for one milling run. Returns null when no run header exists
 * for the id (the page 404s — never a fabricated run). A NaN id short-circuits to
 * null without a round-trip. The balance / passes / byproducts reads degrade
 * gracefully: a missing balance row leaves `balance` null, the gauge then reads
 * "pending" rather than throwing.
 */
export const getMillRunWorkspace = cache(
  async (runId: number): Promise<MillRunWorkspace | null> => {
    if (!Number.isInteger(runId) || runId <= 0) return null;

    const sb = await getSupabase();

    const { data: runRow, error: runErr } = await sb
      .from("v_milling_runs")
      .select(
        "run_id, parchment_lot_code, parchment_kg_in, green_kg_out, outturn_pct, status, opened_at",
      )
      .eq("run_id", runId)
      .maybeSingle();
    if (runErr) throw new Error(`getMillRunWorkspace: ${runErr.message}`);
    if (!runRow) return null;

    const view = runRow as RunViewRow;

    const [varietyRes, balRes, passRes, bypRes] = await Promise.all([
      sb
        .from("lots")
        .select("variety")
        .eq("code", view.parchment_lot_code)
        .maybeSingle(),
      sb
        .from("mill_run_balance")
        .select(
          "parchment_in, sum_pass_output, sum_reject, sum_byproduct, green_out, accounted_moisture_loss, unaccounted_loss, loss_ceiling, balance_ok",
        )
        .eq("run_id", runId)
        .maybeSingle(),
      sb
        .from("mill_passes")
        .select("pass_no, machine_kind, input_kg, output_kg, reject_kg, recorded_at")
        .eq("run_id", runId)
        .order("pass_no", { ascending: true }),
      sb
        .from("mill_byproducts")
        .select("byproduct_lot_code, kind, kg, recorded_at")
        .eq("run_id", runId)
        .order("id", { ascending: true }),
    ]);

    if (balRes.error) throw new Error(`getMillRunWorkspace(balance): ${balRes.error.message}`);
    if (passRes.error) throw new Error(`getMillRunWorkspace(passes): ${passRes.error.message}`);
    if (bypRes.error) throw new Error(`getMillRunWorkspace(byproducts): ${bypRes.error.message}`);

    const variety =
      (varietyRes.data as { variety: string | null } | null)?.variety ?? null;

    const bal = balRes.data as BalanceViewRow | null;
    const balance: MillRunBalance | null = bal
      ? {
          parchmentIn: n(bal.parchment_in),
          sumPassOutput: n(bal.sum_pass_output),
          sumReject: n(bal.sum_reject),
          sumByproduct: n(bal.sum_byproduct),
          greenOut: nOrNull(bal.green_out),
          accountedMoistureLoss: n(bal.accounted_moisture_loss),
          unaccountedLoss: n(bal.unaccounted_loss),
          lossCeiling: n(bal.loss_ceiling),
          balanceOk: bal.balance_ok === true,
        }
      : null;

    const passes: MillPass[] = ((passRes.data as PassRow[] | null) ?? []).map((p) => ({
      passNo: Number(p.pass_no),
      machineKind: p.machine_kind as MachineKind,
      inputKg: n(p.input_kg),
      outputKg: n(p.output_kg),
      rejectKg: n(p.reject_kg),
      recordedAt: p.recorded_at,
    }));

    const byproducts: MillByproduct[] = (
      (bypRes.data as ByproductRow[] | null) ?? []
    ).map((b) => ({
      byproductLotCode: b.byproduct_lot_code,
      kind: b.kind as ByproductKind,
      kg: n(b.kg),
      recordedAt: b.recorded_at,
    }));

    return {
      run: {
        runId: Number(view.run_id),
        parchmentLotCode: view.parchment_lot_code,
        variety,
        parchmentKgIn: n(view.parchment_kg_in),
        greenKgOut: nOrNull(view.green_kg_out),
        outturnPct: nOrNull(view.outturn_pct),
        status: asStatus(view.status),
        openedAt: view.opened_at,
      },
      balance,
      passes,
      byproducts,
    };
  },
);
