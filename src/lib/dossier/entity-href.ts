/**
 * entity-href — THE single source of truth for entity → dossier URLs.
 *
 * Phase 5 ARCHITECTURE §7 C1 (the single most important coherence fix) and build-plan
 * §3 RESOLVED both pin this `lib/` location: a pure, **component-free** map so the
 * three call sites that cannot pull a React component all share one route shape:
 *   1. `<EntityLink>` (NAVIGATE/DRILL) — imports `entityHref`, never redefines it.
 *   2. the Map's imperative MapLibre click → `router.push(entityHref.plot(id))`
 *      (a canvas polygon can't be a JSX `<Link>`).
 *   3. the ⌘K command palette → entity-jump destinations.
 *
 * Because it's the SOLE place a dossier route shape lives, a route rename touches one
 * file (and breaks one unit test). Covers all 7 dossier kinds (facet-02 §3.1).
 *
 * $0 / framework-light: no `next/*` import, no React, pure string math — usable from a
 * Server Component, a client island, the palette, and a db-free unit test alike.
 */

/** The 7 connected entities, each with a full dossier (PRINCIPLE §"Resolved"). */
export type DossierKind =
  | "lot"
  | "plot"
  | "worker"
  | "crew"
  | "batch"
  | "dispatch"
  | "pay-period"
  | "drying-station";

/** Frozen tuple of every kind — the contract surface tests assert exhaustiveness against. */
export const DOSSIER_KINDS = [
  "lot",
  "plot",
  "worker",
  "crew",
  "batch",
  "dispatch",
  "pay-period",
  "drying-station",
] as const satisfies readonly DossierKind[];

/** Optional deep-link target appended as `#anchor` (DRILL to a source section). */
export interface EntityHrefOpts {
  /** A section id on the destination dossier, e.g. `"cost-entries"` / `"satellite"`. */
  anchor?: string;
}

/** Build `/<base>/<encoded-id>[#anchor]`. `id` may arrive as a number (dispatch run). */
function build(
  base: string,
  id: string | number,
  opts?: EntityHrefOpts,
): string {
  const path = `${base}/${encodeURIComponent(String(id))}`;
  return opts?.anchor ? `${path}#${opts.anchor}` : path;
}

/**
 * The SSOT map: `kind → (id, opts?) → path`. Each route mirrors facet-02 §3.1 and the
 * live `(app)/` folders (`/lots/[code]`, `/ferment/[batch]`, plus the 5 new dossiers).
 */
export const entityHref: Record<
  DossierKind,
  (id: string, opts?: EntityHrefOpts) => string
> = {
  lot: (id, opts) => build("/lots", id, opts),
  plot: (id, opts) => build("/plots", id, opts),
  worker: (id, opts) => build("/workers", id, opts),
  crew: (id, opts) => build("/crew", id, opts),
  batch: (id, opts) => build("/ferment", id, opts),
  dispatch: (id, opts) => build("/dispatch", id, opts),
  "pay-period": (id, opts) => build("/pay-period", id, opts),
  "drying-station": (id, opts) => build("/drying-station", id, opts),
};
