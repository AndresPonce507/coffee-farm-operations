import { getTranslations } from "next-intl/server";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Donut, type DonutDatum } from "@/components/charts/donut";
import { CHART_COLORS } from "@/lib/brand";
import { getVarietyShares } from "@/lib/db/trends";
import { kg, num } from "@/lib/utils";

/**
 * Format a kilogram total into a compact "122k" style label for the donut
 * center. Falls back to the plain thousands-separated number under 1,000.
 */
function shortKg(value: number): string {
  if (value >= 1000) {
    const thousands = value / 1000;
    // One decimal only when it adds signal (e.g. 1.4k), none for round values.
    const rounded = Math.round(thousands * 10) / 10;
    const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    return `${text}k`;
  }
  return num(value);
}

export async function VarietyMixCard() {
  const t = await getTranslations("dashboard");
  const varietyShares = await getVarietyShares();

  const totalKg = varietyShares.reduce((sum, v) => sum + v.kg, 0);

  // Assign a brand chart color per variety by index, wrapping if the data ever
  // outgrows the palette so colors never come back undefined.
  const rows = varietyShares.map((v, i) => {
    const color = CHART_COLORS[i % CHART_COLORS.length];
    const share = totalKg > 0 ? (v.kg / totalKg) * 100 : 0;
    return { variety: v.variety, kg: v.kg, color, share };
  });

  const donutData: DonutDatum[] = rows.map((r) => ({
    label: r.variety,
    value: r.kg,
    color: r.color,
  }));

  return (
    <Card className="glass-hover animate-rise">
      <CardHeader>
        <CardTitle>{t("varietyMix.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center gap-7 sm:flex-row sm:items-center sm:gap-8">
          <Donut
            data={donutData}
            size={176}
            thickness={24}
            centerLabel={shortKg(totalKg)}
            centerSub={t("varietyMix.centerSub")}
            className="shrink-0"
          />

          <ul className="w-full min-w-0 space-y-2.5">
            {rows.map((r) => (
              <li
                key={r.variety}
                className="flex items-center gap-3 rounded-xl px-2 py-1 transition-colors duration-200 hover:bg-white/55"
              >
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: r.color }}
                />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                  {r.variety}
                </span>
                <span className="shrink-0 text-sm tabular-nums text-muted-fg">
                  {kg(r.kg)}
                </span>
                <span className="w-11 shrink-0 text-right text-sm font-semibold tabular-nums text-ink">
                  {Math.round(r.share)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
