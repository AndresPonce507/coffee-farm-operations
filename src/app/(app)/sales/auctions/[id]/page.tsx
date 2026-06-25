import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { num, shortDate, usd } from "@/lib/utils";
import {
  getAuctionDetail,
  type AuctionEntry,
  type AuctionStatus,
} from "../data";
import { EnterLot } from "./enter-lot.client";
import { ScorePanel } from "./score-panel.client";

/**
 * /sales/auctions/[id] — one auction's workspace (P3-S4).
 *
 * Server Component. Resolves the auction's full payload, 404s on an unknown id (a ⌘K
 * jump or a hand-typed URL can route to a missing auction — never a fabricated one).
 * The left rail is the round: each entry rendered as a results card that RECONCILES
 * the farm's own cup against the jury's verdict and — once cleared — shows the
 * clearing price AND the multiplier over the commodity baseline (the BoP premium made
 * visible). The right rail is the enter-lot island; each entry carries a score-panel
 * island for jury capture + the money-shaped record-result write.
 */

const STATUS_TONE: Record<AuctionStatus, BadgeTone> = {
  entered: "neutral",
  scored: "honey",
  live: "sky",
  sold: "forest",
  withdrawn: "danger",
};

const perKg = (v: number) => usd(v, v < 100 ? 2 : 0);
const mult = (v: number) => (Number.isInteger(v) ? num(v) : num(v, 1));
const score = (v: number | null) => (v == null ? "—" : num(v, 1));

export default async function AuctionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const auctionId = Number(id);
  const t = await getTranslations("auctions");

  const detail = Number.isInteger(auctionId)
    ? await getAuctionDetail(auctionId).catch(() => null)
    : null;
  if (!detail) {
    notFound();
  }

  return (
    <div className="space-y-6">
      {/* back link */}
      <Link
        href="/sales/auctions"
        className="inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted-fg transition-colors hover:text-forest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t("detail.back")}
      </Link>

      {/* header */}
      <div className="animate-rise relative mb-2 pb-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-fg">
          {t("detail.eyebrow")} · {t(`platform.${detail.platform}`)}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
            {detail.name}
          </h1>
          <Badge tone={STATUS_TONE[detail.status]} dot>
            {t(`status.${detail.status}`)}
          </Badge>
        </div>
        {(detail.entryDeadline || detail.scoringDeadline) && (
          <p className="mt-1 text-xs tabular-nums text-muted-fg">
            {detail.entryDeadline &&
              t("detail.entryDeadline", { date: shortDate(detail.entryDeadline) })}
            {detail.entryDeadline && detail.scoringDeadline && " · "}
            {detail.scoringDeadline &&
              t("detail.scoringDeadline", { date: shortDate(detail.scoringDeadline) })}
          </p>
        )}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        {/* left rail — the round */}
        <section className="space-y-4">
          <h2 className="font-display text-base font-semibold text-ink">
            {t("detail.lotsHeading")}
          </h2>

          {detail.entries.length === 0 ? (
            <div className="glass-card rounded-2xl p-6 text-center text-sm text-muted-fg">
              {t("detail.noEntries")}
            </div>
          ) : (
            <div className="space-y-4">
              {detail.entries.map((entry) => (
                <EntryCard key={entry.entryId} entry={entry} t={t} />
              ))}
            </div>
          )}
        </section>

        {/* right rail — enter a lot */}
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <EnterLot
            auctionId={detail.id}
            auctionName={detail.name}
            availableLots={detail.availableLots}
          />
        </aside>
      </div>
    </div>
  );
}

function EntryCard({
  entry,
  t,
}: {
  entry: AuctionEntry;
  t: Awaited<ReturnType<typeof getTranslations<"auctions">>>;
}) {
  return (
    <div
      data-testid={`auction-entry-${entry.entryId}`}
      className="glass-card perf-contain space-y-4 rounded-2xl p-5"
    >
      {/* header: lot + kg + sold/open pill */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-base font-semibold text-ink">
            {entry.greenLotCode}
          </p>
          <p className="text-xs tabular-nums text-muted-fg">
            {t("entry.kg", { kg: num(Math.round(entry.kg)) })}
          </p>
        </div>
        <Badge tone={entry.sold ? "forest" : "neutral"} dot>
          {entry.sold ? t("status.sold") : t("entry.open")}
        </Badge>
      </div>

      {/* score reconciliation: farm cup vs jury vs panel avg */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-paper/70 px-3 py-2">
          <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
            {t("entry.farmScore")}
          </p>
          <p className="text-sm font-medium tabular-nums text-ink">
            {score(entry.farmCuppingScore)}
          </p>
        </div>
        <div className="rounded-xl bg-paper/70 px-3 py-2">
          <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
            {t("entry.juryScore")}
          </p>
          <p className="text-sm font-medium tabular-nums text-ink">
            {score(entry.juryScore)}
          </p>
        </div>
        <div className="rounded-xl bg-paper/70 px-3 py-2">
          <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
            {t("entry.panelScore")}
          </p>
          <p className="text-sm font-medium tabular-nums text-ink">
            {entry.panelFinalScore == null
              ? t("entry.notScored")
              : score(entry.panelFinalScore)}
          </p>
        </div>
      </div>

      {/* the premium story — only once cleared */}
      {entry.sold && entry.clearingPriceUsdPerKg != null ? (
        <div className="rounded-xl border border-forest/15 bg-forest/[0.04] px-3 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <p className="text-[0.6875rem] uppercase tracking-wide text-forest">
                {t("entry.cleared")}
              </p>
              <p className="font-display text-xl font-bold tabular-nums text-ink">
                {t("entry.clearedValue", {
                  price: perKg(entry.clearingPriceUsdPerKg),
                })}
              </p>
            </div>
            <p className="text-right text-sm font-medium tabular-nums text-forest">
              {entry.priceMultiplier == null
                ? t("entry.noBaseline")
                : t("entry.multiplier", { mult: mult(entry.priceMultiplier) })}
            </p>
          </div>
          <p className="mt-1 text-xs text-muted-fg">
            {entry.commodityBaselineUsdPerKg != null &&
              t("entry.baseline", {
                price: perKg(entry.commodityBaselineUsdPerKg),
              })}
            {entry.winningBidder &&
              ` · ${t("entry.winner", { bidder: entry.winningBidder })}`}
          </p>
        </div>
      ) : (
        <p className="text-xs tabular-nums text-muted-fg">
          {entry.markCount === 0
            ? t("entry.noMarks")
            : t("entry.marks", { count: entry.markCount, jurors: entry.jurorCount })}
        </p>
      )}

      {/* interactive island: jury capture + the money-shaped record-result write */}
      <ScorePanel entry={entry} />
    </div>
  );
}
