import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";
import type {
  CupFinalScore,
  CupperDrift,
  CuppingSession,
  GreenDefect,
  QcStatus,
} from "@/lib/types";

/* ====================================================================== */
/* P2-S6 — QC & cupping read-port (ADR-003 derived-read). This port only    */
/* READS; the sole writers are the SECURITY DEFINER command RPCs            */
/* (record_cupping_session / record_cup_score / record_defect /            */
/* place_qc_hold / release_qc_hold) driven by Server Actions. Mirrors the    */
/* greenlots.ts shape: a pure row→domain mapper + a request-scoped getter.   */
/* ====================================================================== */

/* ---------------- v_qc_status — the per-lot QC roll-up ---------------- */

/** Shape of a `v_qc_status` row as PostgREST returns it (snake_case; numerics may
 *  arrive as strings; latest score / reason are nullable). */
export interface QcStatusRow {
  green_lot_code: string;
  held: boolean;
  hold_reason: string | null;
  latest_cup_score: number | string | null;
  primary_defects: number | string | null;
  secondary_defects: number | string | null;
}

/** Pure row→domain mapper — the latest score stays NULL (never fabricated 0). */
export function mapQcStatus(r: QcStatusRow): QcStatus {
  return {
    greenLotCode: r.green_lot_code,
    held: r.held,
    holdReason: r.hold_reason,
    latestCupScore: r.latest_cup_score == null ? null : Number(r.latest_cup_score),
    primaryDefects: Number(r.primary_defects ?? 0),
    secondaryDefects: Number(r.secondary_defects ?? 0),
  };
}

/* ---------------- v_cup_final_score — derived session total ---------------- */

export interface CupFinalScoreRow {
  session_id: number;
  green_lot_code: string;
  cupper_id: string;
  protocol: string;
  is_calibration: boolean;
  final_score: number | string;
  attribute_count: number | string;
}

export function mapCupFinalScore(r: CupFinalScoreRow): CupFinalScore {
  return {
    sessionId: Number(r.session_id),
    greenLotCode: r.green_lot_code,
    cupperId: r.cupper_id,
    protocol: r.protocol,
    isCalibration: r.is_calibration,
    finalScore: Number(r.final_score),
    attributeCount: Number(r.attribute_count),
  };
}

/* ---------------- v_cupper_drift — calibration bias evidence ---------------- */

export interface CupperDriftRow {
  cupper_id: string;
  attribute: string;
  cupper_mean: number | string;
  panel_mean: number | string;
  drift: number | string;
  sample_n: number | string;
}

export function mapCupperDrift(r: CupperDriftRow): CupperDrift {
  return {
    cupperId: r.cupper_id,
    attribute: r.attribute,
    cupperMean: Number(r.cupper_mean),
    panelMean: Number(r.panel_mean),
    drift: Number(r.drift),
    sampleN: Number(r.sample_n),
  };
}

/* ---------------- cupping_sessions + green_defects ---------------- */

export interface CuppingSessionRow {
  id: number;
  green_lot_code: string;
  cupper_id: string;
  protocol: string;
  is_calibration: boolean;
  occurred_at: string;
}

export function mapCuppingSession(r: CuppingSessionRow): CuppingSession {
  return {
    id: Number(r.id),
    greenLotCode: r.green_lot_code,
    cupperId: r.cupper_id,
    protocol: r.protocol,
    isCalibration: r.is_calibration,
    occurredAt: r.occurred_at,
  };
}

export interface GreenDefectRow {
  id: number;
  green_lot_code: string;
  defect_kind: string;
  count: number | string;
  category: string;
}

export function mapGreenDefect(r: GreenDefectRow): GreenDefect {
  return {
    id: Number(r.id),
    greenLotCode: r.green_lot_code,
    defectKind: r.defect_kind,
    count: Number(r.count),
    category: r.category,
  };
}

/* ---------------- getters (request-scoped cache) ---------------- */

/** Per-lot QC status (held / latest score / defect tallies) for every green lot. */
export const getQcStatus = cache(async (): Promise<QcStatus[]> => {
  const { data, error } = await (await getSupabase())
    .from("v_qc_status")
    .select("*")
    .order("green_lot_code");
  if (error) throw new Error(`getQcStatus: ${error.message}`);
  return (data as QcStatusRow[]).map(mapQcStatus);
});

/** Every cupping session's derived final score (the score-history feed). */
export const getCupFinalScores = cache(async (): Promise<CupFinalScore[]> => {
  const { data, error } = await (await getSupabase())
    .from("v_cup_final_score")
    .select("*")
    .order("session_id", { ascending: false });
  if (error) throw new Error(`getCupFinalScores: ${error.message}`);
  return (data as CupFinalScoreRow[]).map(mapCupFinalScore);
});

/** Cupper-drift calibration evidence — each cupper's bias per calibration attribute. */
export const getCupperDrift = cache(async (): Promise<CupperDrift[]> => {
  const { data, error } = await (await getSupabase())
    .from("v_cupper_drift")
    .select("*")
    .order("cupper_id");
  if (error) throw new Error(`getCupperDrift: ${error.message}`);
  return (data as CupperDriftRow[]).map(mapCupperDrift);
});

/** The defect ledger for a green lot (append-only grid). */
export const getGreenDefects = cache(async (lotCode: string): Promise<GreenDefect[]> => {
  const { data, error } = await (await getSupabase())
    .from("green_defects")
    .select("*")
    .eq("green_lot_code", lotCode)
    .order("id");
  if (error) throw new Error(`getGreenDefects: ${error.message}`);
  return (data as GreenDefectRow[]).map(mapGreenDefect);
});
