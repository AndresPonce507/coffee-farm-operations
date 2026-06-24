import { HeartHandshake } from "lucide-react";
import { useTranslations } from "next-intl";

import { Card } from "@/components/ui/card";
import { DossierSection } from "@/components/dossier/dossier-section";
import { EntityLink } from "@/components/ui/entity-link";
import type { PayPeriodPayLine } from "@/lib/db/dossier/pay-period";

import { usd } from "./labels";

/**
 * PayPeriodMakeWholeSection — the legal-minimum floor, made legible (#make-whole).
 *
 * The moral + legal centerpiece of the whole payroll feature: the workers whose
 * blended piece-rate + hourly earnings fell BELOW the Panamá legal minimum and
 * were topped up ("made whole") to it. The guard itself lives un-bypassably in
 * the database; this section makes the family SEE who it protected, and by how
 * much, in dignified honey — never a bare number.
 *
 * Each protected worker links to their /workers/[id] dossier (the connectivity
 * AC) so the family can open the person and see the attendance/weigh provenance
 * behind the floor. When nobody was lifted, a calm "todos sobre el mínimo legal"
 * empty state — the floor held, no one fell short. Pure presentation.
 */
export interface PayPeriodMakeWholeSectionProps {
  lines: PayPeriodPayLine[];
}

export function PayPeriodMakeWholeSection({
  lines,
}: PayPeriodMakeWholeSectionProps) {
  const t = useTranslations("payPeriod");
  const protectedLines = lines.filter((l) => l.madeWhole);
  const total = protectedLines.reduce((sum, l) => sum + l.makeWholeUsd, 0);

  return (
    <DossierSection
      id="make-whole"
      title={t("makeWhole.title")}
      count={protectedLines.length}
      empty={protectedLines.length === 0}
      emptyLabel={t("makeWhole.empty")}
    >
      <Card className="animate-rise overflow-hidden">
        <div className="flex items-center gap-3 border-b border-white/50 bg-honey-100/40 px-5 py-3">
          <span
            aria-hidden="true"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-honey-100 text-honey-700 ring-1 ring-honey/30"
          >
            <HeartHandshake className="h-4.5 w-4.5" />
          </span>
          <div>
            <p className="font-display text-sm font-semibold text-honey-700">
              {protectedLines.length === 1
                ? t("makeWhole.headlineOne", { count: protectedLines.length })
                : t("makeWhole.headlineOther", { count: protectedLines.length })}
            </p>
            <p className="text-xs text-muted-fg">
              {t("makeWhole.periodTotal")}{" "}
              <span className="font-medium tabular-nums text-honey-700">
                {usd(total)}
              </span>
            </p>
          </div>
        </div>

        <ul className="divide-y divide-white/50">
          {protectedLines.map((line) => (
            <li
              key={line.id}
              className="flex items-center justify-between gap-3 px-5 py-3"
            >
              <div className="min-w-0">
                <EntityLink
                  kind="worker"
                  id={line.workerId}
                  name={line.workerName}
                  className="font-medium text-ink underline-offset-2 outline-none transition-colors hover:text-forest hover:underline focus-visible:text-forest focus-visible:underline"
                >
                  {line.workerName}
                </EntityLink>
                <p className="text-xs text-muted-fg">
                  {t("makeWhole.earnedFloor", {
                    earned: usd(line.grossUsd - line.makeWholeUsd),
                    floor: usd(line.minWageFloorUsd),
                  })}
                </p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-honey-100 px-3 py-1 text-xs font-semibold tabular-nums text-honey-700 ring-1 ring-honey/30">
                +{usd(line.makeWholeUsd)}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </DossierSection>
  );
}
