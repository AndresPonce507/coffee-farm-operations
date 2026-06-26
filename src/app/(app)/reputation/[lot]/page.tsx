import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  ArrowLeft,
  BadgeCheck,
  ExternalLink,
  Medal,
  Newspaper,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { longDate, num } from "@/lib/utils";
import { getLotReputation, type Accolade, type LotReputationDetail } from "../data";
import { ReputationCard } from "../reputation-card";
import { AccoladeComposer } from "./accolade-composer.client";

/**
 * /reputation/[lot] — one lot's append-only reputation ledger (P3-S19).
 *
 * Server Component. Resolves the lot's full ledger, 404s on an unknown code (the ⌘K
 * palette or a hand-typed URL must never fabricate a record). The header carries the
 * chain-verified stamp (verify_chain('accolade:<lot>')) and the QC truth the view
 * reconciles to. The left rail is the reputation card + the append-only timeline
 * (every entry, originals struck when a later revision supersedes them); the right
 * rail is the ONE interactive island, <AccoladeComposer>, where the owner records a
 * new accolade or posts a score revision (a correction is a new row, never an edit).
 */

type ReputationT = Awaited<ReturnType<typeof getTranslations<"reputation">>>;

export default async function LotReputationPage({
  params,
}: {
  params: Promise<{ lot: string }>;
}) {
  const { lot } = await params;
  const lotCode = decodeURIComponent(lot);
  const t = await getTranslations("reputation");

  const detail = await getLotReputation(lotCode).catch(() => null);
  if (!detail) {
    notFound();
  }

  // Entries the owner may revise: live cup scores (or a live prior revision).
  const revisable = detail.accolades
    .filter(
      (a) =>
        (a.kind === "cup-score" || a.kind === "score-revision") && !a.reversed,
    )
    .map((a) => ({
      id: a.id,
      label: t("detail.scoreLine", {
        score: a.score == null ? "—" : num(a.score, 1),
      }),
    }));

  return (
    <div className="space-y-6">
      <Link
        href="/reputation"
        className="inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted-fg transition-colors hover:text-forest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t("detail.back")}
      </Link>

      <div className="animate-rise relative mb-2 pb-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-fg">
          {t("detail.eyebrow")}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
            {lotCode}
          </h1>
          <ChainStamp verified={detail.chainVerified} t={t} />
        </div>
        <p className="mt-1 text-sm text-muted-fg">{t("detail.subtitle")}</p>
        <p className="mt-1 text-xs tabular-nums text-muted-fg">
          {t("detail.qcTruth")}
          {": "}
          {detail.qcCuppingScore == null
            ? t("detail.qcNone")
            : t("detail.qcCup", { score: num(detail.qcCuppingScore, 1) })}
        </p>
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <ReputationCard summary={detail} t={t} />
          <Timeline detail={detail} t={t} />
        </div>
        <AccoladeComposer lotCode={lotCode} revisable={revisable} />
      </div>
    </div>
  );
}

function ChainStamp({ verified, t }: { verified: boolean; t: ReputationT }) {
  return (
    <Badge tone={verified ? "forest" : "danger"}>
      {verified ? (
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
      )}
      {verified ? t("verify.verified") : t("verify.broken")}
    </Badge>
  );
}

function Timeline({
  detail,
  t,
}: {
  detail: LotReputationDetail;
  t: ReputationT;
}) {
  return (
    <section className="glass-card rounded-2xl p-5">
      <h2 className="font-display text-base font-semibold text-ink">
        {t("detail.timeline")}
      </h2>

      {detail.accolades.length === 0 ? (
        <p className="mt-3 text-sm text-muted-fg">{t("detail.timelineEmpty")}</p>
      ) : (
        <ol data-testid="accolade-timeline" className="mt-4 space-y-3">
          {/* Most recent first — the live state reads top-down. */}
          {[...detail.accolades].reverse().map((a) => (
            <TimelineRow key={a.id} accolade={a} t={t} />
          ))}
        </ol>
      )}
    </section>
  );
}

const KIND_ICON = {
  "cup-score": Sparkles,
  award: Medal,
  certification: BadgeCheck,
  "press-mention": Newspaper,
  "score-revision": Sparkles,
} as const;

function TimelineRow({ accolade: a, t }: { accolade: Accolade; t: ReputationT }) {
  const Icon = KIND_ICON[a.kind];
  const isScore = a.kind === "cup-score" || a.kind === "score-revision";

  return (
    <li
      className={
        "flex items-start gap-3 rounded-xl bg-paper/70 px-3 py-3 " +
        (a.reversed ? "opacity-60" : "")
      }
    >
      <span
        aria-hidden
        className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-forest-100/70 text-forest"
      >
        <Icon className="h-4 w-4" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-forest">
            {t(`kind.${a.kind}`)}
          </span>
          {a.reversed && (
            <Badge tone="neutral">{t("detail.superseded")}</Badge>
          )}
        </div>

        <p
          className={
            "mt-0.5 font-medium text-ink " + (a.reversed ? "line-through" : "")
          }
        >
          {isScore
            ? t("detail.scoreLine", {
                score: a.score == null ? "—" : num(a.score, 1),
              })
            : (a.title ?? t(`kind.${a.kind}`))}
        </p>

        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-fg">
          {a.awardedBy && (
            <span>{t("detail.awardedBy", { who: a.awardedBy })}</span>
          )}
          {a.awardYear != null && <span>· {a.awardYear}</span>}
          <span>· {longDate(a.occurredAt)}</span>
          {a.reversesId != null && (
            <span>· {t("detail.revisionOf", { id: num(a.reversesId) })}</span>
          )}
        </p>

        {a.evidenceUrl && (
          <a
            href={a.evidenceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-forest hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
          >
            <ExternalLink className="h-3 w-3" aria-hidden />
            {t("detail.evidence")}
          </a>
        )}
      </div>
    </li>
  );
}
