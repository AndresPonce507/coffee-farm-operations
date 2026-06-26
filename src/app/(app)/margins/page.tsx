import { getTranslations } from "next-intl/server";
import { ArrowLeftRight, Coins, Layers, Scale, Sprout, TrendingUp } from "lucide-react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Tile } from "@/components/ui/tile";
import { num, usd } from "@/lib/utils";
import { getFxRates, getLotMargins, type FxRate, type LotMargin } from "./data";
import { RecordFxRateButton } from "./fx-rate-form.client";

/**
 * /margins — the books' loop-closer (P3-S16 accounting spine).
 *
 * Phase-1 costing gave the TRUE cost-per-kg-green; this page gives the other half:
 * the REALIZED margin-per-kg-green per lot (revenue_entry ⨝ mv_lot_cost via
 * `v_lot_margin`) — the single number the farm actually turns on. Each lot lands as a
 * glass card whose headline is its $/kg-green margin, with revenue and cost floors as
 * watermarks. The keystone: a lot whose cost is NOT yet booked shows "cost pending"
 * and NEVER a fabricated margin (NULL ⇒ flagged, rail §5). Below the board sits the
 * canonical FX rate book — one place a rate lives (rail §6) — with the human-confirmed
 * "record FX rate" door (the no-cost fallback to the free ECB feed; not a money-shaped
 * inventory write, just a reference figure).
 *
 * Server Component: the whole board + book read from the co-located accounting port;
 * the only client JS is the FX-rate write island in the header.
 */

/** Per-kg money: 2 decimals under $100 (reserve $/kg), 0 above. Signed for losses. */
function perKg(value: number): string {
  return usd(value, Math.abs(value) < 100 ? 2 : 0);
}

export default async function MarginsPage() {
  const t = await getTranslations("margins");
  const [lots, rates] = await Promise.all([getLotMargins(), getFxRates()]);

  const realized = lots.filter((l) => l.marginUsd != null);
  const pendingCount = lots.length - realized.length;
  const totalRevenue = lots.reduce((acc, l) => acc + (l.revenueUsd ?? 0), 0);
  const totalMargin = realized.reduce((acc, l) => acc + (l.marginUsd ?? 0), 0);

  const marginPerKgValues = lots
    .map((l) => l.marginPerKgGreen)
    .filter((v): v is number => v != null);
  const avgMarginPerKg =
    marginPerKgValues.length === 0
      ? null
      : marginPerKgValues.reduce((a, b) => a + b, 0) / marginPerKgValues.length;

  return (
    <div className="space-y-6">
      <PageHeader title={t("page.title")} subtitle={t("page.subtitle")}>
        <RecordFxRateButton />
      </PageHeader>

      <div className="glass-card grid grid-cols-2 gap-px overflow-hidden rounded-2xl lg:grid-cols-4">
        <Tile
          label={t("summary.revenue")}
          value={usd(totalRevenue)}
          sub={t("summary.revenueSub", { count: lots.length })}
          accent="forest"
          icon={Coins}
        />
        <Tile
          label={t("summary.margin")}
          value={usd(totalMargin)}
          sub={t("summary.marginSub")}
          accent="honey"
          icon={TrendingUp}
        />
        <Tile
          label={t("summary.avgMargin")}
          value={avgMarginPerKg == null ? t("summary.avgMarginNone") : perKg(avgMarginPerKg)}
          sub={t("summary.avgMarginSub")}
          accent="coffee"
          icon={Scale}
        />
        <Tile
          label={t("summary.lots")}
          value={num(realized.length)}
          sub={t("summary.lotsSub", { pending: pendingCount })}
          accent="sky"
          icon={Layers}
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
            <MarginCard key={lot.greenLotCode} lot={lot} t={t} />
          ))}
        </div>
      )}

      <FxRateBook rates={rates} t={t} />
    </div>
  );
}

