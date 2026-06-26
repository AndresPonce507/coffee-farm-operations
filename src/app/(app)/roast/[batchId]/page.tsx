import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  ArrowLeft,
  Coffee,
  Flag,
  FileText,
  Sprout,
  Tag,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Tile } from "@/components/ui/tile";
import { num, shortDate, usd } from "@/lib/utils";
import {
  getRoastBatchDetail,
  type RoastBatchDetail,
  type RoastCurvePoint,
} from "../data";
import { RoastFinalize } from "./roast-finalize.client";

/**
 * /roast/[batchId] — the roast batch detail (P3-S10).
 *
 * Server Component. Resolves one roast batch, 404s on an unknown / non-numeric id
 * (never a fabricated batch). It tells the roast-vs-golden story: the captured bean
 * curve overlaid on the golden target ramp, the phase markers (charge → first crack →
 * drop), the .alog import receipts, and the linked bag SKUs. The one interactive
 * surface is the <RoastFinalize> island (import / finalize / link). NULLs stay NULL —
 * a pending shrinkage / un-priced SKU reads honestly, never a confident fabricated 0.
 */

type RoastT = Awaited<ReturnType<typeof getTranslations<"roast">>>;

export default async function RoastBatchPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const { batchId } = await params;
  const id = Number(batchId);
  if (!Number.isInteger(id) || id <= 0) {
    notFound();
  }

  const detail = await getRoastBatchDetail(id).catch(() => null);
  if (!detail) {
    notFound();
  }

  const t = await getTranslations("roast");
  const { batch } = detail;
  const isFinalized = batch.status === "finalized";

  return (
    <div className="space-y-6">
      <Link
        href="/roast"
        className="inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted-fg transition-colors hover:text-forest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t("detail.back")}
      </Link>

      {/* header */}
      <div className="animate-rise relative mb-2 pb-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-fg">
          {t("detail.eyebrow")}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
            {t("detail.title", { id: num(batch.roastBatchId) })}
          </h1>
          <Badge tone={isFinalized ? "forest" : "sky"} dot>
            {isFinalized ? t("batchStatus.finalized") : t("batchStatus.open")}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-fg">
          {t("detail.from", { lot: batch.greenLotCode })}
          {batch.roastedLotCode
            ? ` ${t("detail.roastedLot", { lot: batch.roastedLotCode })}`
            : ""}
          {" · "}
          {t("detail.profileLine", {
            name: batch.profileName,
            version: num(batch.profileVersion),
            level: t(`roastLevel.${batch.roastLevel}`),
          })}
        </p>
        <p className="mt-0.5 text-xs text-muted-fg">{t("detail.cogsLine")}</p>
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent"
        />
      </div>

      {/* KPI strip */}
      <div className="glass-card grid grid-cols-2 gap-px overflow-hidden rounded-2xl lg:grid-cols-4">
        <Tile
          label={t("detail.greenIn")}
          value={t("detail.kgValue", { kg: num(batch.greenInKg) })}
          accent="coffee"
          icon={Coffee}
        />
        <Tile
          label={t("detail.roastedOut")}
          value={
            batch.roastedKgOut == null
              ? t("detail.pending")
              : t("detail.kgValue", { kg: num(batch.roastedKgOut) })
          }
          accent="forest"
          icon={Sprout}
        />
        <Tile
          label={t("detail.shrinkage")}
          value={
            batch.shrinkagePct == null
              ? t("detail.pending")
              : t("detail.pctValue", {
                  pct: num(Math.round(batch.shrinkagePct * 100)),
                })
          }
          accent="honey"
          icon={Flag}
        />
        <Tile
          label={t("detail.eyebrow")}
          value={isFinalized ? t("batchStatus.finalized") : t("batchStatus.open")}
          accent={isFinalized ? "forest" : "sky"}
          icon={Tag}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <CurveCard detail={detail} t={t} />
          <EventsCard detail={detail} t={t} />
          <ImportsCard detail={detail} t={t} />
          <SkusCard detail={detail} t={t} />
        </div>

        <RoastFinalize
          batchId={batch.roastBatchId}
          status={batch.status}
          greenInKg={batch.greenInKg}
        />
      </div>
    </div>
  );
}

/* ───────────────────────────── curve overlay ───────────────────────────── */

