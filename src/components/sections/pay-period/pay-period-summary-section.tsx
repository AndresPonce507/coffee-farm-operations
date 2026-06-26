import { CalendarRange, Coins, HeartHandshake, Users, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";

import { Card } from "@/components/ui/card";
import { DossierSection } from "@/components/dossier/dossier-section";
import type { PayPeriodSummary } from "@/lib/db/payroll";
import { cn } from "@/lib/utils";

import { statusLabelEs, usd } from "./labels";

/**
 * PayPeriodSummarySection — the period's identity + money roll-up (#summary).
 *
 * The dossier headline: the window (period_start → period_end), the lifecycle
 * status + season, how many workers, and the period's Σ gross / Σ net / Σ
 * make-whole. Every money figure here is a COMPUTED roll-up — you can't edit a
 * sum — so per the smart-bar rule the totals DRILL to the editable source pay
 * lines (the `#lines` section, where each line is traceable and approvable),
 * rather than pretending to be an edit field. The made-whole total carries the
 * dignified honey highlight (the legal-floor guard is the moral centerpiece).
 *
 * Pure presentation: the page hands in the already-fetched period. es-PA-first,
 * AA on the cream aurora, reduced-motion inherited (animate-rise).
 */
export interface PayPeriodSummarySectionProps {
  period: PayPeriodSummary;
}

interface Stat {
  label: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  highlight?: boolean;
}

export function PayPeriodSummarySection({ period }: PayPeriodSummarySectionProps) {
  const t = useTranslations("payPeriod");
  const stats: Stat[] = [
    {
      label: t("summary.workers"),
      value: String(period.workerCount),
      icon: Users,
    },
    {
      label: t("summary.totalGross"),
      value: usd(period.totalGrossUsd),
      icon: Wallet,
    },
    {
      label: t("summary.totalNet"),
      value: usd(period.totalNetUsd),
      icon: Coins,
    },
    {
      label: t("summary.makeWhole"),
      value: usd(period.totalMakeWholeUsd),
      sub:
        period.madeWholeCount > 0
          ? period.madeWholeCount === 1
            ? t("summary.makeWholeSubOne", { count: period.madeWholeCount })
            : t("summary.makeWholeSubOther", { count: period.madeWholeCount })
          : t("summary.makeWholeSubNone"),
      icon: HeartHandshake,
      highlight: true,
    },
  ];

  return (
    <DossierSection id="summary" title={t("summary.title")}>
      <div className="space-y-4">
        {/* Window + status header. */}
        <Card className="animate-rise">
          <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-forest-100 text-forest"
              >
                <CalendarRange className="h-4.5 w-4.5" />
              </span>
              <div>
                <p className="font-display text-base font-semibold tabular-nums text-ink">
                  {period.periodStart} <span className="text-muted-fg">→</span>{" "}
                  {period.periodEnd}
                </p>
                <p className="text-xs text-muted-fg">
                  {period.season
                    ? t("summary.seasonPrefix", { season: period.season })
                    : ""}
                  {t("summary.statusLine", { status: statusLabelEs(period.status) })}
                  {period.calculatedAt
                    ? t("summary.calculatedSuffix", { date: period.calculatedAt })
                    : ""}
                </p>
              </div>
            </div>
            {/* Computed totals are not editable — drill to the source pay lines. */}
            <a
              href="#lines"
              data-testid="summary-drill-lines"
              className="inline-flex min-h-9 items-center gap-1.5 self-start rounded-lg px-2 text-xs font-medium text-forest transition-colors hover:text-forest-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40 sm:self-auto"
            >
              {t("summary.viewLines")}
            </a>
          </div>
        </Card>

        {/* Money roll-up strip. */}
        <Card
          data-testid="pay-period-summary"
          className="animate-rise grid grid-cols-1 divide-y divide-white/50 sm:grid-cols-2 sm:divide-x lg:grid-cols-4 lg:divide-y-0"
        >
          {stats.map(({ label, value, sub, icon: Icon, highlight }) => (
            <a
              key={label}
              href="#lines"
              aria-label={t("summary.statDrillAria", { label, value })}
              className={cn(
                "flex items-center gap-3 px-5 py-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40",
                highlight ? "bg-honey-100/40 hover:bg-honey-100/60" : "hover:bg-white/40",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "grid h-9 w-9 shrink-0 place-items-center rounded-xl",
                  highlight
                    ? "bg-honey-100 text-honey-700 ring-1 ring-honey/30"
                    : "bg-forest-100 text-forest",
                )}
              >
                <Icon className="h-4.5 w-4.5" />
              </span>
              <div className="min-w-0">
                <p
                  className={cn(
                    "font-display text-xl font-semibold tabular-nums",
                    highlight && period.madeWholeCount > 0
                      ? "text-honey-700"
                      : "text-ink",
                  )}
                >
                  {value}
                </p>
                <p
                  className={cn(
                    "text-xs",
                    highlight ? "font-medium text-honey-700/90" : "text-muted-fg",
                  )}
                >
                  {label}
                </p>
                {sub ? (
                  <p className="mt-0.5 truncate text-[11px] text-muted-fg">
                    {sub}
                  </p>
                ) : null}
              </div>
            </a>
          ))}
        </Card>
      </div>
    </DossierSection>
  );
}
