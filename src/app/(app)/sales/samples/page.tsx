import { getTranslations } from "next-intl/server";
import { ExternalLink, FileText, FlaskConical, Send, Sprout } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Tile } from "@/components/ui/tile";
import { num, shortDate } from "@/lib/utils";
import {
  getSampleFormOptions,
  getSamplePipeline,
  isReserveBand,
  trackingUrl,
  type SamplePipelineRow,
} from "./data";
import { LogSampleButton, RecordVerdictButton } from "./sample-actions.client";

/**
 * /sales/samples — the B2B sample pipeline (P3-S2).
 *
 * Every OPEN sample (dispatched, still awaiting the buyer's verdict) lands here as a
 * glass card: which green lot, which buyer, the kind, grams, grade/score, and a $0
 * public-tracker deep link off the plain-text courier + tracking number (no carrier
 * API). The keystone story is surfaced on the card itself: an approved pre-shipment
 * sample of a reserve-band lot is what unlocks signing that lot's contract — the
 * database refuses to sign a Geisha contract that was never sampled, and the card
 * says so. A reserve-band lot carries NO price/"C" anchor here (this is the quality
 * pipeline, not the price book) — it stays the crown-jewel, never a commodity.
 *
 * Server Component: the board reads the pipeline port; the only client JS is the two
 * interactive islands (log a sample, record a verdict).
 */

export default async function SamplesPage() {
  const t = await getTranslations("samples");
  const [samples, options] = await Promise.all([
    getSamplePipeline(),
    getSampleFormOptions(),
  ]);

  const preShipment = samples.filter((s) => s.sampleKind === "pre_shipment").length;
  const documentation = samples.length - preShipment;
  const distinctLots = new Set(samples.map((s) => s.greenLotCode)).size;

  return (
    <div className="space-y-6">
      <PageHeader title={t("page.title")} subtitle={t("page.subtitle")}>
        <LogSampleButton lots={options.lots} buyers={options.buyers} />
      </PageHeader>

      <div className="glass-card grid grid-cols-2 gap-px overflow-hidden rounded-2xl lg:grid-cols-4">
        <Tile
          label={t("summary.open")}
          value={num(samples.length)}
          sub={t("summary.openSub", { count: samples.length })}
          accent="forest"
          icon={FlaskConical}
        />
        <Tile
          label={t("summary.preShipment")}
          value={num(preShipment)}
          sub={t("summary.preShipmentSub")}
          accent="honey"
          icon={Send}
        />
        <Tile
          label={t("summary.documentation")}
          value={num(documentation)}
          sub={t("summary.documentationSub")}
          accent="coffee"
          icon={FileText}
        />
        <Tile
          label={t("summary.lots")}
          value={num(distinctLots)}
          sub={t("summary.lotsSub")}
          accent="sky"
          icon={Sprout}
        />
      </div>

      {samples.length === 0 ? (
        <EmptyState
          icon={FlaskConical}
          title={t("empty.title")}
          description={t("empty.description")}
        />
      ) : (
        <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {samples.map((s) => (
            <SampleCard key={s.sampleId} sample={s} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function SampleCard({
  sample,
  t,
}: {
  sample: SamplePipelineRow;
  t: Awaited<ReturnType<typeof getTranslations<"samples">>>;
}) {
  const reserve = isReserveBand(sample.scaGrade);
  const isPreShipment = sample.sampleKind === "pre_shipment";
  const track = trackingUrl(sample.courier, sample.trackingNo);

  return (
    <article
      data-testid={`sample-card-${sample.sampleId}`}
      className="glass-card perf-contain flex flex-col rounded-2xl p-5"
    >
      {/* Header: lot + kind + reserve-band tag */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-base font-semibold text-ink">
            {sample.greenLotCode}
          </p>
          <p className="truncate text-xs text-muted-fg">
            {sample.buyerName ?? t("card.noBuyer")}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          <Badge tone={isPreShipment ? "forest" : "neutral"} dot>
            {t(`kind.${sample.sampleKind}`)}
          </Badge>
          {reserve && <Badge tone="honey">{t("card.reserveTag")}</Badge>}
        </div>
      </div>

      {/* Stat cells: grams + grade/score */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-paper/70 px-3 py-2">
          <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
            {t("card.grams")}
          </p>
          <p className="text-sm font-medium tabular-nums text-ink">
            {t("card.gramsValue", { grams: num(sample.grams) })}
          </p>
        </div>
        <div className="rounded-xl bg-paper/70 px-3 py-2">
          <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
            {t("card.score")}
          </p>
          <p className="text-sm font-medium tabular-nums text-ink">
            {sample.cuppingScore == null
              ? t("card.noScore")
              : t("card.scoreValue", { score: num(sample.cuppingScore, 1) })}
            <span className="ml-1 text-xs font-normal text-muted-fg">
              {sample.scaGrade ?? t("card.noGrade")}
            </span>
          </p>
        </div>
      </div>

      {/* Courier + $0 public-tracker deep link */}
      <div className="mt-3 text-xs text-muted-fg">
        {sample.courier && (
          <span className="font-medium text-ink">{sample.courier}</span>
        )}{" "}
        {track ? (
          <a
            href={track}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-forest hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40 focus-visible:ring-offset-2"
          >
            {t("card.track")}
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        ) : (
          <span>{t("card.noTracking")}</span>
        )}
      </div>

      {/* The keystone story: a pre-shipment reserve-band sample unlocks the sign. */}
      {isPreShipment && reserve && (
        <p className="mt-3 rounded-xl border border-forest/15 bg-forest/[0.04] px-3 py-2.5 text-xs text-forest">
          {t("card.unlockNote", { lot: sample.greenLotCode })}
        </p>
      )}

      {/* Footer: dispatched date + record-verdict control */}
      <div className="mt-4 flex items-center justify-between gap-3 pt-1">
        <span className="text-xs tabular-nums text-muted-fg">
          {t("card.dispatched", { date: shortDate(sample.dispatchedAt) })}
        </span>
        <RecordVerdictButton
          sampleId={sample.sampleId}
          lot={sample.greenLotCode}
          buyerName={sample.buyerName}
          sampleKind={sample.sampleKind}
        />
      </div>
    </article>
  );
}
