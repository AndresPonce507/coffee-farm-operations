import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Award, Gavel, Sparkles, TrendingUp, Trophy } from "lucide-react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Tile } from "@/components/ui/tile";
import { num, shortDate, usd } from "@/lib/utils";
import { getAuctions, type AuctionStatus, type AuctionSummary } from "./data";
import { NewAuctionButton } from "./new-auction.client";

/**
 * /sales/auctions — the auction board (P3-S4 specialty auctions).
 *
 * Every auction lands here as a glass card: platform + name, a status pill walking
 * entered → scored → live → sold, the lots entered, and — once a lot clears — the
 * headline clearing price AND the multiplier over the farm's commodity baseline (the
 * Best-of-Panama premium made visible, the whole point of the channel). Server
 * Component: the board reads the co-located port; the only client JS is the
 * new-auction dialog.
 */

const STATUS_TONE: Record<AuctionStatus, BadgeTone> = {
  entered: "neutral",
  scored: "honey",
  live: "sky",
  sold: "forest",
  withdrawn: "danger",
};

/** Per-kg money: 2dp under $100, 0dp above. */
function perKg(value: number): string {
  return usd(value, value < 100 ? 2 : 0);
}

/** A price multiplier for display: 101 → "101", 7.8 → "7.8" (drop a trailing .0). */
function mult(value: number): string {
  return Number.isInteger(value) ? num(value) : num(value, 1);
}

export default async function AuctionsPage() {
  const t = await getTranslations("auctions");
  const auctions = await getAuctions();

  const inPlay = auctions.filter(
    (a) => a.status === "entered" || a.status === "scored" || a.status === "live",
  ).length;
  const cleared = auctions.filter((a) => a.status === "sold").length;
  const bestMultiplier = auctions.reduce<number | null>(
    (best, a) =>
      a.bestMultiplier != null && (best == null || a.bestMultiplier > best)
        ? a.bestMultiplier
        : best,
    null,
  );

  return (
    <div className="space-y-6">
      <PageHeader title={t("page.title")} subtitle={t("page.subtitle")}>
        <NewAuctionButton />
      </PageHeader>

      <div className="glass-card grid grid-cols-2 gap-px overflow-hidden rounded-2xl lg:grid-cols-4">
        <Tile
          label={t("summary.total")}
          value={num(auctions.length)}
          sub={t("summary.totalSub", { count: auctions.length })}
          accent="forest"
          icon={Gavel}
        />
        <Tile
          label={t("summary.live")}
          value={num(inPlay)}
          sub={t("summary.liveSub")}
          accent="honey"
          icon={Sparkles}
        />
        <Tile
          label={t("summary.sold")}
          value={num(cleared)}
          sub={t("summary.soldSub")}
          accent="coffee"
          icon={Award}
        />
        <Tile
          label={t("summary.bestMultiplier")}
          value={bestMultiplier == null ? "—" : `${mult(bestMultiplier)}×`}
          sub={t("summary.bestMultiplierSub")}
          accent="sky"
          icon={TrendingUp}
        />
      </div>

      {auctions.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title={t("empty.title")}
          description={t("empty.description")}
        />
      ) : (
        <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {auctions.map((a) => (
            <AuctionCard key={a.id} auction={a} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function AuctionCard({
  auction,
  t,
}: {
  auction: AuctionSummary;
  t: Awaited<ReturnType<typeof getTranslations<"auctions">>>;
}) {
  const entryLine =
    auction.entryCount === 0
      ? t("card.noEntries")
      : auction.entryCount === 1
        ? t("card.entriesOne")
        : t("card.entries", { count: auction.entryCount });

  return (
    <Link
      href={`/sales/auctions/${auction.id}`}
      data-testid={`auction-card-${auction.id}`}
      className="glass-card glass-hover perf-contain block rounded-2xl p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40 focus-visible:ring-offset-2"
    >
      {/* Header: platform name + status pill */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-base font-semibold text-ink">
            {auction.name}
          </p>
          <p className="text-xs text-muted-fg">
            {t(`platform.${auction.platform}`)}
          </p>
        </div>
        <Badge tone={STATUS_TONE[auction.status]} dot>
          {t(`status.${auction.status}`)}
        </Badge>
      </div>

      {/* Entries + deadlines */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-paper/70 px-3 py-2">
          <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
            {t("summary.total")}
          </p>
          <p className="text-sm font-medium tabular-nums text-ink">{entryLine}</p>
        </div>
        <div className="rounded-xl bg-paper/70 px-3 py-2">
          <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
            {t("new.entryDeadlineLabel")}
          </p>
          <p className="text-sm font-medium tabular-nums text-ink">
            {auction.entryDeadline
              ? shortDate(auction.entryDeadline)
              : t("card.noDeadline")}
          </p>
        </div>
      </div>

      {/* The premium story — clearing price + multiplier over the C. Only when cleared. */}
      {auction.bestClearingPriceUsdPerKg != null && (
        <div className="mt-4 rounded-xl border border-forest/15 bg-forest/[0.04] px-3 py-2.5">
          <p className="font-display text-lg font-bold tabular-nums text-ink">
            {t("card.cleared", { price: perKg(auction.bestClearingPriceUsdPerKg) })}
          </p>
          <p className="mt-0.5 text-xs font-medium tabular-nums text-forest">
            {auction.bestMultiplier == null
              ? t("card.multiplierPending")
              : t("card.multiplier", { mult: mult(auction.bestMultiplier) })}
          </p>
        </div>
      )}

      {/* Footer affordance */}
      <div className="mt-4 flex items-center justify-end">
        <span className="text-xs font-medium text-forest">{t("card.open")} →</span>
      </div>
    </Link>
  );
}
