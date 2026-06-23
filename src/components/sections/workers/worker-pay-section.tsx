import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EntityLink } from "@/components/ui/entity-link";
import { DossierSection } from "@/components/dossier/dossier-section";
import type { WorkerPay } from "@/lib/db/payroll";

/**
 * WorkerPaySection — the worker dossier's cross-period pay history.
 *
 * Pure presentational Server Component. Each row is one pay line: the period
 * window links → /pay-period/[id] (the editable source of every figure — the
 * smart-bar DRILL for these computed earnings), the blended gross/net, and the
 * make-whole highlight when the worker was lifted to the legal minimum-wage
 * floor (the people-first invariant made visible). es-PA copy, AA on cream.
 */
export interface WorkerPaySectionProps {
  pay: WorkerPay[];
}

/** es-PA short period label; pure + locale-stable for the render test. */
function periodLabel(start: string, end: string): string {
  const o = { day: "2-digit", month: "short" } as const;
  return `${new Date(start).toLocaleDateString("es-PA", o)} – ${new Date(
    end,
  ).toLocaleDateString("es-PA", o)}`;
}

export function WorkerPaySection({ pay }: WorkerPaySectionProps) {
  return (
    <DossierSection
      id="pay"
      title="Historial de pagos"
      count={pay.length}
      empty={pay.length === 0}
      emptyLabel="Sin pagos calculados todavía"
    >
      <Card data-testid="worker-pay-card" className="animate-rise">
        <CardContent className="px-0 py-0">
          <ul className="divide-y divide-line" data-testid="worker-pay-lines">
            {pay.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div className="flex items-center gap-2">
                  <EntityLink
                    kind="pay-period"
                    id={p.payPeriodId}
                    className="rounded-md text-sm font-medium text-forest underline-offset-2 hover:underline"
                  >
                    {periodLabel(p.periodStart, p.periodEnd)}
                  </EntityLink>
                  {p.madeWhole && (
                    <span data-testid={`made-whole-${p.id}`}>
                      <Badge tone="warn">Ajuste a salario mínimo</Badge>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 tabular-nums">
                  <span className="text-xs text-muted-fg">
                    Bruto ${p.grossUsd.toFixed(2)}
                  </span>
                  <span className="font-display text-sm font-semibold text-ink">
                    ${p.netUsd.toFixed(2)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </DossierSection>
  );
}
