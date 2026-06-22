import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * DossierShell — the shared chrome every entity dossier wraps.
 *
 * Server Component (no hooks, no handlers, no fetch). It only lays out the
 * back-link + title block + the ordered <…Section> stack, so all 7 dossiers
 * (lot / plot / worker / crew / batch / dispatch / pay-period) feel identical
 * and a future restyle is one edit. Matches the live PageHeader visual
 * language (animate-rise, forest hairline divider) plus an eyebrow for the
 * entity kind. World-class liquid-glass, AA on the cream aurora,
 * reduced-motion inherited (animate-rise already respects it), mobile-first.
 */
export type DossierKind =
  | "lot"
  | "plot"
  | "worker"
  | "crew"
  | "batch"
  | "dispatch"
  | "pay-period";

export interface DossierShellProps {
  kind: DossierKind;
  /** Entity display name, e.g. "Tizingal-Alto" / "Lupita González". */
  title: string;
  /** Localized kind label, e.g. "Lote" / "Trabajador" / "Cuadrilla". */
  eyebrow: string;
  /** One-line identity summary. */
  subtitle?: string;
  /** List route this entity belongs to. */
  backHref: string;
  /** es-PA back link, e.g. "Todos los lotes". */
  backLabel: string;
  /** Optional header-right create/edit affordances (smart-bar). */
  actions?: React.ReactNode;
  /** The ordered <…Section> server components. */
  children: React.ReactNode;
}

export function DossierShell({
  kind,
  title,
  eyebrow,
  subtitle,
  backHref,
  backLabel,
  actions,
  children,
}: DossierShellProps) {
  return (
    <div className="space-y-6" data-dossier={kind} data-testid={`dossier-${kind}`}>
      <Link
        href={backHref}
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted-fg transition-colors hover:text-ink focus-visible:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40 focus-visible:ring-offset-2 focus-visible:ring-offset-paper rounded-lg"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {backLabel}
      </Link>

      {/* Reuses the PageHeader visual language, with an eyebrow for entity kind. */}
      <header className="animate-rise relative mb-2 pb-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-forest/70">
          {eyebrow}
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-1 text-sm text-muted-fg">{subtitle}</p>
            )}
          </div>
          {actions && (
            <div className="flex items-center gap-2">{actions}</div>
          )}
        </div>
        {/* Hairline gradient divider — forest fades to transparent over the aurora. */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent"
        />
      </header>

      <div className="space-y-6">{children}</div>
    </div>
  );
}
