import Link from "next/link";
import { Receipt } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { CostWaterfall } from "@/components/charts/cost-waterfall";
import { CostDecomposition } from "@/components/charts/cost-decomposition";
import type { LotRuleCost } from "@/lib/types";
import { cn, kg, num, usd } from "@/lib/utils";

import { categoryFiguresFromAllocated } from "./cost-drivers";

export interface CostLotCardProps {
  /** The green lot's JC-NNN traceability code. */
  code: string;
  /** The RPC verdict — true cost-per-kg-green; null on 0/undeclared green-kg. */
  costPerKgGreen: number | null;
  /** The green-kg denominator (terminal graph mass) the per-kg figures divide by. */
  greenKg: number;
  /**
   * The FULLY-ALLOCATED per-rule cost breakdown (cogs_breakdown_per_lot) — the
   * SAME allocation the headline divides (overhead pro-rata + agronomy plot-split
   * + walked source costs all included), so the build-up reconciles to the total.
   * Reversals already netted in-DB.
   */
  breakdown: LotRuleCost[];
  /** Extra classes for the outer card (e.g. stagger child styling). */
  className?: string;
}

/**
 * CostLotCard — one green lot's activity-based COGS, the number the business
 * turns on. Pure presentation (props-driven, no data deps, no hooks): the page
 * assembles `{costPerKgGreen, greenKg, breakdown}` from the cogs port and hands
 * it down.
 *
 * Layout:
 *  - the true cost-per-kg-green HEADLINE (an em-dash, never a fabricated 0, when
 *    the green-kg denominator is undeclared — mirrors the RPC's NULL contract);
 *  - a per-lot `CostWaterfall` building up from Labor → Processing → Agronomy →
 *    Overhead to the total (AD-5 wet-glass material inherited from the Donut);
 *  - a `CostDecomposition` bar showing each category's share;
 *  - a per-category per-kg readout list whose figures SUM to the headline.
 *
 * The build-up reads the DB's per-rule allocation (`categoryFiguresFromAllocated`),
 * NOT a lot-literal `cost_entry` ledger — so the waterfall/decomposition/readouts
 * can never contradict the cost-per-kg-green headline (the D-COST review CRIT:
 * the old lot-scoped ledger dropped overhead/agronomy/walked-source costs, leaving
 * a build-up that silently understated its own total). Reversals are netted in-DB
 * (signed `allocated_cost`).
 */
export function CostLotCard({
  code,
  costPerKgGreen,
  greenKg,
  breakdown,
  className,
}: CostLotCardProps) {
  const figures = categoryFiguresFromAllocated(breakdown, greenKg);

  // Honest provenance: the count of cost DRIVERS actually contributing to this
  // lot (categories with a non-zero allocated amount) — never the misleading
  // count of cost_entry rows literally tagged to the green code (which is 0 when
  // a lot's cost was booked upstream / as overhead, yet the headline is non-zero).
  const driverCount = figures.filter((f) => f.usd !== 0).length;

  // Charts run on the per-kg figures (null → 0 so the geometry never NaNs; the
  // headline + readouts still honour the NULL-on-zero-yield contract in text).
  const waterfallSteps = figures.map((f) => ({
    label: f.label,
    value: f.perKg ?? 0,
    color: f.color,
  }));
  const decompSlices = figures.map((f) => ({
    label: f.label,
    value: f.perKg ?? 0,
    color: f.color,
  }));

  // The provenance deep-link: the lot's lineage/audit surface where the
  // append-only cost_entry ledger lives. (Nav wiring for a dedicated ledger
  // route is S9's; today this resolves to the lot's traceability page.)
  const provenanceHref = `/lots/${code}#cost-entries`;

  return (
    <Card className={cn("animate-rise overflow-hidden", className)}>
      <CardContent className="space-y-4">
        {/* Headline: lot code + true cost-per-kg-green. */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-sm font-semibold text-ink">{code}</p>
            <p className="mt-0.5 text-xs text-muted-fg">
              {greenKg > 0
                ? `${kg(greenKg)} green`
                : "green-kg not yet declared"}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wide text-muted-fg">
              Cost / kg green
            </p>
            <p
              data-testid={`cost-headline-${code}`}
              className="font-display text-2xl font-bold text-forest tabular-nums"
            >
              {costPerKgGreen == null ? "—" : usd(costPerKgGreen, 2)}
            </p>
          </div>
        </div>

        {/* Per-lot waterfall — the build-up to cost-per-kg-green. */}
        <div data-testid={`cost-waterfall-${code}`}>
          <CostWaterfall steps={waterfallSteps} height={160} />
        </div>

        {/* Decomposition bar — each category's share of total cost. */}
        <div data-testid={`cost-decomposition-${code}`}>
          <CostDecomposition slices={decompSlices} />
        </div>

        {/* Per-category per-kg readouts — each figure resolvable to provenance. */}
        <ul className="grid grid-cols-2 gap-1.5">
          {figures.map((f) => (
            <li
              key={f.rule}
              data-testid={`cost-category-perkg-${f.rule}`}
              className="flex items-center justify-between rounded-md bg-card px-2 py-1 text-xs ring-1 ring-black/5"
            >
              <span className="flex items-center gap-1.5 text-muted-fg">
                <span
                  aria-hidden
                  className="inline-block size-2 rounded-full"
                  style={{ backgroundColor: f.color }}
                />
                {f.label}
              </span>
              <span className="font-medium text-ink tabular-nums">
                {f.perKg == null ? "—" : `${usd(f.perKg, 2)}/kg`}
              </span>
            </li>
          ))}
        </ul>

        {/* AD-4 honest provenance: the count of cost drivers contributing to
            this lot, linking through to the cost_entry audit trail behind them. */}
        <Link
          href={provenanceHref}
          data-testid={`cost-provenance-${code}`}
          className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-xs font-medium text-forest transition-colors hover:bg-forest-100/60"
        >
          <Receipt className="h-3.5 w-3.5" aria-hidden />
          {num(driverCount)} cost {driverCount === 1 ? "driver" : "drivers"} ·
          provenance
        </Link>
      </CardContent>
    </Card>
  );
}
