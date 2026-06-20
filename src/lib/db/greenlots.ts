import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";
import type { GreenLot, GreenLotAtp, ScaGrade } from "@/lib/types";

/* ====================================================================== */
/* S5 — GreenLot inventory + ATP read-port (ADR-003 derived-read).        */
/* The first money-shaped slice: a GreenLot is the same `lots` node at     */
/* stage='green' plus a `green_lots` detail row, and available-to-promise  */
/* is the DERIVED `green_lots_atp` view (atp = current_kg − Σreserved −    */
/* Σshipped). This port only READS; the sole writer is the                 */
/* materialize_green_lot() RPC and the append-only reservation Server      */
/* Action (owned elsewhere this slice). Mirrors the lots.ts shape.         */
/* ====================================================================== */

/* ---------------- green_lots detail row ---------------- */

/** Shape of a `green_lots` row as returned by PostgREST (snake_case).
 *  `cupping_score` is a numeric PostgREST may serialize as a string. */
export interface GreenLotRow {
  lot_code: string;
  cupping_score: number | string;
  sca_grade: ScaGrade | string; // GENERATED band (D-INV-3) — derived from the score
  location: string;
  graded_at: string;
}

/** Pure row → domain mapper for a green-lot detail row (numeric coercion of the
 *  cupping score; the generated SCA band passes through unchanged). */
export function mapGreenLot(r: GreenLotRow): GreenLot {
  return {
    lotCode: r.lot_code,
    cuppingScore: Number(r.cupping_score),
    scaGrade: r.sca_grade,
    location: r.location,
    gradedAt: r.graded_at,
  };
}

/* ---------------- green_lots_atp derived view row ---------------- */

/** Shape of a `green_lots_atp` view row as returned by PostgREST (snake_case).
 *  The mass / atp columns are numerics that may arrive as strings; the reserved /
 *  shipped sums can be null when a lot has no commitments yet. */
export interface GreenLotAtpRow {
  green_lot_code: string;
  sca_grade: ScaGrade | string;
  location: string;
  current_kg: number | string | null;
  reserved_kg: number | string | null;
  shipped_kg: number | string | null;
  atp: number | string | null;
}

/** Pure row → domain mapper for an available-to-promise row (numeric coercion;
 *  null reserved/shipped sums → 0 for a freshly materialized, uncommitted lot). */
export function mapGreenLotAtp(r: GreenLotAtpRow): GreenLotAtp {
  return {
    greenLotCode: r.green_lot_code,
    scaGrade: r.sca_grade,
    location: r.location,
    currentKg: Number(r.current_kg ?? 0),
    reservedKg: Number(r.reserved_kg ?? 0),
    shippedKg: Number(r.shipped_kg ?? 0),
    atp: Number(r.atp ?? 0),
  };
}

/* ---------------- getters (request-scoped cache) ---------------- */

/** Every graded green lot's detail row (grade input + location + SCA band). */
export const getGreenLots = cache(async (): Promise<GreenLot[]> => {
  const { data, error } = await (await getSupabase())
    .from("green_lots")
    .select("*")
    .order("lot_code");
  if (error) throw new Error(`getGreenLots: ${error.message}`);
  return (data as GreenLotRow[]).map(mapGreenLot);
});

/**
 * Available-to-promise per green lot from the DERIVED `green_lots_atp` view —
 * `atp = current_kg − Σreserved − Σshipped`, computed by the view (never a stored
 * counter) so it can never disagree with the claim rows it sums.
 */
export const getGreenLotAtp = cache(async (): Promise<GreenLotAtp[]> => {
  const { data, error } = await (await getSupabase())
    .from("green_lots_atp")
    .select("*")
    .order("green_lot_code");
  if (error) throw new Error(`getGreenLotAtp: ${error.message}`);
  return (data as GreenLotAtpRow[]).map(mapGreenLotAtp);
});