function CurveCard({ detail, t }: { detail: RoastBatchDetail; t: RoastT }) {
  const { curvePoints, profileTargets } = detail;
  return (
    <section className="glass-card rounded-2xl p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-base font-semibold text-ink">
          {t("curve.title")}
        </h2>
        <p className="text-xs text-muted-fg">{t("curve.subtitle")}</p>
      </div>

      {curvePoints.length === 0 ? (
        <p className="mt-4 text-sm text-muted-fg">{t("curve.empty")}</p>
      ) : (
        <>
          <CurveChart
            points={curvePoints}
            totalTimeS={profileTargets.totalTimeS}
            ariaLabel={t("curve.title")}
          />
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-fg">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-3 rounded-full bg-cherry" aria-hidden />
              {t("curve.bt")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full bg-forest" aria-hidden />
              {t("curve.target")}
            </span>
          </div>
        </>
      )}
    </section>
  );
}

function CurveChart({
  points,
  totalTimeS,
  ariaLabel,
}: {
  points: RoastCurvePoint[];
  totalTimeS: number;
  ariaLabel: string;
}) {
  const W = 320;
  const H = 120;
  const temps = points
    .map((p) => p.beanTempC)
    .filter((v): v is number => v != null);
  const maxT = Math.max(totalTimeS, ...points.map((p) => p.tSeconds), 1);
  const minTemp = Math.min(...temps, 0);
  const maxTemp = Math.max(...temps, 1);
  const span = maxTemp - minTemp || 1;

  const x = (s: number) => (s / maxT) * W;
  const y = (temp: number) => H - ((temp - minTemp) / span) * H;

  const path = points
    .filter((p) => p.beanTempC != null)
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.tSeconds).toFixed(1)} ${y(p.beanTempC as number).toFixed(1)}`)
    .join(" ");

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${W} ${H}`}
      className="mt-4 h-32 w-full"
    >
      <path
        d={path}
        fill="none"
        stroke="var(--color-cherry, #b3261e)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ───────────────────────────── phase markers ───────────────────────────── */

function EventsCard({ detail, t }: { detail: RoastBatchDetail; t: RoastT }) {
  const { events } = detail;
  return (
    <section className="glass-card rounded-2xl p-5">
      <h2 className="font-display text-base font-semibold text-ink">
        {t("events.title")}
      </h2>

      {events.length === 0 ? (
        <p className="mt-3 text-sm text-muted-fg">{t("events.empty")}</p>
      ) : (
        <ol data-testid="roast-events" className="mt-4 space-y-2">
          {events.map((e, i) => (
            <li
              key={`${e.marker}-${i}`}
              className="flex items-center justify-between gap-3 rounded-xl bg-paper/70 px-3 py-2"
            >
              <span className="flex items-center gap-2 text-sm text-ink">
                <Flag className="h-3.5 w-3.5 text-forest" aria-hidden />
                {e.marker}
              </span>
              <span className="text-xs tabular-nums text-muted-fg">
                {t("events.timeValue", { time: `${num(e.tSeconds)}s` })}
                {e.tempC != null && (
                  <>
                    {" · "}
                    {t("events.tempValue", { temp: num(e.tempC) })}
                  </>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/* ───────────────────────────── .alog imports ───────────────────────────── */

function ImportsCard({ detail, t }: { detail: RoastBatchDetail; t: RoastT }) {
  const { imports } = detail;
  return (
    <section className="glass-card rounded-2xl p-5">
      <h2 className="font-display text-base font-semibold text-ink">
        {t("imports.title")}
      </h2>

      {imports.length === 0 ? (
        <p className="mt-3 text-sm text-muted-fg">{t("imports.empty")}</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {imports.map((imp, i) => (
            <li
              key={`${imp.sourceFilename ?? "alog"}-${i}`}
              className="flex items-center justify-between gap-3 rounded-xl bg-paper/70 px-3 py-2"
            >
              <span className="flex min-w-0 items-center gap-2 text-sm text-ink">
                <FileText className="h-3.5 w-3.5 shrink-0 text-coffee" aria-hidden />
                <span className="truncate">
                  {imp.sourceFilename ?? t("imports.noFile")}
                </span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-muted-fg">
                {imp.maxDeviationC == null
                  ? t("imports.noDeviation")
                  : t("imports.deviationValue", { c: num(imp.maxDeviationC, 1) })}
                {" · "}
                {t("imports.points", { count: num(imp.pointCount) })}
                {" · "}
                {shortDate(imp.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ───────────────────────────── linked SKUs ───────────────────────────── */

function SkusCard({ detail, t }: { detail: RoastBatchDetail; t: RoastT }) {
  const { skus } = detail;
  return (
    <section className="glass-card rounded-2xl p-5">
      <h2 className="font-display text-base font-semibold text-ink">
        {t("skus.title")}
      </h2>

      {skus.length === 0 ? (
        <div className="mt-3">
          <EmptyState icon={Tag} title={t("skus.empty")} />
        </div>
      ) : (
        <ul data-testid="roast-skus" className="mt-4 space-y-2">
          {skus.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-3 rounded-xl bg-paper/70 px-3 py-2"
            >
              <span className="flex items-center gap-2 text-sm font-medium text-ink">
                <Tag className="h-3.5 w-3.5 text-forest" aria-hidden />
                {s.skuCode}
                {!s.isActive && (
                  <Badge tone="neutral">{t("skus.inactive")}</Badge>
                )}
              </span>
              <span className="text-xs tabular-nums text-muted-fg">
                {t("skus.bagValue", { g: num(s.bagSizeG) })}
                {" · "}
                {s.priceUsdCents == null
                  ? t("skus.noPrice")
                  : t("skus.priceValue", { price: usd(s.priceUsdCents / 100, 2) })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
