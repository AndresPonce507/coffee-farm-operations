import { FileSignature } from "lucide-react";
import { useTranslations } from "next-intl";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DossierSection } from "@/components/dossier/dossier-section";
import type { PorObraContract } from "@/lib/db/people";

/**
 * WorkerContractsSection — the worker dossier's por-obra (piece-rate) contracts.
 *
 * Pure presentational Server Component. Renders each signed piece-rate agreement
 * newest-effective first: the task kind, the rate (per basis), the effective
 * window, and whether it is the live contract or has been superseded. The
 * superseded_by chain makes the rate history auditable. es-PA copy, AA on cream.
 */
export interface WorkerContractsSectionProps {
  contracts: PorObraContract[];
}

/** es-PA date (no time); pure + locale-stable for the render test. */
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-PA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function WorkerContractsSection({
  contracts,
}: WorkerContractsSectionProps) {
  const t = useTranslations("workers");
  return (
    <DossierSection
      id="contracts"
      title={t("contracts.sectionTitle")}
      count={contracts.length}
      empty={contracts.length === 0}
      emptyLabel={t("contracts.emptyLabel")}
    >
      <div className="space-y-3" data-testid="worker-contracts">
        {contracts.map((c) => {
          const active = c.supersededBy === null;
          return (
            <Card
              key={c.id}
              className="animate-rise"
              data-testid={`contract-${c.id}`}
            >
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-coffee-200/50 text-coffee"
                  >
                    <FileSignature className="h-4.5 w-4.5" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-ink">
                      {c.taskKind}
                    </p>
                    <p className="text-xs text-muted-fg">
                      {fmtDate(c.effectiveFrom)}
                      {c.effectiveTo ? ` – ${fmtDate(c.effectiveTo)}` : " –"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-display text-sm font-semibold tabular-nums text-ink">
                    ${c.rateUsd.toFixed(2)}
                    <span className="text-xs font-normal text-muted-fg">
                      {" "}
                      /{c.rateBasis}
                    </span>
                  </span>
                  <Badge tone={active ? "ok" : "neutral"}>
                    {active ? t("contracts.active") : t("contracts.superseded")}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </DossierSection>
  );
}
