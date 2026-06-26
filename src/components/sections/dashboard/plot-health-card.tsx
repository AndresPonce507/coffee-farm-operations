import { getTranslations } from "next-intl/server";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { EntityLink } from "@/components/ui/entity-link";
import { getPlots } from "@/lib/db/plots";
import type { Plot, PlotStatus } from "@/lib/types";
import { pct, kg } from "@/lib/utils";

type T = Awaited<ReturnType<typeof getTranslations>>;

/** Status -> Badge tone (problems use warn/danger so they read at a glance). */
const STATUS_TONE: Record<PlotStatus, BadgeTone> = {
  healthy: "ok",
  watch: "warn",
  "at-risk": "danger",
};

/** Status -> i18n key suffix under "plotHealth.status". */
const STATUS_LABEL_KEY: Record<PlotStatus, string> = {
  healthy: "healthy",
  watch: "watch",
  "at-risk": "atRisk",
};

/** Status -> ProgressBar fill tone, so a struggling plot's bar matches its badge. */
const STATUS_BAR_TONE: Record<PlotStatus, "forest" | "honey" | "cherry"> = {
  healthy: "forest",
  watch: "honey",
  "at-risk": "cherry",
};

/** Surface problems first: at-risk, then watch, then healthy. */
const STATUS_ORDER: Record<PlotStatus, number> = {
  "at-risk": 0,
  watch: 1,
  healthy: 2,
};

function PlotHealthRow({ plot, t }: { plot: Plot; t: T }) {
  const progress =
    plot.expectedYieldKg > 0
      ? (plot.harvestedKg / plot.expectedYieldKg) * 100
      : 0;

  return (
    <li>
      <EntityLink
        kind="plot"
        id={plot.id}
        className="glass-hover -mx-2 flex items-center gap-4 rounded-xl px-2 py-3.5 transition-colors hover:bg-white/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-300"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-sm font-medium text-ink">{plot.name}</p>
            <Badge tone={STATUS_TONE[plot.status]} dot>
              {t(`plotHealth.status.${STATUS_LABEL_KEY[plot.status]}`)}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-fg">{plot.variety}</p>
          <div className="mt-2.5 flex items-center gap-3">
            <ProgressBar
              value={progress}
              tone={STATUS_BAR_TONE[plot.status]}
              className="flex-1"
            />
            <span className="w-9 shrink-0 text-right text-xs font-semibold tabular-nums text-ink">
              {pct(progress)}
            </span>
          </div>
          <p className="mt-1.5 text-xs text-muted-fg">
            {kg(plot.harvestedKg)}{" "}
            <span className="text-muted-fg/70">
              {t("plotHealth.ofExpected", { kg: kg(plot.expectedYieldKg) })}
            </span>
          </p>
        </div>
      </EntityLink>
    </li>
  );
}

/**
 * PlotHealthCard — dashboard at-a-glance of growing lots, problems first.
 * Lists ~6 plots with status badge and a harvested/expected progress bar.
 */
export async function PlotHealthCard() {
  const t = await getTranslations("dashboard");
  const plots = await getPlots();

  const ranked = [...plots]
    .sort((a, b) => {
      const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (byStatus !== 0) return byStatus;
      // Within a status band, least-harvested (relative to target) bubbles up.
      const aProg = a.expectedYieldKg > 0 ? a.harvestedKg / a.expectedYieldKg : 0;
      const bProg = b.expectedYieldKg > 0 ? b.harvestedKg / b.expectedYieldKg : 0;
      return aProg - bProg;
    })
    .slice(0, 6);

  return (
    <Card className="animate-rise">
      <CardHeader>
        <CardTitle>{t("plotHealth.title")}</CardTitle>
        <a
          href="/plots"
          className="rounded text-xs font-medium text-muted-fg transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-300"
        >
          {t("plotHealth.viewAll")}
        </a>
      </CardHeader>
      <CardContent>
        <ul className="stagger divide-y divide-line/70">
          {ranked.map((plot) => (
            <PlotHealthRow key={plot.id} plot={plot} t={t} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
