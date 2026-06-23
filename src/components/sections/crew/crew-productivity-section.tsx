import { Scale } from "lucide-react";

import { DossierSection } from "@/components/dossier/dossier-section";
import { EntityLink } from "@/components/ui/entity-link";
import type { CrewProductivity } from "@/lib/db/dossier/crew";

/** es-PA kg formatter — one decimal, thousands grouping. */
function kg(value: number): string {
  return `${value.toLocaleString("es-PA", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} kg`;
}

/**
 * CrewProductivitySection — the crew dossier's productivity section.
 *
 * Pure presentational Server Component. Receives today's per-picker tally + crew
 * roll-up. The crew TOTAL is a COMPUTED value, so per the smart-bar rule it is not
 * editable inline — the headline kg drills to the weigh source via an
 * `<EntityLink kind="worker">` per member (you reach the editable weigh records
 * through the picker's own dossier). Each member NAME links to /workers/[id] (P6).
 * Wraps its body in `<DossierSection id="productivity">` for deep-linking.
 */
export function CrewProductivitySection({
  productivity,
}: {
  productivity: CrewProductivity;
}) {
  const { pickers, totalKg, totalLatas, pickerCount } = productivity;

  return (
    <DossierSection
      id="productivity"
      title="Productividad de hoy"
      count={pickerCount}
      empty={pickerCount === 0}
      emptyLabel="Esta cuadrilla aún no ha pesado café hoy"
    >
      {/* Computed roll-up — drills to its source weigh records via each picker. */}
      <div className="glass-card mb-3 flex flex-wrap items-center gap-6 rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="grid h-9 w-9 place-items-center rounded-xl bg-forest-100 text-forest"
          >
            <Scale className="h-4 w-4" />
          </span>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-fg">
              Total hoy
            </p>
            <p className="font-display text-xl font-bold text-ink">
              {kg(totalKg)}
            </p>
          </div>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-fg">Latas</p>
          <p className="font-display text-xl font-bold text-ink">
            {totalLatas.toLocaleString("es-PA")}
          </p>
        </div>
      </div>

      <ul role="list" className="space-y-2">
        {pickers.map((picker) => (
          <li key={picker.workerId}>
            <EntityLink
              kind="worker"
              id={picker.workerId}
              name={picker.workerId}
              className="glass-card flex items-center justify-between gap-3 rounded-xl p-3 transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
            >
              <span className="truncate font-medium text-ink">
                {picker.name}
              </span>
              <span className="shrink-0 text-sm text-muted-fg">
                {kg(picker.kgToday)} · {picker.lataCount}{" "}
                {picker.lataCount === 1 ? "lata" : "latas"}
              </span>
            </EntityLink>
          </li>
        ))}
      </ul>
    </DossierSection>
  );
}
