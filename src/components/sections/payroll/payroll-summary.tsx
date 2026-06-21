import { Coins, HeartHandshake, Wallet } from "lucide-react";

import { Card } from "@/components/ui/card";
import type { PayPeriodSummary } from "@/lib/db/payroll";
import { cn } from "@/lib/utils";

/**
 * PayrollSummary — the headline strip above the payroll period board (P2-S7).
 *
 * Four figures on one divided glass card (mirrors CrewSummary's shape): how many
 * pay periods exist, this period's total gross and total net, and — the standout —
 * how many workers the legal-minimum floor lifted ("made whole"). The make-whole
 * count is the moral/legal centerpiece of the whole feature, so it carries a
 * dignified honey highlight and a clear sub-label, never a bare number.
 *
 * Money is USD with 2 decimals (a local `usd()` so the strip is self-contained and
 * always shows cents), tabular-nums so columns align. The figures are taken from
 * the LATEST period (the first row — `getPayPeriods` returns newest-first); the
 * period count is the length of the whole list. Pure presentation: the route hands
 * in the periods. Divider hairlines stack on mobile, split horizontally from `sm`
 * up; the only motion is the card's shared `animate-rise` (reduced-motion-safe).
 */
export interface PayrollSummaryProps {
  periods: PayPeriodSummary[];
  className?: string;
}

/** USD with cents, always — the strip's self-contained money formatter. */
function usd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

interface Stat {
  label: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  /** The make-whole stat gets the dignified honey highlight. */
  highlight?: boolean;
}

export function PayrollSummary({ periods, className }: PayrollSummaryProps) {
  const latest = periods[0];
  const totalGross = latest?.totalGrossUsd ?? 0;
  const totalNet = latest?.totalNetUsd ?? 0;
  const madeWhole = latest?.madeWholeCount ?? 0;

  const stats: Stat[] = [
    {
      label: "Pay periods",
      value: String(periods.length),
      icon: Coins,
    },
    {
      label: "Total gross",
      value: usd(totalGross),
      icon: Wallet,
    },
    {
      label: "Total net",
      value: usd(totalNet),
      icon: Wallet,
    },
    {
      label: "Made whole",
      value: String(madeWhole),
      sub:
        madeWhole > 0
          ? `${madeWhole === 1 ? "worker" : "workers"} lifted to the legal floor`
          : "all above the floor",
      icon: HeartHandshake,
      highlight: true,
    },
  ];

  return (
    <Card
      data-testid="payroll-summary"
      className={cn(
        "animate-rise grid grid-cols-1 divide-y divide-white/50 sm:grid-cols-2 sm:divide-x lg:grid-cols-4 lg:divide-y-0",
        // hairlines split per-column on lg, but on the 2-col sm grid the second
        // row needs its top divider back — handled by the base divide-y above.
        className,
      )}
    >
      {stats.map(({ label, value, sub, icon: Icon, highlight }) => (
        <div
          key={label}
          data-testid={highlight ? "payroll-summary-made-whole" : undefined}
          className={cn(
            "flex items-center gap-3 px-5 py-4",
            highlight && "bg-honey-100/40",
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
                highlight && madeWhole > 0 ? "text-honey-700" : "text-ink",
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
              <p className="mt-0.5 truncate text-[11px] text-muted-fg">{sub}</p>
            ) : null}
          </div>
        </div>
      ))}
    </Card>
  );
}
