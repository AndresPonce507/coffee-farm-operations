import { EmptyState } from "@/components/ui/empty-state";

/**
 * DossierSection — the shared wrapper every dossier section body wraps.
 *
 * Server Component (no hooks, no handlers). Gives every section a localized
 * heading, an optional count badge, a deep-linkable #anchor id (so
 * /plots/[id]#vegetation scrolls here), and a uniform es-PA empty state. A
 * concrete <XSection data={…}> takes already-fetched domain props (the page
 * owns Promise.all) and wraps its body in this so all 7 dossiers share
 * section chrome. scroll-mt-24 keeps an anchored section clear of the topbar.
 */
export interface DossierSectionProps {
  /** Hash anchor, e.g. "vegetation" → deep-linkable #vegetation. */
  id: string;
  /** Localized section heading. */
  title: string;
  /** Optional count badge, e.g. 8 → "8 cosechas". Renders for an explicit 0. */
  count?: number;
  /** Render the empty state instead of children. */
  empty?: boolean;
  /** es-PA empty copy. */
  emptyLabel?: string;
  children: React.ReactNode;
}

export function DossierSection({
  id,
  title,
  count,
  empty,
  emptyLabel,
  children,
}: DossierSectionProps) {
  return (
    <section id={id} className="scroll-mt-24" data-testid={`section-${id}`}>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
        {typeof count === "number" && (
          <span className="rounded-full bg-forest-100 px-2 py-0.5 text-xs font-medium text-forest">
            {count}
          </span>
        )}
      </div>
      {empty ? (
        <EmptyState title={emptyLabel ?? "Sin registros todavía"} />
      ) : (
        children
      )}
    </section>
  );
}
