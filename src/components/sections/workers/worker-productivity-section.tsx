import { MapPin } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EntityLink } from "@/components/ui/entity-link";
import { DossierSection } from "@/components/dossier/dossier-section";
import type { WeighByPicker } from "@/lib/db/weigh";
import type { WorkerWeigh } from "@/lib/db/dossier/worker";

/**
 * WorkerProductivitySection — the worker dossier's weighs / productivity card.
 *
 * Pure presentational Server Component. The header strip shows today's running
 * tally (latas + kg) from the picker-summary view — a COMPUTED roll-up, so it
 * DRILLS to the weigh source tab via #weigh-source. Below it, the per-lata
 * weigh-event ledger: each row links its plot → /plots/[id] (where they picked)
 * and its lot → /lots/[code] (what they fed) — the two cross-entity links that
 * tie a picker to the estate's geography and traceability. es-PA, AA on cream.
 */
export interface WorkerProductivitySectionProps {
  /** Today's running tally, or null when the worker hasn't weighed in today. */
  summary: WeighByPicker | null;
  /** The append-only weigh-event evidence (plot + lot bearing), newest first. */
  events: WorkerWeigh[];
}

const RIPENESS_LABEL: Record<string, string> = {
  ripe: "Maduro",
  underripe: "Verde",
  overripe: "Sobremaduro",
};

export function WorkerProductivitySection({
  summary,
  events,
}: WorkerProductivitySectionProps) {
  const kgToday = summary?.kgToday ?? 0;
  const latasToday = summary?.lataCount ?? 0;

  return (
    <DossierSection
      id="weighs"
      title="Pesajes y productividad"
      count={events.length}
      empty={events.length === 0 && !summary}
      emptyLabel="Sin pesajes registrados todavía"
    >
      <Card data-testid="worker-productivity-card" className="animate-rise">
        <CardContent className="space-y-5">
          {/* Computed today tally — drills to the weigh source surface. */}
          <a
            href="/weigh#weigh-source"
            data-testid="weigh-today-drill"
            className="flex items-center justify-between gap-4 rounded-xl bg-forest-50 px-4 py-3 ring-1 ring-forest-100 transition-colors hover:bg-forest-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
          >
            <div>
              <p className="text-xs text-muted-fg">Hoy</p>
              <p className="font-display text-xl font-semibold tabular-nums text-ink">
                {kgToday.toFixed(1)} kg
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-fg">Latas</p>
              <p className="font-display text-xl font-semibold tabular-nums text-ink">
                {latasToday}
              </p>
            </div>
          </a>

          {/* Per-lata ledger — each row links plot + lot. */}
          {events.length > 0 && (
            <ul className="space-y-2" data-testid="worker-weigh-events">
              {events.map((e) => (
                <li
                  key={e.eventUid}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white/55 px-3 py-2"
                >
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-display font-semibold tabular-nums text-ink">
                      {e.kg.toFixed(1)} kg
                    </span>
                    <Badge tone="neutral">
                      {RIPENESS_LABEL[e.ripeness] ?? e.ripeness}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <EntityLink
                      kind="plot"
                      id={e.plotId}
                      className="inline-flex items-center gap-1 rounded-md font-medium text-forest underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
                    >
                      <MapPin className="h-3.5 w-3.5" aria-hidden />
                      {e.plotId}
                    </EntityLink>
                    <span aria-hidden className="text-muted-fg">
                      →
                    </span>
                    <EntityLink
                      kind="lot"
                      id={e.lotCode}
                      className="rounded-md font-medium text-coffee underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
                    >
                      {e.lotCode}
                    </EntityLink>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </DossierSection>
  );
}
