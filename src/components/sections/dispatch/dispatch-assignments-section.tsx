import { MapPin, Mountain, UserRound } from "lucide-react";

import { DossierSection } from "@/components/dossier/dossier-section";
import { EntityLink } from "@/components/ui/entity-link";
import { cn, num } from "@/lib/utils";
import type { CrewRosterMember } from "@/lib/db/people";
import type { DispatchCard, RipenessTarget } from "@/lib/types";

/**
 * DispatchAssignmentsSection — "assignments": who picks where (the #assignments
 * anchor of the /dispatch/[id] dossier).
 *
 * Presentational Server Component. Two connected lists:
 *   • the plot lines (in the run's pasada/readiness order), each a real
 *     <EntityLink kind="plot"> → /plots/[id] — the editable source of the parcel;
 *   • the assigned crew's roster members, each an <EntityLink kind="worker"> →
 *     /workers/[id] — so the dispatch connects to the people who fulfil it.
 *
 * Glass discipline: glass-lite rows, no blur on content; the ripeness chip conveys
 * state by text + token (never colour alone); AA on the cream canvas; min touch
 * targets for glove use. es-PA copy with empty states.
 */
export interface DispatchAssignmentsSectionProps {
  run: DispatchCard;
  /** The assigned crew's roster (→ /workers/[id] each). Empty when crew absent. */
  crewMembers: CrewRosterMember[];
}

const RIPENESS_TONE: Record<RipenessTarget, string> = {
  high: "border-forest/30 bg-forest-100/60 text-forest",
  medium: "border-honey/30 bg-honey-100/60 text-honey-700",
  low: "border-sky/30 bg-sky-100/60 text-sky",
};

const RIPENESS_ES: Record<RipenessTarget, string> = {
  high: "muy maduro",
  medium: "maduro",
  low: "casi maduro",
};

export function DispatchAssignmentsSection({
  run,
  crewMembers,
}: DispatchAssignmentsSectionProps) {
  return (
    <DossierSection
      id="assignments"
      title="Asignaciones"
      count={run.plots.length}
    >
      <div className="space-y-5">
        {/* Plot lines → /plots/[id]. */}
        {run.plots.length === 0 ? (
          <p className="rounded-xl border border-line/60 bg-white/50 px-3.5 py-6 text-center text-sm text-muted-fg">
            Sin parcelas en este despacho
          </p>
        ) : (
          <ul className="space-y-2.5">
            {run.plots.map((p) => (
              <li key={p.id}>
                <EntityLink
                  kind="plot"
                  id={p.plotId}
                  name={p.plotId}
                  className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-line/60 bg-white/55 px-3.5 py-2.5 transition-colors hover:border-forest/40 hover:bg-forest-100/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 truncate font-medium text-ink">
                      <MapPin
                        className="h-3.5 w-3.5 shrink-0 text-forest"
                        aria-hidden
                      />
                      {p.plotName}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-fg">
                      <span>{p.variety}</span>
                      <span aria-hidden>·</span>
                      <Mountain className="h-3 w-3" aria-hidden />
                      <span>{num(p.altitudeMasl)} msnm</span>
                      {p.targetKg !== null && (
                        <>
                          <span aria-hidden>·</span>
                          <span>meta {num(p.targetKg)} kg</span>
                        </>
                      )}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium",
                      RIPENESS_TONE[p.ripenessTarget],
                    )}
                  >
                    {RIPENESS_ES[p.ripenessTarget]}
                  </span>
                </EntityLink>
              </li>
            ))}
          </ul>
        )}

        {/* Crew roster → /workers/[id]. */}
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-forest/70">
            Cuadrilla asignada
          </h3>
          {crewMembers.length === 0 ? (
            <p className="rounded-xl border border-line/60 bg-white/50 px-3.5 py-4 text-center text-sm text-muted-fg">
              Sin trabajadores en el padrón de la cuadrilla
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {crewMembers.map((m) => (
                <li key={m.workerId}>
                  <EntityLink
                    kind="worker"
                    id={m.workerId}
                    name={m.workerId}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line/60 bg-white/55 px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:border-forest/40 hover:bg-forest-100/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
                  >
                    <UserRound className="h-3.5 w-3.5 text-forest" aria-hidden />
                    {m.preferredName ?? m.name}
                  </EntityLink>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </DossierSection>
  );
}
