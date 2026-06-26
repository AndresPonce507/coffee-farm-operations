import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Award, Coffee, Gauge, Sprout, TrendingUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Tile } from "@/components/ui/tile";
import { kg, num, pct, usd } from "@/lib/utils";
import { getPriceBook, type PriceBookRow } from "./data";

/**
 * /pricing — the price-book board (P3-S0 dual-regime pricing core).
 *
 * Every green lot lands here as a glass card with an UNMISTAKABLE regime badge:
 * forest-green "Reserve · <variety>" for single-origin Presidential/Specialty lots
 * priced on their own merit, neutral "Commodity · C + diff" for everything priced
 * against the ICE "C". Each card shows the live indicative price, the cost-per-kg
 * COGS floor as a watermark, the indicative margin, and remaining ATP. Reserve
 * cards surface the nearest public auction comp as the price story; commodity cards
 * never carry a comp (and a reserve card NEVER carries a C-index anchor — the
 * keystone of the slice, enforced at the database, mirrored here in the UI).
 *
 * Server Component: the whole board reads from the price-book port; the only client
 * JS in this route lives in the per-lot quote composer.
 */

/** Per-kg money: 2 decimals under $100 (reserve $/kg, commodity ~$5), 0 above. */
function price(value: number): string {
  return usd(value, value < 100 ? 2 : 0);
}

/** Indicative margin-on-revenue from the live indicative price + COGS floor. */
function indicativeMargin(row: PriceBookRow): number | null {
  if (
    row.indicativeUnitPrice == null ||
    row.indicativeUnitPrice === 0 ||
    row.cogsPerKgGreen == null
  ) {
    return null;
  }
  return (
    ((row.indicativeUnitPrice - row.cogsPerKgGreen) / row.indicativeUnitPrice) *
    100
  );
}

export default async function PricingPage() {
  const t = await getTranslations("pricing");
  const lots = await getPriceBook();

  const reserveCount = lots.filter((l) => l.regime === "reserve").length;
  const commodityCount = lots.length - reserveCount;
  const totalAtp = lots.reduce((acc, l) => acc + (l.atpKg ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader title={t("page.title")} subtitle={t("page.subtitle")} />

      <div className="glass-card grid grid-cols-2 gap-px overflow-hidden rounded-2xl lg:grid-cols-4">
        <Tile
          label={t("summary.lots")}
          value={num(lots.length)}
          sub={t("summary.lotsSub", { count: lots.length })}
          accent="forest"
          icon={Gauge}
        />
        <Tile
          label={t("summary.reserve")}
          value={num(reserveCount)}
          sub={t("summary.reserveSub")}
          accent="honey"
          icon={Award}
        />
        <Tile
          label={t("summary.commodity")}
          value={num(commodityCount)}
          sub={t("summary.commoditySub")}
          accent="coffee"
          icon={Coffee}
        />
        <Tile
          label={t("summary.atp")}
          value={num(Math.round(totalAtp))}
          sub={t("summary.atpSub")}
          accent="sky"
          icon={TrendingUp}
        />
      </div>

      {lots.length === 0 ? (
        <EmptyState
          icon={Sprout}
          title={t("empty.title")}
          description={t("empty.description")}
        />
      ) : (
        <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {lots.map((lot) => (
            <PriceCard key={lot.greenLotCode} lot={lot} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function PriceCard({
  lot,
  t,
}: {
  lot: PriceBookRow;
  t: Awaited<ReturnType<typeof getTranslations<"pricing">>>;
}) {
  const isReserve = lot.regime === "reserve";
  const margin = indicativeMargin(lot);
  const comp = lot.nearestComp;

  return (
    <Link
      href={`/pricing/${encodeURIComponent(lot.greenLotCode)}`}
      data-testid={`price-card-${lot.greenLotCode}`}
      className="glass-card glass-hover perf-contain block rounded-2xl p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40 focus-visible:ring-offset-2"
    >
      {/* Header: lot code + regime badge */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-base font-semibold text-ink">
            {lot.greenLotCode}
          </p>
          <p className="text-xs text-muted-fg">
            {lot.cuppingScore == null
              ? t("card.noScore")
              : t("card.score", { score: num(lot.cuppingScore, 1) })}
          </p>
        </div>
        <Badge tone={isReserve ? "forest" : "neutral"} dot>
          {isReserve
            ? t("regime.reserveTag", { variety: lot.variety ?? lot.scaGrade ?? "—" })
            : t("regime.commodityTag")}
        </Badge>
      </div>

      {/* Indicative price headline */}
      <div className="mt-4">
        <p className="text-xs uppercase tracking-wide text-muted-fg">
          {t("card.indicative")}
        </p>
        <p className="font-display text-2xl font-bold tabular-nums text-ink">
          {lot.indicativeUnitPrice == null
            ? t("card.priceUnknown")
            : t("card.perKg", { price: price(lot.indicativeUnitPrice) })}
        </p>
      </div>

      {/* Floor watermark + margin */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-paper/70 px-3 py-2">
          <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
            {t("card.cogsFloor")}
          </p>
          <p className="text-sm font-medium tabular-nums text-ink">
            {lot.cogsPerKgGreen == null
              ? t("card.cogsUnknown")
              : t("card.cogsFloorValue", { price: price(lot.cogsPerKgGreen) })}
          </p>
        </div>
        <div className="rounded-xl bg-paper/70 px-3 py-2">
          <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
            {t("card.margin")}
          </p>
          <p className="text-sm font-medium tabular-nums text-ink">
            {margin == null ? t("card.marginUnknown") : pct(margin)}
          </p>
        </div>
      </div>

      {/* Reserve price story — the nearest auction comp. Commodity lots: never. */}
      {isReserve && (
        <div className="mt-4 rounded-xl border border-forest/15 bg-forest/[0.04] px-3 py-2.5">
          {comp ? (
            <>
              <p className="text-xs font-medium text-forest">
                {t("card.compStory", { auction: comp.auctionName })}
                {": "}
                <span className="tabular-nums">
                  {t("card.compStoryValue", { price: price(comp.priceUsdPerKg) })}
                </span>
              </p>
              <p className="mt-0.5 text-[0.6875rem] text-muted-fg">
                {t("card.compStorySub", {
                  variety: comp.variety ?? "—",
                  process: comp.process ?? "—",
                  score: comp.cupScore == null ? "—" : num(comp.cupScore, 1),
                  year: comp.resultYear ?? "—",
                })}
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-fg">{t("card.noComp")}</p>
          )}
        </div>
      )}

      {/* Footer: ATP + open affordance */}
      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs font-medium tabular-nums text-muted-fg">
          {lot.atpKg == null || lot.atpKg <= 0
            ? t("card.atpNone")
            : t("card.atpRemaining", { kg: num(Math.round(lot.atpKg)) })}
        </span>
        <span className="text-xs font-medium text-forest">{t("card.open")} →</span>
      </div>
    </Link>
  );
}
