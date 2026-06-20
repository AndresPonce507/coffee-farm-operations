import { describe, expect, it } from "vitest";

import { harvests } from "@/lib/data/harvests";
import { SEASON } from "@/lib/data/trends";
import { workers } from "@/lib/data/workers";

/**
 * Seed-consistency invariants. The dashboard's three "today" surfaces — the
 * per-picker leaderboard (workers.todayKg), the harvest log (harvests dated
 * "2026-06-20"), and the season hero (SEASON.todayKg) — must all agree, or the
 * UI contradicts itself (e.g. a picker shown "Off today" while the log credits
 * them kg). These guards fail loudly if the canonical mock data ever drifts.
 */
const TODAY = "2026-06-20";

/** Sum of cherriesKg over today's harvest records, grouped by picker name. */
const todayKgByPicker = (): Map<string, number> => {
  const byPicker = new Map<string, number>();
  for (const h of harvests) {
    if (h.date !== TODAY) continue;
    byPicker.set(h.picker, (byPicker.get(h.picker) ?? 0) + h.cherriesKg);
  }
  return byPicker;
};

const todayHarvestTotal = (): number =>
  harvests
    .filter((h) => h.date === TODAY)
    .reduce((sum, h) => sum + h.cherriesKg, 0);

describe("seed consistency — today's totals reconcile across surfaces", () => {
  it("every worker's todayKg equals the sum of their own harvests dated today", () => {
    const byPicker = todayKgByPicker();
    for (const w of workers) {
      const harvested = byPicker.get(w.name) ?? 0;
      expect(
        w.todayKg,
        `${w.name} (${w.id}): leaderboard todayKg=${w.todayKg} but ${TODAY} harvest sum=${harvested}`,
      ).toBe(harvested);
    }
  });

  it("sum of all workers' todayKg equals the sum of cherriesKg over today's harvests", () => {
    const workersTotal = workers.reduce((sum, w) => sum + w.todayKg, 0);
    expect(workersTotal).toBe(todayHarvestTotal());
  });

  it("SEASON.todayKg equals the sum of cherriesKg over today's harvests", () => {
    expect(SEASON.todayKg).toBe(todayHarvestTotal());
  });
});
