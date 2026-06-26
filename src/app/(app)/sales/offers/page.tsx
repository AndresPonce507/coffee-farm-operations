import { getTranslations } from "next-intl/server";
import { Award, Coffee, Gauge, Megaphone, TrendingUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Tile } from "@/components/ui/tile";
import { num, usd } from "@/lib/utils";
import { getOfferBoard, getOfferableLots, type OfferRow } from "./data";
import { PublishOffer } from "./publish-offer.client";

/**
 * /sales/offers — the B2B green offer board (P3-S1 trade trunk).
 *
 * Every live published offer lands here as a glass card with an UNMISTAKABLE regime
 * badge: forest-green "Reserve · <variety>" for single-origin Presidential/Specialty
 * lots offered on their own merit, neutral "Commodity · C + diff" for everything
 * offered against the ICE "C". A reserve card NEVER renders a "C"-index anchor (the
 * keystone of the slice, enforced at the database, mirrored here in the UI). Each card
 * shows the asking price (or "Auction / RFQ" when open), the offered volume, and the
 * live remaining ATP from green_lots_atp.
 *
 * Server Component: the board reads the co-located offer port; the only client JS is
 * the publish-offer island at the top.
 */

/** Per-kg money: 2 decimals under $100 (reserve $/kg, commodity ~$5), 0 above. */
function price(value: number): string {
  return usd(value, value < 100 ? 2 : 0);
}

export default async function OffersPage() {
  const t = await getTranslations("sales");
  const [offers, lots] = await Promise.all([
    getOfferBoard(),
    getOfferableLots(),
  ]);

  const reserveCount = offers.filter((o) => o.regime === "reserve").length;
  const commodityCount = offers.length - reserveCount;
  const totalAtp = offers.reduce((acc, o) => acc + (o.atpKg ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader title={t("offers.title")} subtitle={t("offers.subtitle")}>
        <PublishOffer lots={lots} />
      </PageHeader>

      <div className="glass-card grid grid-cols-2 gap-px overflow-hidden rounded-2xl lg:grid-cols-4">
        <Tile
          label={t("offers.summary.live")}
          value={num(offers.length)}
          sub={t("offers.summary.liveSub")}
          accent="forest"
          icon={Gauge}
        />
        <Tile
          label={t("offers.summary.reserve")}
          value={num(reserveCount)}
          sub={t("offers.summary.reserveSub")}
          accent="honey"
          icon={Award}
        />
        <Tile
          label={t("offers.summary.commodity")}
          value={num(commodityCount)}
          sub={t("offers.summary.commoditySub")}
          accent="coffee"
          icon={Coffee}
        />
        <Tile
          label={t("offers.summary.atp")}
          value={num(Math.round(totalAtp))}
          sub={t("offers.summary.atpSub")}
          accent="sky"
          icon={TrendingUp}
        />
      </div>

      {offers.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title={t("offers.empty.title")}
          description={t("offers.empty.description")}
        />
      ) : (
        <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {offers.map((offer) => (
            <OfferCard key={offer.offerId} offer={offer} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function OfferCard({
  offer,
  t,
}: {
  offer: OfferRow;
  t: Awaited<ReturnType<typeof getTranslations<"sales">>>;
}) {
  const isReserve = offer.regime === "reserve";

  return (
    <article
      data-testid={`offer-card-${offer.offerId}`}
      className="glass-card glass-hover perf-contain block rounded-2xl p-5"
    >
      {/* Header: lot code + regime badge */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-base font-semibold text-ink">
            {offer.greenLotCode}
          </p>
          <p className="text-xs text-muted-fg">
            {offer.cuppingScore == null
              ? t("offers.card.noScore")
              : t("offers.card.score", { score: num(offer.cuppingScore, 1) })}
            {offer.scaGrade ? ` · ${offer.scaGrade}` : ""}
          </p>
        </div>
        <Badge tone={isReserve ? "forest" : "neutral"} dot>
          {isReserve
            ? t("offers.regime.reserveTag", {
                variety: offer.variety ?? offer.scaGrade ?? "—",
              })
            : t("offers.regime.commodityTag")}
        </Badge>
      </div>

      {/* Asking price headline (or auction / RFQ) */}
      <div className="mt-4">
        <p className="text-xs uppercase tracking-wide text-muted-fg">
          {t("offers.card.asking")}
        </p>
        {offer.askingPrice == null ? (
          <>
            <p className="font-display text-2xl font-bold text-ink">
              {t("offers.card.auction")}
            </p>
            <p className="text-xs text-muted-fg">{t("offers.card.auctionSub")}</p>
          </>
        ) : (
          <p className="font-display text-2xl font-bold tabular-nums text-ink">
            {t("offers.card.perKg", { price: price(offer.askingPrice) })}
          </p>
        )}
      </div>

      {/* Offered volume + live ATP */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-paper/70 px-3 py-2">
          <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
            {t("offers.card.offered")}
          </p>
          <p className="text-sm font-medium tabular-nums text-ink">
            {offer.offeredKg == null
              ? t("offers.card.offeredAll")
              : t("offers.card.offeredKg", { kg: num(Math.round(offer.offeredKg)) })}
          </p>
        </div>
        <div className="rounded-xl bg-paper/70 px-3 py-2">
          <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
            {t("offers.card.atp")}
          </p>
          <p className="text-sm font-medium tabular-nums text-ink">
            {offer.atpKg == null || offer.atpKg <= 0
              ? t("offers.card.atpNone")
              : t("offers.card.atpKg", { kg: num(Math.round(offer.atpKg)) })}
          </p>
        </div>
      </div>

      {/* Currency footer */}
      <div className="mt-4 flex items-center justify-end">
        <span className="text-xs font-medium tabular-nums text-muted-fg">
          {offer.currency}
        </span>
      </div>
    </article>
  );
}
