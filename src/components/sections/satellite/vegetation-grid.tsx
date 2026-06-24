import { CloudOff, Leaf, Mountain, Radar, Satellite } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn, num } from "@/lib/utils";
import type { PlotVegetation } from "@/lib/types";
import { EntityLink } from "@/components/ui/entity-link";

import { confidenceLabel, confidenceNote, confidenceTone } from "./confidence";

/**
 * VegetationGrid — the per-plot satellite vegetation-health grid (P2-S12).
 *
 * Pure Server Component (no client JS): a glass tile per plot showing its fused
 * NDVI/NDRE + SAR value and — the differentiator — an ALWAYS-VISIBLE honest
 * confidence badge. Under Volcán's near-daily cloud an optical-only tool is blind;
 * here a SAR-carried read says "radar · medium" plainly and a no-signal plot says
 * "low confidence", never a faked value behind a blank tile.
 *
 * World-class: glass-lite cards, a value bar with a GPU-only width transition that
 * `motion-reduce` disables, AA contrast on the paper canvas, a responsive grid.
 */
export function VegetationGrid({ rows }: { rows: PlotVegetation[] }) {
  const t = useTranslations("satellite");
  if (rows.length === 0) {
    return (
      <Card data-testid="vegetation-empty" className="animate-rise">
        <CardContent>
          <EmptyState
            icon={Satellite}
            title={t("grid.emptyTitle")}
            description={t("grid.emptyDescription")}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((r) => {
        const tone = confidenceTone(r.confidence);
        const hasValue = r.value !== null;
        const pct = hasValue ? Math.round(Math.min(1, Math.max(0, r.value as number)) * 100) : 0;
        const Icon = r.confidence === "low" ? CloudOff : r.basis === "sar" ? Radar : Satellite;
        return (
          <EntityLink
            key={r.plotId}
            kind="plot"
            id={r.plotId}
            anchor="vegetation"
            className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/60"
          >
          <Card
            data-testid={`veg-${r.plotId}`}
            className="glass-hover animate-rise overflow-hidden transition group-hover:ring-1 group-hover:ring-forest/30"
          >
            <CardContent className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-display text-base font-semibold text-ink">
                    {r.plotName}
                  </h3>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-fg">
                    <span className="inline-flex items-center gap-1">
                      <Leaf className="h-3.5 w-3.5" aria-hidden /> {r.variety}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Mountain className="h-3.5 w-3.5" aria-hidden />
                      {num(r.altitudeMasl)} masl
                    </span>
                  </div>
                </div>
                <Badge tone={tone} className="inline-flex items-center gap-1 whitespace-nowrap">
                  <Icon className="h-3 w-3" aria-hidden />
                  {confidenceLabel(r.confidence, r.basis)}
                </Badge>
              </div>

              {hasValue ? (
                <>
                  <div className="flex items-baseline justify-between">
                    <span className="font-display text-2xl font-bold tabular-nums text-ink">
                      {num(r.value as number, 2)}
                    </span>
                    <span className="text-[11px] font-medium uppercase tracking-wide text-muted-fg">
                      {r.indexKind ?? t("grid.indexFallback")}
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={t("grid.indexAria", { plotName: r.plotName })}
                    className="h-2 w-full overflow-hidden rounded-full bg-ink/5"
                  >
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none",
                        r.confidence === "high" ? "bg-forest" : "bg-honey-500",
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </>
              ) : (
                <p className="rounded-lg border border-white/60 bg-white/50 px-3 py-2 text-xs italic text-muted-fg">
                  {confidenceNote(r.confidence, r.basis)}
                </p>
              )}

              {hasValue ? (
                <p className="text-[11px] text-muted-fg">
                  {confidenceNote(r.confidence, r.basis)}
                  {r.cloudPct !== null
                    ? ` · ${t("grid.cloudSuffix", { pct: num(r.cloudPct) })}`
                    : ""}
                </p>
              ) : null}
            </CardContent>
          </Card>
          </EntityLink>
        );
      })}
    </div>
  );
}
