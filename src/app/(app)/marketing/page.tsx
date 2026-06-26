import { getTranslations } from "next-intl/server";
import {
  Megaphone,
  MessageSquare,
  Repeat,
  Rocket,
  Send,
  Users,
} from "lucide-react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Tile } from "@/components/ui/tile";
import { longDate, num } from "@/lib/utils";
import {
  getMarketingConsole,
  type CampaignTrigger,
  type MarketingConsole as MarketingConsoleData,
} from "./data";
import { CampaignCard } from "./campaign-card";
import { MarketingConsole } from "./marketing-console.client";

/**
 * /marketing — the lifecycle console (P3-S20 lifecycle marketing).
 *
 * A campaign drafts itself off real estate events (a green lot minted, a buyer's lot
 * running low, a sample shipped), pulling the cup score and grade from the reputation
 * and harvest rows. The owner reviews, then clicks send — a human signs every send (no
 * untrusted inbound, no AI, ever sends on its own). The audience is the consent gate:
 * only an opted-in, non-unsubscribed contact is reachable, enforced at the database.
 * Server Component: the only client JS is the compose + send island.
 */

const TRIGGER_META: {
  kind: Exclude<CampaignTrigger, "manual">;
  icon: typeof Rocket;
}[] = [
  { kind: "lot-launch", icon: Rocket },
  { kind: "replenishment", icon: Repeat },
  { kind: "sample-follow-up", icon: MessageSquare },
];

const DELIVERY_TONE: Record<string, BadgeTone> = {
  sent: "forest",
  queued: "sky",
  failed: "danger",
  suppressed: "neutral",
};

export default async function MarketingPage() {
  const t = await getTranslations("marketing");
  const data: MarketingConsoleData = await getMarketingConsole();
  const { campaigns, audience, deliveryLog, lots } = data;

  const queuedTotal = campaigns.reduce((acc, c) => acc + c.queuedTotal, 0);
  const sentTotal = campaigns.reduce((acc, c) => acc + c.sentTotal, 0);
  const countByTrigger = (k: CampaignTrigger) =>
    campaigns.filter((c) => c.triggerKind === k).length;

  return (
    <div className="space-y-6">
      <PageHeader title={t("page.title")} subtitle={t("page.subtitle")} />

      <div className="glass-card grid grid-cols-2 gap-px overflow-hidden rounded-2xl lg:grid-cols-4">
        <Tile
          label={t("summary.campaigns")}
          value={num(campaigns.length)}
          sub={t("summary.campaignsSub", { count: campaigns.length })}
          accent="forest"
          icon={Megaphone}
        />
        <Tile
          label={t("summary.audience")}
          value={num(audience.length)}
          sub={t("summary.audienceSub")}
          accent="sky"
          icon={Users}
        />
        <Tile
          label={t("summary.queued")}
          value={num(queuedTotal)}
          sub={t("summary.queuedSub")}
          accent="honey"
          icon={Send}
        />
        <Tile
          label={t("summary.sent")}
          value={num(sentTotal)}
          sub={t("summary.sentSub")}
          accent="coffee"
          icon={Rocket}
        />
      </div>

      {/* Trigger board — what drafts a campaign. */}
      <div data-testid="trigger-board" className="glass-card rounded-2xl p-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-display text-base font-semibold text-ink">
            {t("triggers.title")}
          </p>
          <p className="text-xs text-muted-fg">{t("triggers.subtitle")}</p>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          {TRIGGER_META.map(({ kind, icon: Icon }) => (
            <div key={kind} className="rounded-xl bg-paper/70 px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-forest-100/70 text-forest">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-[0.6875rem] font-medium tabular-nums text-muted-fg">
                  {t("triggers.drafted", { count: countByTrigger(kind) })}
                </span>
              </div>
              <p className="mt-2 text-sm font-semibold text-ink">
                {t(`triggers.${kind}.label`)}
              </p>
              <p className="mt-0.5 text-xs text-muted-fg">
                {t(`triggers.${kind}.desc`)}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div>
          {campaigns.length === 0 ? (
            <EmptyState
              icon={Megaphone}
              title={t("empty.title")}
              description={t("empty.description")}
            />
          ) : (
            <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2">
              {campaigns.map((c) => (
                <CampaignCard key={c.campaignId} campaign={c} t={t} />
              ))}
            </div>
          )}
        </div>

        <MarketingConsole campaigns={campaigns} lots={lots} audience={audience} />
      </div>

      <DeliveryLog rows={deliveryLog} t={t} />
    </div>
  );
}

function DeliveryLog({
  rows,
  t,
}: {
  rows: MarketingConsoleData["deliveryLog"];
  t: Awaited<ReturnType<typeof getTranslations<"marketing">>>;
}) {
  return (
    <div className="glass-card rounded-2xl p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-display text-base font-semibold text-ink">
          {t("delivery.title")}
        </p>
        <p className="text-xs text-muted-fg">{t("delivery.subtitle")}</p>
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted-fg">{t("delivery.empty")}</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {rows.map((r) => (
            <li
              key={r.outboundId}
              data-testid={`delivery-row-${r.outboundId}`}
              className="flex items-center justify-between gap-3 rounded-xl bg-paper/70 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">
                  {r.campaignName}
                </p>
                <p className="truncate text-xs text-muted-fg">
                  {t("delivery.to", { name: r.contactName })}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Badge tone={DELIVERY_TONE[r.status] ?? "neutral"} dot>
                  {t(`delivery.status.${r.status}`)}
                </Badge>
                <span className="text-xs tabular-nums text-muted-fg">
                  {longDate(r.sentAt ?? r.createdAt)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
