import type { getTranslations } from "next-intl/server";
import { Send, Sparkles } from "lucide-react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { longDate, num } from "@/lib/utils";
import type { CampaignBoardRow, CampaignStatus } from "./data";

type MarketingT = Awaited<ReturnType<typeof getTranslations<"marketing">>>;

const STATUS_TONE: Record<CampaignStatus, BadgeTone> = {
  draft: "neutral",
  queued: "sky",
  sent: "forest",
  archived: "neutral",
};

/**
 * CampaignCard — one campaign on the board (P3-S20). A glass-lite card with the
 * campaign name, an honest status badge (draft / queued / sent), the trigger that
 * drafted it, the lot it's bound to, and the queued / sent tallies. Pure server
 * component (no client JS) — the compose + human-confirmed send live in the island.
 */
export function CampaignCard({
  campaign,
  t,
}: {
  campaign: CampaignBoardRow;
  t: MarketingT;
}) {
  const c = campaign;
  return (
    <div
      data-testid={`campaign-card-${c.campaignId}`}
      className="glass-card glass-hover perf-contain rounded-2xl p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-display text-base font-semibold text-ink">
            {c.name}
          </p>
          <p className="mt-0.5 text-xs text-muted-fg">
            {c.greenLotCode
              ? t("card.lot", { code: c.greenLotCode })
              : t("card.noLot")}
          </p>
        </div>
        <Badge tone={STATUS_TONE[c.status]} dot>
          {t(`status.${c.status}`)}
        </Badge>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-forest-100/70 px-2.5 py-1 text-xs font-medium text-forest">
          <Sparkles className="h-3.5 w-3.5" />
          {t(`board.trigger.${c.triggerKind}`)}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-paper/70 px-2.5 py-1 text-xs font-medium tabular-nums text-muted-fg">
          <Send className="h-3.5 w-3.5" />
          {t("card.sent", { count: num(c.sentTotal) })}
        </span>
      </div>

      <div className="mt-4 flex items-center justify-between text-xs tabular-nums text-muted-fg">
        <span>{t("card.queued", { count: num(c.queuedTotal) })}</span>
        <span>{t("card.updated", { when: longDate(c.updatedAt) })}</span>
      </div>
    </div>
  );
}
