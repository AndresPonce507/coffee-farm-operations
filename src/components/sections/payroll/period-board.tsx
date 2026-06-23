import Link from "next/link";
import { HeartHandshake, Users, Wallet } from "lucide-react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { entityHref } from "@/lib/dossier/entity-href";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { PayPeriodSummary } from "@/lib/db/payroll";
import { cn, longDate } from "@/lib/utils";

/**
 * PeriodBoard — the /payroll overview (P2-S7). A glass grid of pay-period cards,
 * each linking into its per-worker breakdown. A card carries the period's date
 * window, its lifecycle status (open → calculated → approved → paid), the worker
 * count, the period gross/net, and — when the legal-floor guard fired for anyone —
 * a make-whole chip ("N made whole") that surfaces the protection right on the
 * board, never buried inside the detail view.
 *
 * The active period (the one being viewed) gets a forest ring so the board reads as
 * "you are here". Server Component — the route hands in the periods (newest first
 * from `getPayPeriods`). Each card is a Next <Link href={`/payroll/${id}`}>. The
 * only motion is the shared card rise (reduced-motion-safe in globals.css).
 */
export interface PeriodBoardProps {
  periods: PayPeriodSummary[];
  /** The period currently being viewed, if any — gets the "you are here" ring. */
  activePeriodId?: string;
  className?: string;
}

/** Pay-period lifecycle → badge tone + a colour-independent label. */
function statusMeta(status: string): { tone: BadgeTone; label: string } {
  switch (status) {
    case "paid":
      return { tone: "forest", label: "Paid" };
    case "approved":
      return { tone: "honey", label: "Approved" };
    case "calculated":
      return { tone: "sky", label: "Calculated" };
    case "open":
    default:
      return { tone: "neutral", label: "Open" };
  }
}

/** USD with cents — the board's self-contained money formatter. */
function usd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function PeriodBoard({
  periods,
  activePeriodId,
  className,
}: PeriodBoardProps) {
  if (periods.length === 0) {
    return (
      <Card className="animate-rise">
        <CardContent className="py-4">
          <EmptyState
            icon={Wallet}
            title="No pay periods yet"
            description="Open a pay period and calculate it to roll up the blended piece-rate + hourly earnings — with the legal-minimum make-whole guard applied to every worker."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div
      data-testid="period-board"
      className={cn(
        "stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3",
        className,
      )}
    >
      {periods.map((p) => {
        const status = statusMeta(p.status);
        const active = p.id === activePeriodId;
        return (
          <Link
            key={p.id}
            href={entityHref["pay-period"](p.id)}
            data-testid={`period-card-${p.id}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "block rounded-2xl outline-none ring-forest/30 transition focus-visible:ring-2",
              active && "ring-2 ring-forest/60",
            )}
          >
            <Card className="h-full transition-transform hover:-translate-y-0.5">
              <CardContent className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-display text-sm font-semibold text-ink">
                      {longDate(p.periodStart)} – {longDate(p.periodEnd)}
                    </p>
                    {p.season ? (
                      <p className="mt-0.5 truncate text-xs text-muted-fg">
                        {p.season}
                      </p>
                    ) : null}
                  </div>
                  <Badge tone={status.tone} dot className="shrink-0">
                    {status.label}
                  </Badge>
                </div>

                <div className="flex items-center gap-1.5 text-xs text-muted-fg">
                  <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {p.workerCount} {p.workerCount === 1 ? "worker" : "workers"}
                </div>

                <dl className="flex items-end justify-between gap-3 pt-1">
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-muted-fg">
                      Gross
                    </dt>
                    <dd className="font-display text-base font-semibold tabular-nums text-ink">
                      {usd(p.totalGrossUsd)}
                    </dd>
                  </div>
                  <div className="text-right">
                    <dt className="text-[11px] uppercase tracking-wide text-muted-fg">
                      Net
                    </dt>
                    <dd className="font-display text-base font-semibold tabular-nums text-forest-700">
                      {usd(p.totalNetUsd)}
                    </dd>
                  </div>
                </dl>

                {p.madeWholeCount > 0 ? (
                  <div
                    data-testid={`period-made-whole-${p.id}`}
                    className="flex items-center gap-1.5 rounded-xl bg-honey-100/60 px-2.5 py-1.5 text-xs font-medium text-honey-700 ring-1 ring-honey/20"
                  >
                    <HeartHandshake
                      className="h-3.5 w-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    {p.madeWholeCount} made whole
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
