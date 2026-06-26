import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/**
 * /mill/[runId] read port (P3-S9 — finalize milling + green grade + COGS flow).
 *
 * Co-located with the route on purpose (the same posture as /pricing/data.ts): it binds
 * DIRECTLY to the authoritative SQL surface the milling migrations shipped —
 *   • v_milling_runs       (P3-S7) — the run header (status / parchment in / outturn);
 *   • mill_run_balance     (P3-S8) — the closed-outturn mass balance + balance_ok;
 *   • v_green_grade        (P3-S9) — the latest SCA grade once a green lot is minted;
 *   • lot_event            (P1)    — the 'mill_run_finalized' event carries the minted
 *                                    green lot code for an already-finalized run.
 * Binding to the frozen view/column names (rather than a sibling @/lib/db port that a
 * parallel fan-out may still be writing) keeps both Vite import-analysis and the test
 * harness from hard-failing on a not-yet-landed module. The Wiring pass can collapse
 * this into a shared @/lib/db/milling port later (one import swap).
 *
 * READ-ONLY. Every write goes through the SECURITY DEFINER RPCs in actions.ts
 * (finalize_milling_run / record_green_grade). Soft reads degrade gracefully: a missing
 * balance / grade leaves its field null and the page still renders the header — it never
 * throws on an absent downstream row (only a genuinely-unknown run id returns null → 404).
 */

export type MillRunStatus = "readiness_pending" | "open" | "finalized";

/** The closed-outturn mass balance (mirrors the mill_run_balance view, P3-S8). */
export interface MillBalance {
  parchmentIn: number;
  sumPassOutput: number;
  sumReject: number;
  sumByproduct: number;
  /** coalesce(green_kg_out, final pass output); null before any pass is recorded. */
  greenOut: number | null;
  accountedMoistureLoss: number;
  unaccountedLoss: number;
  lossCeiling: number;
  /** green_out present AND unaccounted residual within [−1e-9, per-variety ceiling]. */
  balanceOk: boolean;
}

/** The latest SCA green grade once a green lot is minted (mirrors v_green_grade). */
export interface GreenGrade {
  cat1Defects: number;
  cat2Defects: number;
  screenSize: number | null;
  scaPrep: string;
  gradedAt: string;
}

/** Everything the finalize panel needs for one milling run. */
export interface MillRunFinalizeView {
  runId: number;
  parchmentLotCode: string;
  variety: string | null;
  parchmentKgIn: number;
  greenKgOut: number | null;
  outturnPct: number | null;
  status: MillRunStatus;
  openedAt: string;
  balance: MillBalance | null;
  /** Set only once the run is finalized — the green lot the run minted. */
  mintedGreenLotCode: string | null;
  /** The minted lot's latest grade (finalized runs only). */
  grade: GreenGrade | null;
}

interface VMillingRunRow {
  run_id: number | string;
  parchment_lot_code: string;
  parchment_kg_in: number | string;
  green_kg_out: number | string | null;
  outturn_pct: number | string | null;
  status: string;
  opened_at: string;
}

interface MillBalanceRow {
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

interface GreenGradeRow {
  cat1_defects: number | string;
  cat2_defects: number | string;
  screen_size: number | string | null;
  sca_prep: string;
  graded_at: string;
}

/** Coerce a PostgREST numeric (which may arrive as a string) to number|null. */
const n = (v: number | string | null | undefined): number | null =>
  v == null ? null : Number(v);

const STATUSES: readonly MillRunStatus[] = [
  "readiness_pending",
  "open",
  "finalized",
];

function asStatus(raw: string): MillRunStatus {
  return STATUSES.includes(raw as MillRunStatus)
    ? (raw as MillRunStatus)
    : "readiness_pending";
}

function mapBalance(r: MillBalanceRow): MillBalance {
  return {
    parchmentIn: Number(r.parchment_in),
    sumPassOutput: Number(r.sum_pass_output),
    sumReject: Number(r.sum_reject),
    sumByproduct: Number(r.sum_byproduct),
    greenOut: n(r.green_out),
    accountedMoistureLoss: Number(r.accounted_moisture_loss),
    unaccountedLoss: Number(r.unaccounted_loss),
    lossCeiling: Number(r.loss_ceiling),
    balanceOk: Boolean(r.balance_ok),
  };
}

/**
 * One milling run's full finalize payload. Returns null when no run carries `runId`
 * (the page 404s — never a fabricated run). The balance / grade reads are soft: a
 * missing downstream row leaves the field null without throwing.
 */
export const getMillRunFinalize = cache(
  async (runId: number): Promise<MillRunFinalizeView | null> => {
    const sb = await getSupabase();

    const { data: runRow, error: runErr } = await sb
      .from("v_milling_runs")
      .select(
        "run_id, parchment_lot_code, parchment_kg_in, green_kg_out, outturn_pct, status, opened_at",
      )
      .eq("run_id", runId)
      .maybeSingle();
    if (runErr) throw new Error(`getMillRunFinalize: ${runErr.message}`);
    if (!runRow) return null;

    const run = runRow as VMillingRunRow;
    const status = asStatus(run.status);

    const [balRes, lotRes] = await Promise.all([
      sb
        .from("mill_run_balance")
        .select(
          "parchment_in, sum_pass_output, sum_reject, sum_byproduct, green_out, accounted_moisture_loss, unaccounted_loss, loss_ceiling, balance_ok",
        )
        .eq("run_id", runId)
        .maybeSingle(),
      sb
        .from("lots")
        .select("variety")
        .eq("code", run.parchment_lot_code)
        .maybeSingle(),
    ]);

    const balance =
      balRes.error || !balRes.data
        ? null
        : mapBalance(balRes.data as MillBalanceRow);
    const variety =
      (lotRes.data as { variety: string | null } | null)?.variety ?? null;

    let mintedGreenLotCode: string | null = null;
    let grade: GreenGrade | null = null;

    if (status === "finalized") {
      // The 'mill_run_finalized' event (stream = the parchment lot) carries the minted
      // green lot code in its payload. Match on run_id so a parchment lot milled more
      // than once resolves to THIS run's green node.
      const { data: events } = await sb
        .from("lot_event")
        .select("payload, occurred_at")
        .eq("stream_key", run.parchment_lot_code)
        .eq("kind", "mill_run_finalized")
        .order("occurred_at", { ascending: false });

      const match = ((events as { payload: Record<string, unknown> | null }[] | null) ?? [])
        .map((e) => e.payload ?? {})
        .find((p) => String(p.run_id) === String(runId));
      const code = match?.green_lot_code;
      mintedGreenLotCode = typeof code === "string" ? code : null;

      if (mintedGreenLotCode) {
        const { data: gradeRow } = await sb
          .from("v_green_grade")
          .select("cat1_defects, cat2_defects, screen_size, sca_prep, graded_at")
          .eq("green_lot_code", mintedGreenLotCode)
          .maybeSingle();
        if (gradeRow) {
          const g = gradeRow as GreenGradeRow;
          grade = {
            cat1Defects: Number(g.cat1_defects),
            cat2Defects: Number(g.cat2_defects),
            screenSize: n(g.screen_size),
            scaPrep: g.sca_prep,
            gradedAt: g.graded_at,
          };
        }
      }
    }

    return {
      runId: Number(run.run_id),
      parchmentLotCode: run.parchment_lot_code,
      variety,
      parchmentKgIn: Number(run.parchment_kg_in),
      greenKgOut: n(run.green_kg_out),
      outturnPct: n(run.outturn_pct),
      status,
      openedAt: run.opened_at,
      balance,
      mintedGreenLotCode,
      grade,
    };
  },
);