function MarginCard({
  lot,
  t,
}: {
  lot: LotMargin;
  t: Awaited<ReturnType<typeof getTranslations<"margins">>>;
}) {
  const pending = lot.marginPerKgGreen == null;
  const belowCost = !pending && (lot.marginPerKgGreen as number) < 0;

  const tone: BadgeTone = pending ? "neutral" : belowCost ? "danger" : "forest";
  const badgeLabel = pending
    ? t("card.marginPending")
    : belowCost
      ? t("card.belowCost")
      : t("card.marginTag");
  const marginColor = pending
    ? "text-muted-fg"
    : belowCost
      ? "text-cherry"
      : "text-forest";

  return (
    <div
      data-testid={`margin-card-${lot.greenLotCode}`}
      className="glass-card glass-hover perf-contain rounded-2xl p-5"
    >
      {/* Header: lot code + variety, with the margin-state badge. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-base font-semibold text-ink">
            {lot.greenLotCode}
          </p>
          <p className="truncate text-xs text-muted-fg">
            {lot.variety ? t("card.variety", { variety: lot.variety }) : t("card.noVariety")}
          </p>
        </div>
        <Badge tone={tone} dot>
          {badgeLabel}
        </Badge>
      </div>

      {/* Headline: the realized $/kg-green margin — or "awaiting cost", never faked. */}
      <div className="mt-4">
        <p className="text-xs uppercase tracking-wide text-muted-fg">
          {t("card.marginPerKg")}
        </p>
        <p className={`font-display text-2xl font-bold tabular-nums ${marginColor}`}>
          {pending
            ? t("card.awaitingCost")
            : t("card.perKg", { value: perKg(lot.marginPerKgGreen as number) })}
        </p>
      </div>

      {/* Watermarks: revenue + cost per kg-green. */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-paper/70 px-3 py-2">
          <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
            {t("card.revenuePerKg")}
          </p>
          <p className="text-sm font-medium tabular-nums text-ink">
            {lot.revenuePerKgGreen == null
              ? t("card.notBooked")
              : t("card.perKg", { value: perKg(lot.revenuePerKgGreen) })}
          </p>
        </div>
        <div className="rounded-xl bg-paper/70 px-3 py-2">
          <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
            {t("card.costPerKg")}
          </p>
          <p className="text-sm font-medium tabular-nums text-ink">
            {lot.costPerKgGreen == null
              ? t("card.notBooked")
              : t("card.perKg", { value: perKg(lot.costPerKgGreen) })}
          </p>
        </div>
      </div>

      {/* Cost-pending callout — the honest "we don't know the margin yet" panel. */}
      {pending && (
        <div className="mt-4 rounded-xl border border-honey-300/40 bg-honey-100/40 px-3 py-2.5">
          <p className="text-xs font-medium text-honey-700">
            {t("card.marginPendingNote")}
          </p>
        </div>
      )}

      {/* Footer: total margin + green volume. */}
      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-fg">
          {t("card.marginUsd")}:{" "}
          <span className={`tabular-nums ${pending ? "text-muted-fg" : marginColor}`}>
            {lot.marginUsd == null ? t("card.notBooked") : usd(lot.marginUsd)}
          </span>
        </span>
        {lot.greenKg != null && (
          <span className="text-xs font-medium tabular-nums text-muted-fg">
            {t("card.greenKg", { kg: num(Math.round(lot.greenKg)) })}
          </span>
        )}
      </div>
    </div>
  );
}

function FxRateBook({
  rates,
  t,
}: {
  rates: FxRate[];
  t: Awaited<ReturnType<typeof getTranslations<"margins">>>;
}) {
  return (
    <section
      data-testid="fx-rate-book"
      className="glass-card rounded-2xl p-5"
      aria-labelledby="fx-rate-book-title"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/50 bg-sky-100/70 text-sky shadow-sm">
          <ArrowLeftRight className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2
            id="fx-rate-book-title"
            className="font-display text-base font-semibold text-ink"
          >
            {t("fx.title")}
          </h2>
          <p className="mt-0.5 text-xs text-muted-fg">{t("fx.subtitle")}</p>
        </div>
      </div>

      {rates.length === 0 ? (
        <p className="mt-4 rounded-xl bg-paper/70 px-3 py-3 text-sm text-muted-fg">
          {t("fx.empty")}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {rates.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">
                  {t("fx.pair", { base: r.base, quote: r.quote })}
                </p>
                <p className="text-xs text-muted-fg">
                  {t("fx.asOf", { date: r.asOfDate })}
                </p>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="font-display text-base font-semibold tabular-nums text-ink">
                  {num(r.rate, 4)}
                </span>
                <Badge tone="neutral">{r.source}</Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
