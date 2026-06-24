import { getTranslations } from "next-intl/server";

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EntityLink } from "@/components/ui/entity-link";
import { getBatches } from "@/lib/db/processing";
import { kg } from "@/lib/utils";
import type { BatchStage } from "@/lib/types";
import {
  Cherry,
  FlaskConical,
  Sun,
  Layers,
  Cog,
  Sprout,
  ArrowRight,
} from "lucide-react";

type IconType = React.ComponentType<{ className?: string }>;

/** Ordered pipeline definition — i18n key + icon per stage, in flow order. */
const STAGES: { key: BatchStage; icon: IconType }[] = [
  { key: "cherry", icon: Cherry },
  { key: "fermentation", icon: FlaskConical },
  { key: "drying", icon: Sun },
  { key: "parchment", icon: Layers },
  { key: "milled", icon: Cog },
  { key: "green", icon: Sprout },
];

/** Stage rank used to find the batches closest to the "green" finish line. */
const STAGE_RANK: Record<BatchStage, number> = {
  cherry: 0,
  fermentation: 1,
  drying: 2,
  parchment: 3,
  milled: 4,
  green: 5,
};

/**
 * ProcessingPipelineCard — wet-mill → drying → green stepper for the dashboard.
 * Server component (pure render over mock data; no hooks or handlers).
 */
export async function ProcessingPipelineCard() {
  const t = await getTranslations("dashboard");
  const batches = await getBatches();

  // Aggregate batch count + total weight at each stage.
  const byStage = STAGES.map((stage) => {
    const inStage = batches.filter((b) => b.stage === stage.key);
    const totalKg = inStage.reduce((sum, b) => sum + b.currentKg, 0);
    return {
      ...stage,
      label: t(`processing.stage.${stage.key}`),
      count: inStage.length,
      totalKg,
      active: inStage.length > 0,
    };
  });

  const activeStages = byStage.filter((s) => s.active).length;
  const inFlightKg = byStage.reduce((sum, s) => sum + s.totalKg, 0);

  // Two batches closest to green: not yet green, highest stage rank first,
  // then furthest-along progress as the tiebreaker.
  const nearingGreen = [...batches]
    .filter((b) => b.stage !== "green")
    .sort(
      (a, b) =>
        STAGE_RANK[b.stage] - STAGE_RANK[a.stage] ||
        b.progressPct - a.progressPct
    )
    .slice(0, 2);

  const stageLabel = (key: BatchStage): string =>
    STAGES.find((s) => s.key === key) ? t(`processing.stage.${key}`) : key;

  return (
    <Card className="animate-rise">
      <CardHeader>
        <div>
          <CardTitle>{t("processing.title")}</CardTitle>
          <CardDescription>
            {t("processing.description", {
              count: batches.length,
              kg: kg(inFlightKg),
            })}
          </CardDescription>
        </div>
        <Badge tone="forest" dot>
          {t("processing.stagesActive", {
            active: activeStages,
            total: STAGES.length,
          })}
        </Badge>
      </CardHeader>

      <CardContent className="pt-4">
        {/* Horizontal stepper — scrolls on narrow screens, never squashes. */}
        <div className="cv-auto -mx-1 overflow-x-auto pb-1">
          <ol
            className="stagger flex min-w-max items-stretch gap-1 px-1"
            aria-label={t("processing.stagesAriaLabel")}
          >
            {byStage.map((stage, i) => {
              const Icon = stage.icon;
              const isLast = i === byStage.length - 1;
              return (
                <li
                  key={stage.key}
                  className="flex items-center"
                  aria-label={t("processing.stageItemAriaLabel", {
                    label: stage.label,
                    count: stage.count,
                    unit: t(
                      stage.count === 1
                        ? "processing.batchOne"
                        : "processing.batchOther",
                    ),
                    kg: kg(stage.totalKg),
                  })}
                >
                  <div
                    className={[
                      "glass-hover flex w-[112px] flex-col items-center gap-2 rounded-2xl border px-3 py-4 text-center",
                      stage.active
                        ? "border-forest-300/70 bg-forest-100/70"
                        : "border-white/60 bg-white/55",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "flex h-10 w-10 items-center justify-center rounded-full",
                        stage.active
                          ? "bg-forest text-paper shadow-sm shadow-forest/20"
                          : "border border-white/70 bg-white/70 text-muted-fg",
                      ].join(" ")}
                    >
                      <Icon className="h-5 w-5" />
                    </span>

                    <span
                      className={[
                        "font-display text-sm font-semibold",
                        stage.active ? "text-forest" : "text-muted-fg",
                      ].join(" ")}
                    >
                      {stage.label}
                    </span>

                    <span
                      className={[
                        "text-lg font-semibold leading-none tabular-nums",
                        stage.active ? "text-ink" : "text-muted-fg/70",
                      ].join(" ")}
                    >
                      {stage.count}
                    </span>

                    <span className="text-xs tabular-nums text-muted-fg">
                      {stage.active ? kg(stage.totalKg) : "—"}
                    </span>
                  </div>

                  {!isLast && (
                    <span
                      aria-hidden="true"
                      className="flex w-7 items-center justify-center"
                    >
                      <span className="relative flex items-center">
                        <span
                          className={[
                            "h-px w-7",
                            stage.active && byStage[i + 1].active
                              ? "bg-forest-300"
                              : "bg-line-strong",
                          ].join(" ")}
                        />
                        <ArrowRight
                          className={[
                            "absolute -right-1 h-3 w-3",
                            stage.active && byStage[i + 1].active
                              ? "text-forest-300"
                              : "text-muted-fg/50",
                          ].join(" ")}
                        />
                      </span>
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>

        {/* Closest to the finish line. */}
        {nearingGreen.length > 0 && (
          <div className="mt-6 border-t border-line pt-4">
            <p className="font-display text-xs font-semibold uppercase tracking-wide text-muted-fg">
              {t("processing.closestToGreen")}
            </p>
            <ul className="stagger mt-3 space-y-2">
              {nearingGreen.map((batch) => (
                <li key={batch.id}>
                  <EntityLink
                    kind="lot"
                    id={batch.lotCode}
                    className="glass-hover flex items-center justify-between gap-3 rounded-xl border border-white/60 bg-white/55 px-3 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-300"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="font-display text-sm font-semibold text-ink">
                          {batch.lotCode}
                        </span>
                        <span className="truncate text-xs text-muted-fg">
                          {batch.variety} · {batch.method}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-fg">
                        {stageLabel(batch.stage)} · {batch.patio} ·{" "}
                        {kg(batch.currentKg)}
                      </span>
                    </span>
                    <Badge tone="honey">{batch.progressPct}%</Badge>
                  </EntityLink>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
