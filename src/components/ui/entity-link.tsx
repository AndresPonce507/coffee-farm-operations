import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode } from "react";

import { entityHref, type DossierKind } from "@/lib/dossier/entity-href";
import { cn } from "@/lib/utils";

/**
 * Default focus-visible ring applied to every EntityLink so every call site satisfies
 * WCAG 2.4.7 / 2.4.11 without per-call edits. Caller className is merged on top via cn()
 * so sites that already declare their own focus-visible:ring work without duplication.
 */
const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-forest/40 focus-visible:ring-offset-2 focus-visible:ring-offset-paper rounded-xl";

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
 * - Pass `name` (the human-readable entity name, e.g. "Lupita González") for a far
 *   richer screen-reader announcement: "Abrir trabajador Lupita González" instead of the
 *   raw slug "Abrir trabajador w-03".
 */
export function EntityLink({
  kind,
  id,
  children,
  className,
  anchor,
  name,
}: {
  kind: DossierKind;
  /** Accepts a number (e.g. a numeric dispatch-run id) — `entityHref` coerces it. */
  id: string | number;
  children: ReactNode;
  className?: string;
  /** DRILL: deep-link to a source section on the destination dossier. */
  anchor?: string;
  /**
   * Optional human-readable name (e.g. worker's full name, lot code label).
   * When provided the aria-label becomes "Abrir trabajador Lupita González" instead of
   * the raw slug "Abrir trabajador w-03", greatly improving es-PA screen-reader UX.
   */
  name?: string;
}) {
  const t = useTranslations("dossier");
  const href = entityHref[kind](String(id), anchor ? { anchor } : undefined);
  // Only set aria-label when the caller supplies an explicit `name`.
  // When omitted, the visible children ARE the accessible name — forcing a slug
  // aria-label would silently override them and violate WCAG 2.5.3 (Label-in-Name).
  // Pass `name` only when children are non-text (icons, thumbnails, etc.) or when you
  // want a richer announcement than the raw visible text (e.g. "Abrir trabajador Lupita
  // González" rather than just "Lupita González").
  const ariaLabel = name
    ? t("entityLink.open", { kind: t(`entityLink.kind.${kind}`), name })
    : undefined;
  return (
    <Link
      href={href}
      className={cn(FOCUS_RING, className)}
      aria-label={ariaLabel}
      prefetch={false}
    >
      {children}
    </Link>
  );
}
