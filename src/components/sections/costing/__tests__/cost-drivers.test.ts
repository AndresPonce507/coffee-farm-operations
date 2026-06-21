import { describe, expect, it } from "vitest";
import type { AllocationRule, CostEntry, LotRuleCost } from "@/lib/types";

import {
  COST_CATEGORIES,
  categoryFigures,
  categoryFiguresFromAllocated,
  netByCategory,
} from "@/components/sections/costing/cost-drivers";

function entry(
  id: number,
  allocationRule: AllocationRule,
  amountUsd: number,
  reversesId: number | null = null,
): CostEntry {
  return {
    id,
    driver: "task",
    allocationRule,
    targetKind: "lot",
    targetCode: "JC-1",
    amountUsd,
    reversesId,
    memo: null,
    occurredAt: "2026-05-01T00:00:00Z",
    createdAt: "2026-05-01T00:00:00Z",
  };
}

describe("netByCategory", () => {
  it("covers all four documented allocation rules in canonical order", () => {
    expect(COST_CATEGORIES.map((c) => c.rule)).toEqual([
      "direct-labor",
      "processing",
      "agronomy",
      "overhead",
    ]);
  });

  it("sums signed amounts so a reversal nets the original (never double-counts)", () => {
    const netted = netByCategory([
      entry(1, "processing", 80),
      entry(2, "processing", -30, 1), // reversal
      entry(3, "direct-labor", 120),
    ]);
    expect(netted.get("processing")).toBe(50);
    expect(netted.get("direct-labor")).toBe(120);
    expect(netted.get("agronomy")).toBe(0);
    expect(netted.get("overhead")).toBe(0);
  });

  it("ignores rows whose allocation rule is outside the four canonical rules", () => {
    const netted = netByCategory([
      entry(1, "direct-labor", 10),
      { ...entry(2, "direct-labor", 999), allocationRule: "bogus" },
    ]);
    expect(netted.get("direct-labor")).toBe(10);
  });
});

describe("categoryFigures — green-kg denominator", () => {
  it("divides each netted total by green-kg to get per-kg figures", () => {
    const figs = categoryFigures(
      [entry(1, "direct-labor", 120), entry(2, "processing", 60)],
      60,
    );
    const byRule = Object.fromEntries(figs.map((f) => [f.rule, f]));
    expect(byRule["direct-labor"].perKg).toBeCloseTo(2, 6);
    expect(byRule["processing"].perKg).toBeCloseTo(1, 6);
    expect(byRule["direct-labor"].usd).toBe(120);
  });

  it("returns null per-kg on zero/undeclared green-kg (no divide-by-zero)", () => {
    const figs = categoryFigures([entry(1, "direct-labor", 120)], 0);
    expect(figs.every((f) => f.perKg === null)).toBe(true);
    // Absolute USD is still surfaced for provenance even with no denominator.
    const labor = figs.find((f) => f.rule === "direct-labor");
    expect(labor?.usd).toBe(120);
  });

  it("treats a negative green-kg as undeclared (null), never a negative per-kg", () => {
    const figs = categoryFigures([entry(1, "direct-labor", 120)], -5);
    expect(figs.every((f) => f.perKg === null)).toBe(true);
  });
});

describe("categoryFiguresFromAllocated — the fully-allocated build-up (reconciles to headline)", () => {
  const breakdown: LotRuleCost[] = [
    { rule: "direct-labor", allocatedUsd: 120 },
    { rule: "processing", allocatedUsd: 60 },
    { rule: "agronomy", allocatedUsd: 30 },
    { rule: "overhead", allocatedUsd: 90 },
  ];

  it("maps each rule's allocated USD to a per-kg figure over green-kg", () => {
    const figs = categoryFiguresFromAllocated(breakdown, 60);
    const byRule = Object.fromEntries(figs.map((f) => [f.rule, f]));
    expect(byRule["direct-labor"].perKg).toBeCloseTo(2, 6); // 120/60
    expect(byRule["processing"].perKg).toBeCloseTo(1, 6); // 60/60
    expect(byRule["agronomy"].perKg).toBeCloseTo(0.5, 6); // 30/60
    expect(byRule["overhead"].perKg).toBeCloseTo(1.5, 6); // 90/60
  });

  it("Σ(perKg) === the headline cost-per-kg-green (overhead + agronomy NOT dropped)", () => {
    const figs = categoryFiguresFromAllocated(breakdown, 60);
    const sumPerKg = figs.reduce((a, f) => a + (f.perKg ?? 0), 0);
    // (120+60+30+90)/60 = 300/60 = 5.00 — the build-up sums to the headline.
    expect(sumPerKg).toBeCloseTo(5, 6);
    expect(figs.find((f) => f.rule === "overhead")?.perKg).not.toBe(0);
    expect(figs.find((f) => f.rule === "agronomy")?.perKg).not.toBe(0);
  });

  it("always returns the four canonical categories in order, even from a partial breakdown", () => {
    const figs = categoryFiguresFromAllocated(
      [{ rule: "overhead", allocatedUsd: 12 }],
      6,
    );
    expect(figs.map((f) => f.rule)).toEqual([
      "direct-labor",
      "processing",
      "agronomy",
      "overhead",
    ]);
    expect(figs.find((f) => f.rule === "direct-labor")?.usd).toBe(0);
    expect(figs.find((f) => f.rule === "overhead")?.perKg).toBeCloseTo(2, 6);
  });

  it("returns null per-kg on zero/undeclared green-kg (no divide-by-zero), USD still surfaced", () => {
    const figs = categoryFiguresFromAllocated(breakdown, 0);
    expect(figs.every((f) => f.perKg === null)).toBe(true);
    expect(figs.find((f) => f.rule === "direct-labor")?.usd).toBe(120);
  });
});
