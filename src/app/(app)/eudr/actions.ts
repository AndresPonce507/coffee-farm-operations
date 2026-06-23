"use server";

import { reactiveRefresh } from "@/lib/revalidate";

import { getSupabase } from "@/lib/supabase/server";

/**
 * S8 — EUDR deforestation-free declaration (the owner's WRITE seam).
 *
 * Server Actions are the driving port (ADR-002 — only ever invoked by an
 * authenticated human in the dossier UI). The single write door is the
 * `eudr_declare_plot` SECURITY DEFINER RPC: it stamps the owner's affirmative
 * claim (or withdraws it). The DB enforces the two compliance invariants — a
 * free claim must carry a basis, and 'established-pre-cutoff' is only valid when
 * the plot was established on/before the 2020-12-31 cutoff — via CHECK
 * constraints. This action maps those raw rejections onto friendly messages (the
 * family never sees a Postgres exception) and, on success, revalidates the lot's
 * dossier + the /eudr overview so the SSOT verdict (eudr_lot_status) re-renders.
 */

/** The documented evidence kinds, mirroring `plots_eudr_basis_chk`. */
export type EudrBasis =
  | "established-pre-cutoff"
  | "satellite-monitoring"
  | "field-survey";

export type DeclareResult = { ok: true } | { ok: false; error: string };

/** Map a raw DB/RPC error to a friendly, SQL-free sentence. */
function friendlyError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("pre_cutoff") || m.includes("pre-cutoff")) {
    return "This plot was established after the 2020 EUDR cutoff, so it can't use the “established before cutoff” basis. Pick satellite monitoring or a field survey instead.";
  }
  if (m.includes("requires a basis") || m.includes("decl_complete")) {
    return "Choose a basis (how the deforestation-free claim is substantiated) before declaring.";
  }
  if (m.includes("unknown plot") || m.includes("foreign_key") || m.includes("not found")) {
    return "That plot no longer exists. Refresh the page and try again.";
  }
  // Fallback: never leak a raw SQL constraint string into the UI.
  return "We couldn't record that declaration. Please try again.";
}

/**
 * Declare (or withdraw) a plot's deforestation-free status.
 *
 * @param plotId  the plot to declare (plots.id).
 * @param free    true = declare deforestation-free; false = withdraw the claim.
 * @param basis   the evidence kind (required when `free`; ignored/cleared when not).
 * @param lotCode optional green-lot code whose dossier page to revalidate; when
 *                omitted the lot route segment is revalidated broadly.
 */
export async function declarePlotDeforestationFree(
  plotId: string,
  free: boolean,
  basis: EudrBasis | string | null,
  lotCode?: string,
): Promise<DeclareResult> {
  // Fail closed BEFORE the round-trip: a free claim must carry a basis. (The DB
  // enforces this too — this just spares a pointless write + gives a clean msg.)
  if (free && !basis) {
    return {
      ok: false,
      error: "Choose a basis (how the deforestation-free claim is substantiated) before declaring.",
    };
  }

  const sb = await getSupabase();
  const { error } = await sb.rpc("eudr_declare_plot", {
    p_plot_id: plotId,
    p_free: free,
    // Withdrawing clears the basis (the RPC nulls it server-side regardless).
    p_basis: free ? (basis as string) : null,
  });

  if (error) return { ok: false, error: friendlyError(error.message) };

  // The verdict engine (eudr_lot_status over lot_origin_plots) is the SSOT —
  // revalidate so the dossier badge + per-plot facts re-fetch the just-made claim.
  reactiveRefresh("eudr-declaration");

  return { ok: true };
}
