import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { BarMini } from "@/components/charts/bar-mini";
import { harvests } from "@/lib/data/harvests";
import { kg, shortDate } from "@/lib/utils";

/** Coffee brown — signature brand color for the harvest bars. */
const BAR_COLOR = "#45361F";

/** How many trailing days of harvest to chart. */
const DAYS = 8;

interface DailyTotal {
  /** ISO date key, used only for sorting/aggregation. */
  date: string;
  /** Short display label, e.g. "Jun 18". */
  label: string;
  /** Total cherries picked that day, in kilograms. */
  value: number;
}

/**
 * Aggregate harvest records into per-day cherry totals, keep the most recent
 * {@link DAYS} days, and return them in chronological (oldest → newest) order.
 */
function dailyTotals(): DailyTotal[] {
  const byDate = new Map<string, number>();
  for (const h of harvests) {
    byDate.set(h.date, (byDate.get(h.date) ?? 0) + h.cherriesKg);
  }

  return Array.from(byDate.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) // chronological
    .slice(-DAYS) // last ~8 days
    .map(([date, value]) => ({ date, label: shortDate(date), value }));
}

/**
 * "Daily harvest (kg)" — a compact bar chart of cherries picked per day across
 * the last eight harvest days, with the farm's best day called out in the header.
 */
export function HarvestTrendCard() {
  const days = dailyTotals();
  const best = days.reduce<DailyTotal | null>(
    (top, d) => (top === null || d.value > top.value ? d : top),
    null
  );

  return (
    <Card className="animate-rise">
      <CardHeader>
        <CardTitle>Daily harvest (kg)</CardTitle>
        {best ? (
          <div className="text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-fg">
              Best day
            </p>
            <p className="font-display text-sm font-semibold text-coffee">
              {best.label} · {kg(best.value)}
            </p>
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        {days.length > 0 ? (
          <BarMini data={days} color={BAR_COLOR} height={156} />
        ) : (
          <p className="py-8 text-center text-sm text-muted-fg">
            No harvest recorded yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
