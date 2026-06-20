import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { plots } from "@/lib/data/plots";
import type { Plot, PlotStatus } from "@/lib/types";
import { pct, kg } from "@/lib/utils";

/** Status -> Badge tone (problems use warn/danger so they read at a glance). */
const STATUS_TONE: Record<PlotStatus, BadgeTone> = {
  healthy: "ok",
  watch: "warn",
  "at-risk": "danger",
};

/** Status -> human label. */
const STATUS_LABEL: Record<PlotStatus, string> = {
  healthy: "Healthy",
  watch: "Watch",
  "at-risk": "At risk",
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

function PlotHealthRow({ plot }: { plot: Plot }) {
  const progress =
    plot.expectedYieldKg > 0
      ? (plot.harvestedKg / plot.expectedYieldKg) * 100
      : 0;

  return (
    <li className="flex items-center gap-4 py-3.5 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <p className="truncate text-sm font-medium text-ink">{plot.name}</p>
          <Badge tone={STATUS_TONE[plot.status]} dot>
            {STATUS_LABEL[plot.status]}
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
            of {kg(plot.expectedYieldKg)}
          </span>
        </p>
      </div>
    </li>
  );
}

/**
 * PlotHealthCard — dashboard at-a-glance of growing lots, problems first.
 * Lists ~6 plots with status badge and a harvested/expected progress bar.
 */
export function PlotHealthCard() {
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
        <CardTitle>Plot health</CardTitle>
        <a
          href="/plots"
          className="text-xs font-medium text-muted-fg transition-colors hover:text-ink"
        >
          View all
        </a>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-line">
          {ranked.map((plot) => (
            <PlotHealthRow key={plot.id} plot={plot} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
