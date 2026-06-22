import { revalidatePath } from "next/cache";

/**
 * Reactive-refresh SSOT — the J1 propagation spine in code (DESIGN facet-01 §2).
 *
 * Every write in the estate goes through ONE SECURITY-DEFINER command RPC and then
 * fans out *inside the database* (security_invoker views re-derive on read; the two
 * earned matviews refresh on the cost write path). The only client-side seam is
 * `revalidatePath()` in the Server Action, which busts the Next.js client router
 * cache so a same-session navigation after a write shows fresh data with no reload.
 *
 * `RIPPLE` is the canonical per-event downstream route map: for each genesis event,
 * the FULL set of `(app)/` routes whose RSC reads a view that write moved — the
 * audit's "Connects to" graph. A Server Action calls `reactiveRefresh(kind)` so it
 * cannot forget a tab (propagation invariant #5: revalidate EVERY affected route,
 * not just the originating one).
 *
 * slice-01 (L0, the walking skeleton) ships the FULL key set with real route arrays
 * — cheap, it is just the contract table — so F-A (L1) collapses to the
 * `ripple-routes-exist` guard test + verification, with no map-fork collision on
 * this file (build-plan §2 decision).
 *
 * $0 / offline-safe: no Realtime, no polling. Cross-tab propagation is the
 * navigation-time RSC re-render under `force-dynamic`; this map is the belt-and-
 * braces freshness guarantee for the post-write navigation.
 */

/** The genesis write events whose ripple this module owns (facet-01 §2). */
export type EventKind =
  | "weigh-in"
  | "cherry-intake"
  | "cost-entry"
  | "spray"
  | "qc-hold"
  | "plot"
  | "disbursement";

/**
 * Per-event downstream consumer routes (the §2 propagation-contract table). Each
 * value lists every `(app)/` route whose Server Component reads a view/getter the
 * event moved. `"/"` is the Dashboard. Keep each set a superset of the actual
 * consumers — an extra revalidate is cheap; a missing one shows stale data.
 */
export const RIPPLE: Record<EventKind, readonly string[]> = {
  // J1 — the genesis weigh-in. Raises the per-picker tally (Weigh), the per-picker
  // harvests row (Harvests), the crew accrual (Crew), and the Dashboard season
  // "today" headline + yield/variety (Dashboard "/"). Mirrors recordWeighInAction.
  "weigh-in": ["/weigh", "/harvests", "/crew", "/"],
  // Cherry intake — same family as weigh minus the per-picker weigh tally; mints a
  // lot + origin harvests row → Dashboard, Harvests, the lot-listing surfaces.
  "cherry-intake": ["/harvests", "/"],
  // Cost entry — the only matview edge; the action also refresh_lot_cost()s. The
  // cost-per-kg-green headline + inventory unit econ.
  "cost-entry": ["/costing", "/inventory"],
  // Spray — PHI clears-on per plot. ONE source (v_plot_phi_status) drives the gate
  // AND every display: Plan gate, Scouting, Map, Satellite, plot listing.
  spray: ["/scouting", "/plan", "/map", "/satellite", "/plots"],
  // QC hold / release — a held lot is un-sellable everywhere it is sellable.
  "qc-hold": ["/qc", "/inventory", "/dispatch"],
  // Plot edit — plot facts feed the Plots tab, the Map, and the plot dossier.
  plot: ["/plots", "/map"],
  // Payroll disbursement — the pay-period accrual + the crew/payroll surfaces.
  disbursement: ["/payroll", "/crew"],
};

/**
 * Bust the Next.js client router cache for every downstream route of `kind`. Call
 * from a Server Action after a successful write, so the next navigation to any
 * affected tab skips the stale cached RSC payload. Idempotent per route.
 */
export function reactiveRefresh(kind: EventKind): void {
  for (const route of RIPPLE[kind]) {
    revalidatePath(route);
  }
}
