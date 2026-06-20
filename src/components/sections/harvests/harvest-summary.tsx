import { Coffee, Sprout, Droplets, FlaskConical } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Tile } from "@/components/ui/tile";
import { harvests } from "@/lib/data/harvests";
import { kg, num, pct } from "@/lib/utils";

const TODAY = "2026-06-20";

/** The seven-day window ending today (inclusive), as ISO date strings. */
const LAST_7_DAYS: ReadonlySet<string> = new Set(
  Array.from({ length: 7 }, (_, i) => {
    const d = new Date(TODAY + "T00:00:00");
    d.setDate(d.getDate() - i);
    return d.toISOString().slice(0, 10);
  })
);

/** Sum a numeric field across records, returning 0 for an empty set. */
function sum(records: readonly { cherriesKg: number }[]): number {
  return records.reduce((total, h) => total + h.cherriesKg, 0);
}

/** Mean of a numeric accessor across records, 0 when there are no records. */
function avg(
  records: readonly number[]
): number {
  if (records.length === 0) return 0;
  return records.reduce((total, v) => total + v, 0) / records.length;
}

/**
 * HarvestSummary — a divided strip of four KPI tiles distilled from the daily
 * picking log: today's cherry intake, the trailing seven-day total, average
 * ripeness and average sugar (Brix). Pure server component; all figures are
 * computed deterministically from the {@link harvests} anchor.
 */
export function HarvestSummary() {
  const todayRecords = harvests.filter((h) => h.date === TODAY);
  const weekRecords = harvests.filter((h) => LAST_7_DAYS.has(h.date));

  const todayKg = sum(todayRecords);
  const weekKg = sum(weekRecords);
  const avgRipeness = avg(harvests.map((h) => h.ripenessPct));
  const avgBrix = avg(harvests.map((h) => h.brixAvg));

  return (
    <Card className="overflow-hidden animate-rise perf-contain">
      <div className="stagger grid grid-cols-1 divide-y divide-line/70 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
        <Tile
          label="Today"
          value={kg(todayKg)}
          sub={`${num(todayRecords.length)} lots picked`}
          accent="forest"
          icon={Coffee}
        />
        <Tile
          label="Last 7 days"
          value={kg(weekKg)}
          sub="Trailing-week cherry intake"
          accent="coffee"
          icon={Droplets}
          className="sm:border-l sm:border-line/70 lg:border-l-0"
        />
        <Tile
          label="Avg ripeness"
          value={pct(avgRipeness)}
          sub="Across all logged lots"
          accent="honey"
          icon={Sprout}
        />
        <Tile
          label="Avg Brix"
          value={`${avgBrix.toFixed(1)}°`}
          sub="Sugar content at picking"
          accent="cherry"
          icon={FlaskConical}
          className="sm:border-l sm:border-line/70"
        />
      </div>
    </Card>
  );
}
