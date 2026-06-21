import type { AllocationRule, CostEntry, LotRuleCost } from "@/lib/types";

/**
 * S7 cost-category contract — the FOUR documented allocation rules become the
 * four cost-build-up categories on every costing surface (waterfall steps +
 * decomposition slices). Order is the canonical build-up order: the cost a lot
 * accrues earliest (direct labor at the cherry) first, the farm-wide overhead
 * pro-rata last. Each carries a brand-token hex so the waterfall and the
 * decomposition bar speak the same color language.
 */
export interface CostCategory {
  /** The `cost_entry.allocation_rule` this category sums. */
  rule: AllocationRule;
  /** Human label shown in waterfall steps + decomposition legend. */
  label: string;
  /** Brand-token hex (literal, never interpolated into a Tailwind class). */
  color: string;
}

export const COST_CATEGORIES: readonly CostCategory[] = [
  { rule: "direct-labor", label: "Labor", color: "#8a5a2b" }, // coffee/earth
  { rule: "processing", label: "Processing", color: "#2563eb" }, // sky
  { rule: "agronomy", label: "Agronomy", color: "#16a34a" }, // forest-green
  { rule: "overhead", label: "Overhead", color: "#b8860b" }, // honey
] as const;

/**
 * Net a lot's append-only ledger into a per-category total (USD). Reversing
 * entries are KEPT (append-only) and net the original by summing SIGNED amounts
 * — so a $80 processing charge corrected by a -$30 reversal nets to $50, never
 * double-counted. Rows whose `allocationRule` isn't one of the four canonical
 * rules are ignored (defensive; the DB check constraint should prevent them).
 */
export function netByCategory(ledger: CostEntry[]): Map<AllocationRule, number> {
  const totals = new Map<AllocationRule, number>();
  for (const cat of COST_CATEGORIES) totals.set(cat.rule, 0);
  for (const entry of ledger) {
    if (!totals.has(entry.allocationRule as AllocationRule)) continue;
    const rule = entry.allocationRule as AllocationRule;
    totals.set(rule, (totals.get(rule) ?? 0) + entry.amountUsd);
  }
  return totals;
}

/**
 * Build per-kg-green category figures for one lot from its netted ledger.
 * Divides each netted category total by the lot's green-kg denominator — the
 * S7 rule that every cost is expressed per kg of GREEN coffee (the terminal
 * graph mass). When `greenKg` is 0/undeclared we return `null` for the per-kg
 * figures (NULL-on-zero-yield — never a divide-by-zero) while still surfacing
 * the absolute USD totals for provenance.
 */
export interface CategoryFigure extends CostCategory {
  /** Netted absolute USD for this category (signed reversals already applied). */
  usd: number;
  /** Netted USD ÷ green-kg, or null when green-kg is 0/undeclared. */
  perKg: number | null;
}

export function categoryFigures(
  ledger: CostEntry[],
  greenKg: number,
): CategoryFigure[] {
  const netted = netByCategory(ledger);
  const safeKg = greenKg > 0 ? greenKg : null;
  return COST_CATEGORIES.map((cat) => {
    const usd = netted.get(cat.rule) ?? 0;
    return {
      ...cat,
      usd,
      perKg: safeKg === null ? null : usd / safeKg,
    };
  });
}

/**
 * Build per-kg-green category figures from the DB's FULLY-ALLOCATED per-rule
 * breakdown (cogs_breakdown_per_lot → `LotRuleCost[]`) — the SAME allocation the
 * cost-per-kg-green headline divides. Unlike `categoryFigures` (which nets a
 * lot-literal `cost_entry` ledger and so omits overhead pro-rata, the agronomy
 * plot-split, and costs walked down from source lots), every figure here sums to
 * the headline: Σ(perKg) === costPerKgGreen. This is what the card build-up
 * reads, so the waterfall/decomposition never contradict their own total.
 * Reversals are already netted in-DB (signed `allocated_cost`). Same NULL-on-
 * zero-yield contract as `categoryFigures`.
 */
export function categoryFiguresFromAllocated(
  breakdown: readonly LotRuleCost[],
  greenKg: number,
): CategoryFigure[] {
  const byRule = new Map<string, number>();
  for (const row of breakdown) {
    byRule.set(row.rule, (byRule.get(row.rule) ?? 0) + row.allocatedUsd);
  }
  const safeKg = greenKg > 0 ? greenKg : null;
  return COST_CATEGORIES.map((cat) => {
    const usd = byRule.get(cat.rule) ?? 0;
    return {
      ...cat,
      usd,
      perKg: safeKg === null ? null : usd / safeKg,
    };
  });
}
