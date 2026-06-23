import { Send } from "lucide-react";
import { useTranslations } from "next-intl";

import { DossierSection } from "@/components/dossier/dossier-section";
import { EntityLink } from "@/components/ui/entity-link";
import { Badge } from "@/components/ui/badge";
import type { DispatchCard, DispatchStatus } from "@/lib/types";

type Translator = ReturnType<typeof useTranslations>;

/** Dispatch status → es-PA label + badge tone (state survives mono via text). */
function statusMeta(
  status: DispatchStatus,
  t: Translator,
): {
  label: string;
  tone: "ok" | "warn" | "neutral";
} {
  switch (status) {
    case "acknowledged":
      return { label: t("dispatchSection.statusAcknowledged"), tone: "ok" };
    case "sent":
      return { label: t("dispatchSection.statusSent"), tone: "ok" };
    case "draft":
      return { label: t("dispatchSection.statusDraft"), tone: "warn" };
    default:
      return { label: t("dispatchSection.statusSuperseded"), tone: "neutral" };
  }
}

/**
 * CrewDispatchSection — the crew dossier's dispatch-history section.
 *
 * Pure presentational Server Component. Receives every dispatch run this crew has
 * received (newest morning first) and renders each as a glass row whose DATE is an
 * `<EntityLink kind="dispatch">` to that run's /dispatch/[id] dossier (P6), with
 * each plot line a NESTED `<EntityLink kind="plot">` to /plots/[id]. The status is
 * carried by a text label, never colour alone. Wraps its body in
 * `<DossierSection id="dispatch">` for /crew/[id]#dispatch deep-linking.
 */
export function CrewDispatchSection({
  history,
}: {
  history: DispatchCard[];
}) {
  const t = useTranslations("crew");
  return (
    <DossierSection
      id="dispatch"
      title={t("dispatchSection.title")}
      count={history.length}
      empty={history.length === 0}
      emptyLabel={t("dispatchSection.empty")}
    >
      <ul role="list" className="space-y-3">
        {history.map((run) => {
          const meta = statusMeta(run.status, t);
          return (
            <li
              key={run.id}
              className="glass-card rounded-2xl p-4"
              data-testid={`dispatch-run-${run.id}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <EntityLink
                  kind="dispatch"
                  id={run.id}
                  className="inline-flex items-center gap-2 font-display text-sm font-semibold text-ink transition hover:text-forest rounded-lg"
                >
                  <Send className="h-4 w-4 text-forest" aria-hidden />
                  {t("dispatchSection.dispatchOn", { date: run.dispatchDate })}
                </EntityLink>
                <Badge tone={meta.tone} dot>
                  {meta.label}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-fg">
                {run.plotCount === 1
                  ? t("dispatchSection.plotCountOne", { count: run.plotCount })
                  : t("dispatchSection.plotCountOther", { count: run.plotCount })}
              </p>
              {run.plots.length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {run.plots.map((line) => (
                    <li key={line.id}>
                      <EntityLink
                        kind="plot"
                        id={line.plotId}
                        name={line.plotName}
                        className="min-h-11 inline-flex items-center justify-center rounded-full bg-muted px-2 text-[11px] font-medium text-muted-fg ring-1 ring-line transition hover:text-ink"
                      >
                        {line.plotName}
                      </EntityLink>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </DossierSection>
  );
}
