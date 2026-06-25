import { getTranslations } from "next-intl/server";
import { Lock, Scale, Timer, Zap } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Tile } from "@/components/ui/tile";
import { num, usd } from "@/lib/utils";
import { getFixationCockpit, type FixationLine } from "./data";
import { FixLine } from "./fix-line.client";

/**
 * /sales/fixation — the fixation cockpit (P3-S1 trade trunk).
 *
 * Every un-fixed DIFFERENTIAL contract line lands here as a glass card showing the
 * live "C" mark, the differential, and the implied $/kg the line would lock at right
 * now (computed in SQL via convert_qty — never a JS 2.2046). Reserve lots are off the
 * "C" and are EXCLUDED by the view, so they never appear here. Fixing a line is a
 * human-confirmed, irreversible "lock the C leg" action (the one interactive island).
 *
 * Server Component: the cockpit reads the co-located port; the only client JS is the
 * per-line fix control.
 */

const perKg = (v: number) => usd(v, v < 100 ? 2 : 0);

export default async function FixationPage() {
  const t = await getTranslations("sales");
  const lines = await getFixationCockpit();

  const atRiskKg = lines.reduce((acc, l) => acc + l.kg, 0);
  const readyCount = lines.filter((l) => l.currentCPrice != null).length;

  return (
    <div className="space-y-6">
      <PageHeader title={t("fixation.title")} subtitle={t("fixation.subtitle")} />

      <div className="glass-card grid grid-cols-1 gap-px overflow-hidden rounded-2xl sm:grid-cols-3">
        <Tile
          label={t("fixation.summary.open")}
          value={num(lines.length)}
          sub={t("fixation.summary.openSub")}
          accent="honey"
          icon={Timer}
        />
        <Tile
          label={t("fixation.summary.kg")}
          value={num(Math.round(atRiskKg))}
          sub={t("fixation.summary.kgSub")}
          accent="cherry"
          icon={Scale}
        />
        <Tile
          label={t("fixation.summary.ready")}
          value={num(readyCount)}
          sub={t("fixation.summary.readySub")}
          accent="forest"
          icon={Zap}
        />
      </div>

      {lines.length === 0 ? (
        <EmptyState
          icon={Lock}
          title={t("fixation.empty.title")}
          description={t("fixation.empty.description")}
        />
      ) : (
        <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {lines.map((line) => (
            <FixCard key={line.contractLineId} line={line} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function FixCard({
  line,
  t,
}: {
  line: FixationLine;
  t: Awaited<ReturnType<typeof getTranslations<"sales">>>;
}) {
  const ready = line.currentCPrice != null;

  return (
    <article
      data-testid={`fix-card-${line.contractLineId}`}
      className="glass-card glass-hover perf-contain flex flex-col rounded-2xl p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-base font-semibold text-ink">
            {line.greenLotCode}
          </p>
          <p className="text-xs text-muted-fg">
            {t("fixation.card.contract")} {line.contractNo}
          </p>
        </div>
        <span className="text-xs font-medium tabular-nums text-muted-fg">
          {t("fixation.card.kgValue", { kg: num(Math.round(line.kg)) })}
        </span>
      </div>

      {/* live C + differential */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-paper/70 px-3 py-2">
          <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
            {t("fixation.card.currentC")}
            {line.iceCMonth ? ` · ${line.iceCMonth}` : ""}
          </p>
          <p className="text-sm font-medium tabular-nums text-ink">
            {line.currentCPrice == null
              ? t("fixation.card.noMark")
              : t("fixation.card.currentCValue", {
                  price: usd(line.currentCPrice, 2),
                })}
          </p>
        </div>
        <div className="rounded-xl bg-paper/70 px-3 py-2">
          <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
            {t("fixation.card.differential")}
          </p>
          <p className="text-sm font-medium tabular-nums text-ink">
            {line.differentialCents == null
              ? "—"
              : t("fixation.card.differentialValue", {
                  cents: num(line.differentialCents, 0),
                })}
          </p>
        </div>
      </div>

      {/* implied price headline */}
      <div className="mt-4 rounded-xl border border-forest/15 bg-forest/[0.04] px-3 py-2.5">
        <p className="text-[0.6875rem] uppercase tracking-wide text-forest">
          {t("fixation.card.implied")}
        </p>
        <p className="font-display text-xl font-bold tabular-nums text-ink">
          {line.impliedUnitPrice == null
            ? t("fixation.card.impliedUnknown")
            : t("fixation.card.impliedValue", {
                price: perKg(line.impliedUnitPrice),
              })}
        </p>
      </div>

      {/* fix control */}
      <div className="mt-4 flex justify-end">
        <FixLine
          contractLineId={line.contractLineId}
          greenLotCode={line.greenLotCode}
          kg={line.kg}
          impliedUnitPrice={line.impliedUnitPrice}
          ready={ready}
        />
      </div>
    </article>
  );
}
