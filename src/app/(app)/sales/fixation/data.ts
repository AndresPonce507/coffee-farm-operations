import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/**
 * /sales/fixation read port (P3-S1 trade trunk).
 *
 * Binds directly to `v_fixation_cockpit` — the authoritative P3-S1 view of un-fixed
 * DIFFERENTIAL contract lines × the current ICE "C" mark (from the P3-S0
 * v_ice_c_latest) × the implied $/kg (computed in SQL via convert_qty — never a JS
 * 2.2046). The view EXCLUDES reserve lots by construction (they are off the "C" and
 * carry no differential leg), so a Reserve Geisha can never appear in this cockpit.
 * READ-ONLY: the fix write goes through fix_contract_price in actions.ts.
 */

/** One un-fixed differential line awaiting a "C" lock (mirrors `v_fixation_cockpit`). */
export interface FixationLine {
  contractLineId: number;
  contractId: number;
  contractNo: string;
  greenLotCode: string;
  kg: number;
  differentialCents: number | null;
  iceCMonth: string | null;
  /** Live "C" $/lb for the line's month; NULL ⇒ no mark entered yet. */
  currentCPrice: number | null;
  /** Implied $/kg = ("C" + diff/100) × convert_qty(1,'kg','[lb]'); NULL when no mark. */
  impliedUnitPrice: number | null;
}

interface FixationViewRow {
  contract_line_id: number;
  contract_id: number;
  contract_no: string;
  green_lot_code: string;
  kg: number | string;
  differential_cents: number | string | null;
  ice_c_contract_month: string | null;
  current_c_price: number | string | null;
  implied_unit_price: number | string | null;
}

const n = (v: number | string | null | undefined): number | null =>
  v == null ? null : Number(v);

/** Every open differential line awaiting a fix — the cockpit's source of truth. */
export const getFixationCockpit = cache(async (): Promise<FixationLine[]> => {
  const sb = await getSupabase();
  const { data, error } = await sb
    .from("v_fixation_cockpit")
    .select("*")
    .order("contract_no");
  if (error) throw new Error(`getFixationCockpit: ${error.message}`);

  return (data as FixationViewRow[]).map((r) => ({
    contractLineId: r.contract_line_id,
    contractId: r.contract_id,
    contractNo: r.contract_no,
    greenLotCode: r.green_lot_code,
    kg: Number(r.kg),
    differentialCents: n(r.differential_cents),
    iceCMonth: r.ice_c_contract_month,
    currentCPrice: n(r.current_c_price),
    impliedUnitPrice: n(r.implied_unit_price),
  }));
});
