import { CalendarDays, Gauge, Users } from "lucide-react";
import { useTranslations } from "next-intl";

import { DossierSection } from "@/components/dossier/dossier-section";
import { EntityLink } from "@/components/ui/entity-link";
import { Badge } from "@/components/ui/badge";
import { num } from "@/lib/utils";
import type { DispatchCard } from "@/lib/types";

import { bilingual, DISPATCH_TERMS } from "./labels";

/**
 * DispatchRunSection — "the run": the dispatch-run identity header (the #the-run
 * anchor of the /dispatch/[id] dossier).
 *
 * Presentational Server Component. Surfaces the run's crew (a real
 * <EntityLink kind="crew"> → /crew/[crewId]), the morning it dispatches, the
 * season, the readiness threshold the plots were chosen by, and the share-status
 * chip. Glass-card surface, no blur on content; the status conveys state by text +
 * token (never colour alone); AA on the cream canvas. es-PA copy; the headline
 * goes bilingual (es · ngäbere) when the crew speaks ngäbere.
 */
export interface DispatchRunSectionProps {
  run: DispatchCard;
  /** The crew's languages — drives the bilingual field-facing headline. */
  crewLanguages: string[];
}

export function DispatchRunSection({
  run,
  crewLanguages,
}: DispatchRunSectionProps) {
  const t = useTranslations("dispatch");
  const sent = run.status === "sent" || run.status === "acknowledged";
  const pickToday = bilingual(
    DISPATCH_TERMS.pickToday,
    crewLanguages,
    "A cosechar hoy",
  );

  return (
    <DossierSection id="the-run" title={t("run.title")}>
      <article className="glass-card rounded-2xl p-5">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line/70 pb-4">
          <div className="min-w-0">
            <EntityLink
              kind="crew"
              id={run.crewId}
              className="font-display text-lg font-bold tracking-tight text-ink underline-offset-4 transition-colors hover:text-forest hover:underline"
            >
              <span className="inline-flex items-center gap-1.5">
                <Users className="h-4 w-4 text-forest" aria-hidden />
                {run.crewName}
              </span>
            </EntityLink>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-fg">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden />
              <span>
                {pickToday} · {run.dispatchDate}
              </span>
            </p>
          </div>
          <Badge tone={sent ? "forest" : "neutral"}>{run.status}</Badge>
        </header>

        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-fg">
              {t("run.season")}
            </dt>
            <dd className="mt-0.5 font-display text-base font-semibold text-ink">
              {run.season}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-fg">
              {t("run.plots")}
            </dt>
            <dd className="mt-0.5 font-display text-base font-semibold text-ink">
              {num(run.plotCount)}
            </dd>
          </div>
          <div>
            <dt className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-fg">
              <Gauge className="h-3 w-3" aria-hidden />
              {t("run.ripenessThreshold")}
            </dt>
            <dd className="mt-0.5 font-display text-base font-semibold text-ink">
              {num(run.readinessThreshold * 100)}%
            </dd>
          </div>
        </dl>
      </article>
    </DossierSection>
  );
}
