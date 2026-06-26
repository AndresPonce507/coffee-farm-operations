import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/* ====================================================================== */
/* P3-S9 — Finalize milling + green grade READ-port (ADR-003 derived-read).  */
/* The SCA Arabica green grade is the SHB/EP-Specialty prep that commands     */
/* Janson's premium and the Best-of-Panama entry right. `sca_prep` is a       */
/* GENERATED column folding the category-1 (primary) + category-2 (secondary) */
/* defect counts into the SCA band — so the grade can NEVER drift from its     */
/* defect counts (the same single-source-of-truth posture as                  */
/* green_lots.sca_grade off cupping score). The `mill_grade` ledger is         */
/* append-only (a re-grade is a NEW row, the latest wins via `v_green_grade`); */
/* the only writers are the SECURITY DEFINER RPCs in the command ports         */
/* (`@/lib/db/commands/recordGreenGrade`, `finalizeMillingRun`). This port     */
/* only READS. Mirrors the pricing.ts / cogs.ts shape: `Row` interface + pure  */
/* `mapX` mapper + `cache()`'d getters; an undeclared screen size is PRESERVED */
/* as null, never fabricated to 0.                                            */
/* ====================================================================== */

/** The SCA prep band, GENERATED from the defect counts (never client-set). */
export type ScaPrep = "EP-Specialty" | "Premium" | "Exchange" | "Below Standard";

/** Coerce a nullable numeric (PostgREST may serialize as a string) to a number,
 *  PRESERVING null — an undeclared screen size stays null (never a fabricated 0). */
function num(v: number | string | null | undefined): number | null {
  return v == null ? null : Number(v);
}

/* ---------------- v_green_grade ---------------- */

/** Shape of a `v_green_grade` row as returned by PostgREST (snake_case) — the
 *  LATEST grade per green lot. `screen_size` may be NULL (not declared at grading).
 *  `sca_prep` is the GENERATED band. */
export interface GreenGradeRow {
  green_lot_code: string;
  cat1_defects: number | string;
  cat2_defects: number | string;
  screen_size: number | string | null;
  sca_prep: ScaPrep | string;
  graded_at: string;
}

/** A green lot's current SCA grade: primary/secondary defect counts, screen size,
 *  the GENERATED prep band, and when it was graded. */
export interface GreenGrade {
  greenLotCode: string;
  /** Category-1 (primary) full-defect-equivalent count. */
  cat1Defects: number;
  /** Category-2 (secondary) full-defect-equivalent count. */
  cat2Defects: number;
  /** Screen size (e.g. 15 / 16 / 18). NULL ⇒ not declared (never a fabricated 0). */
  screenSize: number | null;
  /** The SCA prep band, GENERATED from the defect counts (can't drift). */
  scaPrep: ScaPrep | string;
  gradedAt: string;
}

/** Pure row → domain mapper for a green grade (numeric coercion; NULL screen size
 *  preserved, never fabricated to 0). */
export function mapGreenGrade(r: GreenGradeRow): GreenGrade {
  return {
    greenLotCode: r.green_lot_code,
    cat1Defects: Number(r.cat1_defects),
    cat2Defects: Number(r.cat2_defects),
    screenSize: num(r.screen_size),
    scaPrep: r.sca_prep,
    gradedAt: r.graded_at,
  };
}

/* ---------------- mill_grade (the append-only ledger) ---------------- */

/** Shape of a `mill_grade` ledger row (snake_case) — one recorded grade. Adds the
 *  `id` + `created_at` append provenance on top of the `v_green_grade` projection. */
export interface MillGradeRow extends GreenGradeRow {
  id: number;
  created_at: string;
}

/** One recorded grade in the append-only `mill_grade` ledger (a re-grade is a NEW
 *  row; the latest wins via `v_green_grade`). */
export interface MillGrade extends GreenGrade {
  id: number;
  createdAt: string;
}

/** Pure row → domain mapper for a ledger grade (green-grade fields + id/createdAt). */
export function mapMillGrade(r: MillGradeRow): MillGrade {
  return {
    ...mapGreenGrade(r),
    id: Number(r.id),
    createdAt: r.created_at,
  };
}

/* ---------------- getters (request-scoped cache) ---------------- */

/**
 * One green lot's CURRENT SCA grade (`v_green_grade` filtered to the lot — the view
 * is distinct-on per lot, so at most one row), or `null` when the lot has no grade
 * yet. The /mill finalize panel + the green-lot detail / provenance surfaces read
 * this for the prep band + defect counts.
 */
export const getGreenGrade = cache(
  async (lot: string): Promise<GreenGrade | null> => {
    const { data, error } = await (await getSupabase())
      .from("v_green_grade")
      .select("*")
      .eq("green_lot_code", lot);
    if (error) throw new Error(`getGreenGrade: ${error.message}`);
    const rows = (data as GreenGradeRow[] | null) ?? [];
    return rows.length > 0 ? mapGreenGrade(rows[0]) : null;
  },
);

/**
 * Every green lot's current SCA grade (`v_green_grade`) — the /mill finalize board's
 * grade-histogram + the green-inventory grade column source. Ordered by lot code.
 */
export const listGreenGrades = cache(async (): Promise<GreenGrade[]> => {
  const { data, error } = await (await getSupabase())
    .from("v_green_grade")
    .select("*")
    .order("green_lot_code");
  if (error) throw new Error(`listGreenGrades: ${error.message}`);
  return (data as GreenGradeRow[]).map(mapGreenGrade);
});

/**
 * The append-only `mill_grade` ledger for one green lot, newest grade first — the
 * full re-grade history / provenance behind the current grade. Immutable: a
 * correction is a new grade row, never an edit (the append-only trigger blocks
 * UPDATE/DELETE).
 */
export const listMillGrades = cache(
  async (lot: string): Promise<MillGrade[]> => {
    const { data, error } = await (await getSupabase())
      .from("mill_grade")
      .select("*")
      .eq("green_lot_code", lot)
      .order("graded_at", { ascending: false });
    if (error) throw new Error(`listMillGrades: ${error.message}`);
    return (data as MillGradeRow[]).map(mapMillGrade);
  },
);
