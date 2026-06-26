import Link from "next/link";
import type { getTranslations } from "next-intl/server";
import { BadgeCheck, Medal, Newspaper } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { num } from "@/lib/utils";
import { CupScoreRing } from "./cup-score-ring";
import type { ReputationSummary } from "./data";

type ReputationT = Awaited<ReturnType<typeof getTranslations<"reputation">>>;

/**
 * ReputationCard — the embeddable per-lot reputation block (P3-S19). A cup-score ring,
 * the grade badge, award/cert/press chips, and the QC-truth reconciliation line. Pure
 * server component (no client JS), so it drops into any lot surface — the wall, the
 * lot dossier, an offer's "why this lot" panel — at 60fps.
 *
 * Polymorphic by `href`: with one, it renders as an interactive glass Link (the wall
 * card, with a stable `reputation-card-<lot>` test id and a GPU-only hover lift); with
 * none, a static glass-card (embedded read-only). A NULL cup score is shown as
 * "no cup score yet", never a fabricated 0 (rail §5).
 */
export function ReputationCard({
  summary,
  t,
  href,
}: {
  summary: ReputationSummary;
  t: ReputationT;
  href?: string;
}) {
  const s = summary;

  const content = (
    <>
      <div className="flex items-start gap-4">
        <CupScoreRing
          score={s.bestCupScore}
          label={t("card.ringLabel", {
            score: s.bestCupScore == null ? "0" : num(s.bestCupScore, 1),
          })}
          emptyLabel={t("card.noScore")}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-display text-base font-semibold text-ink">
                {s.lotCode}
              </p>
              {s.variety && (
                <p className="truncate text-xs text-muted-fg">{s.variety}</p>
              )}
            </div>
            <Badge tone={s.scaGrade ? "forest" : "neutral"} dot>
              {s.scaGrade ?? t("card.ungraded")}
            </Badge>
          </div>

          <p className="mt-1 text-xs tabular-nums text-muted-fg">
            {s.bestCupScore == null ? (
              <span className="font-medium text-honey-700">
                {t("card.noScore")}
              </span>
            ) : s.qcCuppingScore == null ? (
              t("card.qcReconcileNone")
            ) : (
              t("card.qcReconcile", { score: num(s.qcCuppingScore, 1) })
            )}
          </p>
        </div>
      </div>

      {/* Accolade chips — only what the lot actually carries (never a fabricated row). */}
      {(s.awardCount > 0 || s.certCount > 0 || s.pressCount > 0) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {s.awardCount > 0 && (
            <Chip
              icon={Medal}
              label={t("card.awardsLabel", { count: num(s.awardCount) })}
              tone="honey"
            />
          )}
          {s.certCount > 0 && (
            <Chip
              icon={BadgeCheck}
              label={t("card.certsLabel", { count: num(s.certCount) })}
              tone="forest"
            />
          )}
          {s.pressCount > 0 && (
            <Chip
              icon={Newspaper}
              label={t("card.pressLabel", { count: num(s.pressCount) })}
              tone="coffee"
            />
          )}
        </div>
      )}

      {href && (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-[0.6875rem] uppercase tracking-wide tabular-nums text-muted-fg">
            {t("card.ledger", { count: num(s.accoladeCount) })}
          </span>
          <span className="text-xs font-medium text-forest">
            {t("card.open")} →
          </span>
        </div>
      )}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        data-testid={`reputation-card-${s.lotCode}`}
        className="glass-card glass-hover perf-contain block rounded-2xl p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40 focus-visible:ring-offset-2"
      >
        {content}
      </Link>
    );
  }

  return <div className="glass-card rounded-2xl p-5">{content}</div>;
}

const CHIP_TONES = {
  honey: "bg-honey-100/70 text-honey-700",
  forest: "bg-forest-100/70 text-forest",
  coffee: "bg-coffee-200/40 text-coffee",
} as const;

function Chip({
  icon: Icon,
  label,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tone: keyof typeof CHIP_TONES;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium tabular-nums ${CHIP_TONES[tone]}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}
