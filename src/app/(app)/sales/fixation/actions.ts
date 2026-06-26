"use server";

import { getTranslations } from "next-intl/server";

import { getSupabase } from "@/lib/supabase/server";

/**
 * /sales/fixation WRITE port — the fix-line Server Action (P3-S1).
 *
 * One driving port (ADR-002: only ever an authenticated human submitting a form — the
 * injection invariant, rail §7). It validates BEFORE the network hop, then appends
 * through the single SECURITY DEFINER RPC `fix_contract_price`, which reads the live
 * "C" (P3-S0 v_ice_c_latest), refuses a line whose reservation was cancelled (no
 * phantom kg), computes the fixed $/kg via convert_qty, flips the contract to 'fixed',
 * and appends a 'price_fixed' lot_event.
 *
 * Money-shaped + irreversible: human-confirmed in the UI, online-first (rail §7/§9).
 * It moves no green inventory (the reservation already exists), so no ATP ripple fires;
 * the cockpit re-reads on the next navigation (the (app) is force-dynamic) and the
 * client island router.refresh()es in place.
 */

export interface FixLineInput {
  contractLineId: number;
  idempotencyKey: string;
}

export type FixLineResult =
  | { ok: true; lineId: number }
  | { ok: false; error: string };

interface PgError {
  message: string;
  code?: string;
}

function friendlyError(error: PgError, generic: string): string {
  switch (error.code) {
    case "23514": // check_violation — phantom-kg / non-differential guards
    case "P0001": // raise_exception
    case "P0002": // no_data_found — "no ICE C mark to fix for month …"
    case "23503": // foreign_key_violation — unknown line
      return error.message;
    case "42501": // insufficient_privilege
      return "You don't have access to fix this line.";
    default:
      return generic;
  }
}

export async function fixLineAction(input: FixLineInput): Promise<FixLineResult> {
  const t = await getTranslations("sales");
  if (!Number.isInteger(input.contractLineId) || input.contractLineId <= 0) {
    return { ok: false, error: t("fixation.errors.lineRequired") };
  }

  const sb = await getSupabase();
  const { data, error } = await sb.rpc("fix_contract_price", {
    p_contract_line_id: input.contractLineId,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return {
      ok: false,
      error: friendlyError(error as PgError, t("fixation.errors.generic")),
    };
  }
  return { ok: true, lineId: Number(data) };
}
