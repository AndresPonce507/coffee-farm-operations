import Link from "next/link";
import { type ReactNode } from "react";

import { entityHref, type DossierKind } from "@/lib/dossier/entity-href";

/**
 * EntityLink — the NAVIGATE / DRILL smart-bar primitive (facet-03 §1.3).
 *
 * Wraps any entity-naming or computed markup in a real `<a href>` resolved through the
 * `entityHref` SSOT (which it IMPORTS — it never redefines the route map; ARCHITECTURE
 * §7 C1). Turning a formerly-COSMETIC row into a dossier link is a one-line wrap across
 * the audit's ~88 cosmetic rows. Inherits keyboard + screen-reader reachability for
 * free; carries an es-PA `aria-label` naming the entity.
 *
 * - NAVIGATE: `<EntityLink kind="plot" id={plot.id}>…card…</EntityLink>`.
 * - DRILL:    `<EntityLink kind="lot" id={code} anchor="cost-entries">…kpi…</EntityLink>`
 *   deep-links to the editable source records that produce a computed value.
 */
export function EntityLink({
  kind,
  id,
  children,
  className,
  anchor,
}: {
  kind: DossierKind;
  /** Accepts a number (e.g. a numeric dispatch-run id) — `entityHref` coerces it. */
  id: string | number;
  children: ReactNode;
  className?: string;
  /** DRILL: deep-link to a source section on the destination dossier. */
  anchor?: string;
}) {
  const href = entityHref[kind](String(id), anchor ? { anchor } : undefined);
  return (
    <Link
      href={href}
      className={className}
      aria-label={`Abrir ${kind} ${id}`}
      prefetch={false}
    >
      {children}
    </Link>
  );
}
