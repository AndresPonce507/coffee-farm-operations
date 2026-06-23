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
  | "disbursement"
  | "worker"
  | "task"
  | "processing-batch"
  // App-route action EventKinds (P5 -- "Connected Estate" write paths)
  | "ferment"
  | "drying"
  | "dispatch"
  | "inventory-update"
  | "crew-event"
  | "plan-event"
  | "eudr-declaration";

/**
 * Per-event downstream consumer routes (the §2 propagation-contract table). Each
 * value lists every `(app)/` route whose Server Component reads a view/getter the
 * event moved. `"/"` is the Dashboard. Keep each set a superset of the actual
 * consumers — an extra revalidate is cheap; a missing one shows stale data.
 */
export const RIPPLE: Record<EventKind, readonly string[]> = {
  // J1 — the genesis weigh-in. Raises the per-picker tally (Weigh), the per-picker
  // harvests row (Harvests), the crew accrual (Crew), the worker dossier "kg today"
  // (Workers — getWorkerWeighSummary reads v_weigh_today_by_picker), and the Dashboard
  // season "today" headline + yield/variety (Dashboard "/"). Mirrors recordWeighInAction.
  "weigh-in": ["/weigh", "/harvests", "/crew", "/workers", "/"],
  // Cherry intake — same family as weigh minus the per-picker weigh tally; mints a
  // lot + origin harvests row → Dashboard, Harvests, the lot-listing surfaces, AND the
  // origin plot dossier (/plots/[id] harvests section reads harvests by plot).
  "cherry-intake": ["/harvests", "/", "/plots/[id]"],
  // Cost entry — the only matview edge; the action also refresh_lot_cost()s. The
  // cost-per-kg-green headline + inventory unit econ + the lot dossier cost-entries
  // provenance (/lots/[code] reads the same allocated cost).
  "cost-entry": ["/costing", "/inventory", "/lots/[code]"],
  // Spray — PHI clears-on per plot. ONE source (v_plot_phi_status) drives the gate
  // AND every display: Plan gate, Scouting, Map, Satellite, plot listing, and the
  // plot dossier's spray/PHI sections (/plots/[id]).
  spray: ["/scouting", "/plan", "/map", "/satellite", "/plots", "/plots/[id]"],
  // QC hold / release — a held lot is un-sellable everywhere it is sellable.
  "qc-hold": ["/qc", "/inventory", "/dispatch"],
  // Plot edit — plot facts feed the Plots tab, the Map, the Satellite board, and the
  // plot dossier (/plots/[id]).
  plot: ["/plots", "/map", "/satellite", "/plots/[id]"],
  // Payroll disbursement -- record_disbursement books a farm-level direct-labor
  // cost_entry (the matview input the action refresh_lot_cost()s), so the disbursement
  // moves cost-per-kg-green everywhere a cost-entry does (/costing, /inventory unit econ,
  // and the /lots/[code] cost provenance), on top of the pay-period accrual surfaces.
  disbursement: ["/payroll", "/crew", "/costing", "/inventory", "/lots/[code]"],
  // Worker create/update/delete — worker roster feeds Workers tab, the Crew tab
  // (crew rosters read worker rows), and the Dashboard.
  worker: ["/workers", "/crew", "/"],
  // Task create/update/delete/status-change — Tasks tab + Dashboard.
  task: ["/tasks", "/"],
  // Processing batch create/update/delete/advance — Processing tab, the Drying board
  // (shares lots.current_kg / lots.stage which an advance moves), and the Dashboard.
  "processing-batch": ["/processing", "/drying", "/"],
  // Ferment batch start / reading / mill-water log -- Ferment tab + Dashboard.
  ferment: ["/ferment", "/"],
  // Drying -- moisture reading + station assignment. Feeds Drying tab, Processing
  // (shared lot-state), and Dashboard.
  drying: ["/drying", "/processing", "/"],
  // Dispatch -- generate / send / ack.
  dispatch: ["/dispatch"],
  // Inventory update -- grade green lot / reserve green lot.
  "inventory-update": ["/inventory", "/"],
  // Crew event -- attendance, enrol, por-obra signing, certification, rehire.
  "crew-event": ["/crew", "/workers", "/"],
  // Plan event -- schedule/re-plan pasada, maturation signal.
  "plan-event": ["/plan", "/tasks", "/"],
  // EUDR declaration -- deforestation-free assertion on a lot.
  "eudr-declaration": ["/eudr", "/lots/[code]"],
};

/**
 * Bust the Next.js client router cache for every downstream route of `kind`. Call
 * from a Server Action after a successful write, so the next navigation to any
 * affected tab skips the stale cached RSC payload. Idempotent per route.
 *
 * Dynamic-route patterns (those carrying a `[segment]`, e.g. `/lots/[code]` or
 * `/plots/[id]`) MUST be revalidated with the `"page"` type so Next busts every
 * concrete page under the pattern (Next 15 semantics). A single-arg call would treat
 * `"/lots/[code]"` as a literal pathname that no URL matches and silently no-op —
 * the exact trap that left the dossier dossiers stale after a write.
 */
export function reactiveRefresh(kind: EventKind): void {
  for (const route of RIPPLE[kind]) {
    if (route.includes("[")) revalidatePath(route, "page");
    else revalidatePath(route);
  }
}
