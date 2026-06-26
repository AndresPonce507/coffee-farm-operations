import { getTranslations } from "next-intl/server";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendLine } from "@/components/charts/trend-line";
import { getDailyCherries } from "@/lib/db/trends";
import { num } from "@/lib/utils";

/** Forest-500 — the signature line color for daily cherry intake. */
const LINE_COLOR = "#1A6B4D";

/**
 * YieldTrendCard — dashboard card charting the last 14 days of daily cherry
 * intake (kg) as a forest-green area/line trend, with the period total and a
 * computed average per day surfaced in the header.
 *
 * Server component: pure presentation, no hooks or handlers.
 */
export async function YieldTrendCard() {
  const t = await getTranslations("dashboard");
  const dailyCherries = await getDailyCherries();

  const days = dailyCherries.length;
  const totalKg = dailyCherries.reduce((sum, point) => sum + point.value, 0);
  const avgPerDay = days > 0 ? Math.round(totalKg / days) : 0;

  return (
    <Card className="animate-rise glass-hover">
      <CardHeader>
        <div>
          <CardTitle>{t("yieldTrend.title")}</CardTitle>
          <p className="mt-0.5 text-sm text-muted-fg">{t("yieldTrend.caption")}</p>
        </div>
        <div className="text-right">
          <p className="font-display text-2xl font-semibold leading-none text-ink">
            {num(totalKg)}
            <span className="ml-1 text-sm font-normal text-muted-fg">kg</span>
          </p>
          <p className="mt-1 text-xs text-muted-fg">{t("yieldTrend.avgPerDay", { kg: num(avgPerDay) })}</p>
        </div>
      </CardHeader>
      <CardContent>
        <div className="pt-1">
          <TrendLine data={dailyCherries} color={LINE_COLOR} height={200} />
        </div>
      </CardContent>
    </Card>
  );
}
