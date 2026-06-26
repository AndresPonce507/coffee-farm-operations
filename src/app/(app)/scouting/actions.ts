"use server";

import { reactiveRefresh } from "@/lib/revalidate";

/**
 * Best-effort cross-tab cache-bust after a spray is logged.
 *
 * The spray write itself runs client-side in `SprayLogForm` — the field-capture form
 * drives the `log_spray` SECURITY DEFINER RPC directly, so it stays offline-friendly
 * like the weigh-in capture (one write door, the RPC, callable from client or server).
 * The only server seam is this revalidation: it busts the Next RSC router caches for
 * every surface a spray moves — the PHI gate on Plan, plus Scouting, Map, Satellite,
 * the plot listing, and the plot dossier (`RIPPLE["spray"]`) — so a same-session
 * navigation shows the fresh PHI/REI window with no reload.
 *
 * The form calls it as a fire-and-forget effect on a successful log. Best-effort by
 * design: a failure (e.g. offline, or no request scope) must NEVER fail the write —
 * the next navigation under `force-dynamic` re-reads `v_plot_phi_status` anyway; this
 * is the belt-and-braces freshness guarantee.
 */
export async function refreshAfterSpray(): Promise<void> {
  reactiveRefresh("spray");
}
