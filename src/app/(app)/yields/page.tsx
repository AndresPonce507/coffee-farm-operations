import { getTranslations } from "next-intl/server";
import {
  Cog,
  Flame,
  Layers,
  Recycle,
  Sprout,
} from "lucide-react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Tile, type TileAccent } from "@/components/ui/tile";
import { num, pct } from "@/lib/utils";
import {
  cherryToGreenFactor,
  classifyYield,
  factorFor,
  getYieldCurve,
  type YieldKind,
  type YieldStageRow,
} from "./data";
import { YieldCalculator } from "./yield-calculator.client";

/**
 * /yields — the house yield-reference board (P3-S6 lot-graph prereq).
 *
 * P3-S6 is a schema-prereq slice: it widens `lot_edges.kind` to admit the three new
 * mass-conserved transforms ('mill','roast','byproduct'), adds the milling/roasting
 * enums the downstream runs declare columns against, and seeds two real transform
 * factors into `lot_yield_curve` (parchment→green dry-mill outturn 0.80, green→roasted
 * roast shrinkage 0.84). It introduces NO table/view/RPC and NO write door — so this
 * surface is strictly READ-ONLY: every house factor as a glass card, the two new
 * transform factors as headline KPIs, a legend explaining the new lot-graph edges, and
 * a no-write planning calculator. The runs that actually POST mass land in P3-S7..S10.
 *
 * Server Component: the whole board reads from the co-located yield-curve port; the
 * only client JS in this route is the projection calculator (which never writes).
 */

const KIND_BADGE: Record<YieldKind, BadgeTone> = {
  process: "neutral",
  mill: "forest",
  roast: "coffee",
};

const KIND_ICON: Record<YieldKind, React.ComponentType<{ className?: string }>> = {
  process: Sprout,
  mill: Cog,
  roast: Flame,
};

export default async function YieldsPage() {
  const t = await getTranslations("yields");
  const rows = await getYieldCurve();

  const millOutturn = factorFor(rows, "parchment", "green");
  const roastShrinkage = factorFor(rows, "green", "roasted");
  const cherryToGreen = cherryToGreenFactor(rows);

  const stageLabel = (stage: string): string =>
    t.has(`stage.${stage}`)
      ? t(`stage.${stage}`)
      : stage.charAt(0).toUpperCase() + stage.slice(1);

  return (
    <div className="space-y-6">
      <PageHeader title={t("page.title")} subtitle={t("page.subtitle")} />

      {/* Headline KPIs — the two NEW transform factors lead, framed by the chain. */}
      <div className="glass-card grid grid-cols-2 gap-px overflow-hidden rounded-2xl lg:grid-cols-4">
        <div data-testid="kpi-stages">
          <Tile
            label={t("summary.stages")}
            value={num(rows.length)}
            sub={t("summary.stagesSub", { count: rows.length })}
            accent="ink"
            icon={Layers}
          />
        </div>
        <div data-testid="kpi-mill-outturn">
          <Tile
            label={t("summary.millOutturn")}
            value={
              millOutturn == null
                ? t("summary.millOutturnNone")
                : pct(millOutturn * 100)
            }
            sub={t("summary.millOutturnSub")}
            accent="forest"
            icon={Cog}
          />
        </div>
        <div data-testid="kpi-roast-shrinkage">
          <Tile
            label={t("summary.roastShrinkage")}
            value={
              roastShrinkage == null
                ? t("summary.roastShrinkageNone")
                : pct((1 - roastShrinkage) * 100)
            }
            sub={t("summary.roastShrinkageSub")}
            accent="coffee"
            icon={Flame}
          />
        </div>
        <div data-testid="kpi-cherry-green">
          <Tile
            label={t("summary.cherryToGreen")}
            value={
              cherryToGreen == null
                ? t("summary.cherryToGreenNone")
                : pct(cherryToGreen * 100)
            }
            sub={t("summary.cherryToGreenSub")}
            accent="honey"
            icon={Sprout}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Sprout}
          title={t("empty.title")}
          description={t("empty.description")}
        />
      ) : (
        <>
          <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((row) => (
              <YieldCard
                key={`${row.fromStage}-${row.toStage}`}
                row={row}
                stageLabel={stageLabel}
                t={t}
              />
            ))}
          </div>

          {/* The calculator only appears once both transform factors are seeded —
              it never fabricates a missing factor. */}
          {millOutturn != null && roastShrinkage != null && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <YieldCalculator
                millOutturn={millOutturn}
                roastShrinkage={roastShrinkage}
              />
              <TransformLegend t={t} />
            </div>
          )}
          {(millOutturn == null || roastShrinkage == null) && (
            <TransformLegend t={t} />
          )}
        </>
      )}
    </div>
  );
}

