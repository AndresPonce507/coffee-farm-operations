import { getTranslations } from "next-intl/server";
import { AlertTriangle, CalendarClock, PauseCircle, Sprout } from "lucide-react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Tile } from "@/components/ui/tile";
import { longDate, num } from "@/lib/utils";
import {
  getAllocatableLots,
  getSubscriptionBoard,
  type AllocatableLot,
  type SubStatus,
  type SubscriptionRow,
} from "./data";
import { SubscriptionControls } from "./subscription-controls.client";

/**
 * /subscriptions — the Reserve Club board (P3-S12).
 *
 * Every recurring box lands as a glass card: who, how often, status, how many kg are
 * already allocated against scarce green lots, and how many dunning steps it carries.
 * Each card embeds the lifecycle island — pause/resume, skip a cycle, log dunning,
 * cancel, and the money-shaped ALLOCATE confirm whose live ATP drop proves a scarce
 * micro-lot can never be promised twice (the EXISTING prevent_oversell trigger is the
 * wall; rail §4). Below the board, a dunning queue collects the boxes whose payment
 * failed so they are chased in one place.
 *
 * Server Component: the board reads the subscription port; the only client JS is the
 * per-card controls island.
 */

const STATUS_TONE: Record<SubStatus, BadgeTone> = {
  active: "ok",
  paused: "warn",
  past_due: "danger",
  cancelled: "neutral",
};

function customerLabel(
  sub: SubscriptionRow,
  fallback: string,
): string {
  return sub.customerName ?? sub.customerEmail ?? fallback;
}

export default async function SubscriptionsPage() {
  const t = await getTranslations("subscriptions");
  const [subs, lots] = await Promise.all([
    getSubscriptionBoard(),
    getAllocatableLots(),
  ]);

  const active = subs.filter((s) => s.status === "active").length;
  const paused = subs.filter((s) => s.status === "paused").length;
  const pastDue = subs.filter((s) => s.status === "past_due").length;
  const allocatedKg = subs.reduce((acc, s) => acc + s.allocatedKg, 0);

  const dunningQueue = subs.filter(
    (s) => s.status === "past_due" || s.dunningCount > 0,
  );

  return (
    <div className="space-y-6">
      <PageHeader title={t("page.title")} subtitle={t("page.subtitle")} />

      <div className="glass-card grid grid-cols-2 gap-px overflow-hidden rounded-2xl lg:grid-cols-4">
        <Tile
          label={t("summary.active")}
          value={num(active)}
          sub={t("summary.activeSub")}
          accent="forest"
          icon={Sprout}
        />
        <Tile
          label={t("summary.paused")}
          value={num(paused)}
          sub={t("summary.pausedSub")}
          accent="honey"
          icon={PauseCircle}
        />
        <Tile
          label={t("summary.pastDue")}
          value={num(pastDue)}
          sub={t("summary.pastDueSub")}
          accent="cherry"
          icon={AlertTriangle}
        />
        <Tile
          label={t("summary.allocatedKg")}
          value={num(Math.round(allocatedKg))}
          sub={t("summary.allocatedKgSub")}
          accent="sky"
          icon={CalendarClock}
        />
      </div>

      {subs.length === 0 ? (
        <EmptyState
          icon={Sprout}
          title={t("empty.title")}
          description={t("empty.description")}
        />
      ) : (
        <>
          <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {subs.map((sub) => (
              <SubscriptionCard key={sub.id} sub={sub} lots={lots} t={t} />
            ))}
          </div>

          <DunningQueue subs={dunningQueue} t={t} />
        </>
      )}
    </div>
  );
}

function SubscriptionCard({
  sub,
  lots,
  t,
}: {
  sub: SubscriptionRow;
  lots: AllocatableLot[];
  t: Awaited<ReturnType<typeof getTranslations<"subscriptions">>>;
}) {
  const label = customerLabel(sub, t("card.customerFallback"));

  return (
    <article
      data-testid={`sub-card-${sub.id}`}
      className="glass-card perf-contain flex flex-col rounded-2xl p-5"
    >
      {/* Header: customer + status */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-display text-base font-semibold text-ink">
            {label}
          </p>
          <p className="text-xs text-muted-fg">{t("card.member")}</p>
        </div>
        <Badge tone={STATUS_TONE[sub.status]} dot>
          {t(`status.${sub.status}`)}
        </Badge>
      </div>

      {/* Stat cells: cadence + allocated + dunning */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-paper/70 px-3 py-2">
          <p className="text-[0.625rem] uppercase tracking-wide text-muted-fg">
            {t("card.cadenceLabel")}
          </p>
          <p className="text-sm font-medium text-ink">{t(`cadence.${sub.cadence}`)}</p>
        </div>
        <div className="rounded-xl bg-paper/70 px-3 py-2">
          <p className="text-[0.625rem] uppercase tracking-wide text-muted-fg">
            {t("card.allocated")}
          </p>
          <p className="text-sm font-medium tabular-nums text-ink">
            {t("card.allocatedValue", { kg: num(Math.round(sub.allocatedKg)) })}
          </p>
        </div>
        <div className="rounded-xl bg-paper/70 px-3 py-2">
          <p className="text-[0.625rem] uppercase tracking-wide text-muted-fg">
            {t("card.dunning")}
          </p>
          <p className="text-sm font-medium tabular-nums text-ink">
            {t("card.dunningValue", { count: sub.dunningCount })}
          </p>
        </div>
      </div>

      <p className="mt-3 text-xs tabular-nums text-muted-fg">
        {t("card.since", { date: longDate(sub.startedAt) })}
      </p>

      {/* Lifecycle + allocation island */}
      <div className="mt-4 border-t border-line/60 pt-3">
        <SubscriptionControls
          subscriptionId={sub.id}
          status={sub.status}
          customerLabel={label}
          lots={lots}
        />
      </div>
    </article>
  );
}

function DunningQueue({
  subs,
  t,
}: {
  subs: SubscriptionRow[];
  t: Awaited<ReturnType<typeof getTranslations<"subscriptions">>>;
}) {
  return (
    <section
      data-testid="dunning-queue"
      aria-label={t("dunningQueue.title")}
      className="glass-card rounded-2xl p-5"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-cherry" aria-hidden />
        <h2 className="font-display text-sm font-semibold text-ink">
          {t("dunningQueue.title")}
        </h2>
      </div>
      <p className="mt-1 text-xs text-muted-fg">{t("dunningQueue.description")}</p>

      {subs.length === 0 ? (
        <p className="mt-4 text-sm text-muted-fg">{t("dunningQueue.empty")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line/60">
          {subs.map((sub) => (
            <li
              key={sub.id}
              className="flex items-center justify-between gap-3 py-2.5"
            >
              <span className="truncate text-sm font-medium text-ink">
                {customerLabel(sub, t("card.customerFallback"))}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge tone={STATUS_TONE[sub.status]} dot>
                  {t(`status.${sub.status}`)}
                </Badge>
                <span className="text-xs tabular-nums text-muted-fg">
                  {t("card.dunningValue", { count: sub.dunningCount })}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
