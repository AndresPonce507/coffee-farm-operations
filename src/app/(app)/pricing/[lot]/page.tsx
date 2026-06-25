import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { TrendLine } from "@/components/charts/trend-line";
import { num, pct, shortDate, usd } from "@/lib/utils";
import { getLotPricing, type LotPricing } from "../data";
import { QuoteComposer } from "./quote-composer.client";

/**
 * /pricing/[lot] — the regime-aware quote composer (P3-S0).
 *
 * Server Component. Resolves the lot's full pricing payload, 404s on an unknown
 * code (the ⌘K palette or a hand-typed URL can route to a lot that doesn't exist —
 * never a fabricated composer). The left rail is the regime STORY, server-rendered:
 *   • commodity → the live "C" sparkline (server SVG via TrendLine) + current "C" +
 *     contract month, the price-against-the-index story;
 *   • reserve   → the score×scarcity×comp build-up + the nearest auction comp, the
 *     priced-on-its-own-merit story — and NEVER a "C"-index anchor (the keystone).
 * The right rail is the one interactive island, <QuoteComposer>, where the human
 * sets kg + the differential/override and accepts.
 */

const perKg = (v: number) => usd(v, v < 100 ? 2 : 0);

export default async function ComposerPage({
  params,
}: {
  params: Promise<{ lot: string }>;
}) {
  const { lot } = await params;
  const lotCode = decodeURIComponent(lot);
  const t = await getTranslations("pricing");

  const pricing = await getLotPricing(lotCode).catch(() => null);
  if (!pricing) {
    notFound();
  }

  const { row } = pricing;
  const isReserve = row.regime === "reserve";

  return (
    <div className="space-y-6">
      {/* back link */}
      <Link
        href="/pricing"
        className="inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted-fg transition-colors hover:text-forest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t("composer.back")}
      </Link>

      {/* header */}
      <div className="animate-rise relative mb-2 pb-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-fg">
          {t("composer.eyebrow")}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
            {t("composer.title", { lot: lotCode })}
          </h1>
          <Badge tone={isReserve ? "forest" : "neutral"} dot>
            {isReserve
              ? t("regime.reserveTag", { variety: row.variety ?? row.scaGrade ?? "—" })
              : t("regime.commodityTag")}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-fg">
          {isReserve ? t("composer.reserveRegime") : t("composer.commodityRegime")}
        </p>
        <p className="mt-1 text-xs tabular-nums text-muted-fg">
          {row.cogsPerKgGreen == null
            ? t("composer.cogsUnknownLine")
            : t("composer.cogsLine", { price: perKg(row.cogsPerKgGreen) })}
        </p>
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        {isReserve ? (
          <ReserveStory pricing={pricing} t={t} />
        ) : (
          <CommodityStory pricing={pricing} t={t} />
        )}
        <QuoteComposer pricing={pricing} />
      </div>
    </div>
  );
}

type PricingT = Awaited<ReturnType<typeof getTranslations<"pricing">>>;

function CommodityStory({ pricing, t }: { pricing: LotPricing; t: PricingT }) {
  const series = pricing.cMarks.map((m) => ({
    label: shortDate(m.asOf),
    value: m.price,
  }));

  return (
    <section data-testid="commodity-story" className="glass-card rounded-2xl p-5">
      <h2 className="font-display text-base font-semibold text-ink">
        {t("commodity.story")}
      </h2>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-fg">
            {t("commodity.currentC")}
          </p>
          <p className="font-display text-2xl font-bold tabular-nums text-ink">
            {pricing.latestCPrice == null
              ? t("commodity.noMark")
              : t("commodity.currentCValue", { price: usd(pricing.latestCPrice, 2) })}
          </p>
        </div>
        {pricing.latestContractMonth && (
          <p className="text-sm font-medium text-muted-fg">
            {t("commodity.contractMonth", { month: pricing.latestContractMonth })}
          </p>
        )}
      </div>

      <div className="mt-4">
        <p className="mb-1 text-xs text-muted-fg">{t("commodity.sparkLabel")}</p>
        <TrendLine data={series} color="#1A6B4D" height={140} />
      </div>
    </section>
  );
}

function ReserveStory({ pricing, t }: { pricing: LotPricing; t: PricingT }) {
  const { row, reserveModel } = pricing;
  const comp = row.nearestComp;

  const premium =
    reserveModel && row.cuppingScore != null
      ? reserveModel.coefficientUsdPerPoint * (row.cuppingScore - reserveModel.scorePivot)
      : null;
  const modeled =
    reserveModel && row.cuppingScore != null
      ? reserveModel.baseUsdPerKg + (premium ?? 0) + reserveModel.scarcityUsdPerKg
      : row.indicativeUnitPrice;

  return (
    <section data-testid="reserve-story" className="glass-card rounded-2xl p-5">
      <h2 className="font-display text-base font-semibold text-ink">
        {t("reserve.story")}
      </h2>

      {reserveModel ? (
        <dl className="mt-3 space-y-2 text-sm">
          <Row label={t("reserve.base")} value={perKg(reserveModel.baseUsdPerKg)} />
          <Row
            label={t("reserve.coefficient")}
            sub={t("reserve.coefficientLine", {
              coef: usd(reserveModel.coefficientUsdPerPoint, 0),
              score: row.cuppingScore == null ? "—" : num(row.cuppingScore, 1),
              pivot: num(reserveModel.scorePivot, 0),
            })}
            value={premium == null ? "—" : perKg(premium)}
          />
          <Row
            label={t("reserve.scarcity")}
            value={perKg(reserveModel.scarcityUsdPerKg)}
          />
          <div className="flex items-baseline justify-between border-t border-line pt-2">
            <dt className="font-medium text-ink">{t("reserve.modeled")}</dt>
            <dd className="font-display text-xl font-bold tabular-nums text-forest">
              {modeled == null ? "—" : perKg(modeled)}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="mt-3 text-sm text-muted-fg">{t("reserve.noModel")}</p>
      )}

      {/* the price story: nearest public auction comp */}
      <div className="mt-4 rounded-xl border border-forest/15 bg-forest/[0.04] px-3 py-3">
        <p className="text-xs uppercase tracking-wide text-forest">
          {t("reserve.comp")}
        </p>
        {comp ? (
          <>
            <p className="mt-1 font-display text-lg font-bold tabular-nums text-ink">
              {t("reserve.compValue", { price: perKg(comp.priceUsdPerKg) })}
            </p>
            <p className="text-xs text-muted-fg">
              {t("reserve.compLine", {
                auction: comp.auctionName,
                variety: comp.variety ?? "—",
                score: comp.cupScore == null ? "—" : num(comp.cupScore, 1),
                year: comp.resultYear ?? "—",
              })}
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted-fg">{t("reserve.noComp")}</p>
        )}
      </div>
    </section>
  );
}

function Row({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-fg">
        {label}
        {sub && <span className="ml-1 text-xs text-muted-fg/80">· {sub}</span>}
      </dt>
      <dd className="tabular-nums text-ink">{value}</dd>
    </div>
  );
}