function YieldCard({
  row,
  stageLabel,
  t,
}: {
  row: YieldStageRow;
  stageLabel: (stage: string) => string;
  t: Awaited<ReturnType<typeof getTranslations<"yields">>>;
}) {
  const kind = classifyYield(row.fromStage, row.toStage);
  const Icon = KIND_ICON[kind];
  const retained = row.yieldFactor * 100;
  const lost = (1 - row.yieldFactor) * 100;

  return (
    <div
      data-testid={`yield-card-${row.fromStage}-${row.toStage}`}
      className="glass-card glass-hover perf-contain rounded-2xl p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-base font-semibold text-ink">
            {t("card.flow", {
              from: stageLabel(row.fromStage),
              to: stageLabel(row.toStage),
            })}
          </p>
          <p className="text-xs text-muted-fg">
            {t("card.factor", { factor: num(row.yieldFactor, 2) })}
          </p>
        </div>
        <Badge tone={KIND_BADGE[kind]} dot>
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {t(`kind.${kind}`)}
        </Badge>
      </div>

      {/* Retained headline + survival bar */}
      <div className="mt-4">
        <p className="font-display text-3xl font-bold tabular-nums text-ink">
          {pct(retained)}
        </p>
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-line"
          role="presentation"
        >
          <div
            className="h-full rounded-full bg-forest/70"
            style={{ width: `${Math.min(100, Math.max(0, retained))}%` }}
          />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="font-medium text-forest">
          {t("card.retained", { pct: pct(retained) })}
        </span>
        <span className="text-muted-fg">
          {t("card.lost", { pct: pct(lost) })}
        </span>
      </div>
    </div>
  );
}

function TransformLegend({
  t,
}: {
  t: Awaited<ReturnType<typeof getTranslations<"yields">>>;
}) {
  const items: Array<{
    icon: React.ComponentType<{ className?: string }>;
    titleKey: string;
    bodyKey: string;
    accent: TileAccent;
  }> = [
    { icon: Cog, titleKey: "legend.millTitle", bodyKey: "legend.mill", accent: "forest" },
    { icon: Flame, titleKey: "legend.roastTitle", bodyKey: "legend.roast", accent: "coffee" },
    {
      icon: Recycle,
      titleKey: "legend.byproductTitle",
      bodyKey: "legend.byproduct",
      accent: "honey",
    },
  ];
  const chip: Record<TileAccent, string> = {
    ink: "bg-muted/70 text-ink",
    forest: "bg-forest-100/70 text-forest",
    honey: "bg-honey-100/70 text-honey-700",
    cherry: "bg-cherry-100/70 text-cherry",
    coffee: "bg-coffee-200/40 text-coffee",
    sky: "bg-sky-100/70 text-sky",
  };

  return (
    <section className="glass-card perf-contain rounded-2xl p-5">
      <h2 className="font-display text-base font-semibold text-ink">
        {t("legend.title")}
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-fg">
        {t("legend.subtitle")}
      </p>
      <ul className="mt-4 space-y-3">
        {items.map(({ icon: Icon, titleKey, bodyKey, accent }) => (
          <li key={titleKey} className="flex gap-3">
            <span
              className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-white/50 shadow-sm ${chip[accent]}`}
            >
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">{t(titleKey)}</p>
              <p className="text-xs leading-relaxed text-muted-fg">{t(bodyKey)}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
