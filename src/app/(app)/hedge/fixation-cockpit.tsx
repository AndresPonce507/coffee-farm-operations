import { useTranslations } from "next-intl";
import {
  Activity,
  Anchor,
  Gauge,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Tile } from "@/components/ui/tile";

import { LockFixationButton } from "@/app/(app)/hedge/lock-fixation-button";
import type {
  FixationExposureRow,
  IceCMark,
  LockFixationAction,
} from "@/app/(app)/hedge/types";

/**
 * FixationCockpit — the body of /hedge (P3-S0).
 *
 * Commodity-only by mandate: it shows the open, un-fixed commodity reservations
 * (the rows of `v_fixation_exposure`) × the live "C" mark = the farm's UNFIXED
 * PRICE RISK, and gives each one a human-confirmed, irreversible `lock_fixation`
 * affordance. Reserve lots have no "C" leg, so they are VISIBLY EXCLUDED — the
 * source view already filters to `regime = 'commodity'`, and the cockpit ALSO
 * drops any row that somehow arrives flagged `'reserve'` (belt-and-braces) and
 * states the rule on the surface.
 *
 * Pure presentational Server Component: it receives its data (resolved by the
 * page from the `pricing.ts` read ports) and the bound `lockFixationAction` as
 * props, and forwards the action to the per-row client lock island. No data
 * fetching, no client JS in the read surface.
 *
 * USD amounts render in a fixed `en-US` `$` (USD is the settlement currency — a
 * "C" leg is a USD/lb instrument), so the figure reads identically in either UI
 * language; only the labels translate.
 */

const USD0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function fmtKg(kg: number): string {
  return kg.toLocaleString("en-US");
}

export function FixationCockpit({
  exposure,
  iceC,
  action,
}: {
  exposure: FixationExposureRow[];
  iceC: IceCMark[];
  action: LockFixationAction;
}) {
  const t = useTranslations("hedge");

  // Belt-and-braces: the view is commodity-only, but never render a reserve row.
  const open = exposure.filter((r) => r.regime !== "reserve");

  const totalKg = open.reduce((sum, r) => sum + r.kg, 0);
  // Exposure sums only the rows with a live mark; a NULL-mark row is "unknown",
  // never counted as zero (a fabricated floor is the named anti-pattern).
  const totalExposure = open.reduce(
    (sum, r) => sum + (r.exposureUsd ?? 0),
    0,
  );
  const anyUnknown = open.some((r) => r.currentCPrice == null);

  // The "C" reference: prefer the mark for the month most of the open lots
  // reference, else the freshest mark on hand.
  const refMark = pickReferenceMark(open, iceC);

  return (
    <div className="space-y-6">
      {/* Headline strip — unfixed risk, count, volume, the live "C" reference. */}
      <div className="glass-card grid grid-cols-2 gap-px overflow-hidden rounded-2xl lg:grid-cols-4">
        <Tile
          label={t("summary.exposureLabel")}
          value={anyUnknown ? `${USD0.format(totalExposure)}+` : USD0.format(totalExposure)}
          sub={t("summary.exposureSub")}
          accent="cherry"
          icon={Gauge}
        />
        <Tile
          label={t("summary.openLabel")}
          value={String(open.length)}
          sub={
            open.length === 1
              ? t("summary.openSub", { count: open.length })
              : t("summary.openSubPlural", { count: open.length })
          }
          accent="forest"
          icon={Activity}
        />
        <Tile
          label={t("summary.kgLabel")}
          value={`${fmtKg(totalKg)} kg`}
          sub={t("summary.kgSub")}
          accent="coffee"
          icon={TrendingUp}
        />
        <Tile
          label={t("summary.refLabel")}
          value={refMark ? refMark.price.toFixed(2) : "—"}
          sub={
            refMark
              ? t("summary.refSub", {
                  month: refMark.contractMonth,
                  source: refMark.source,
                })
              : t("summary.refNone")
          }
          accent="honey"
          icon={Anchor}
        />
      </div>

      {/* The commodity-only rule, stated on the surface. */}
      <p className="flex items-center gap-2 text-xs font-medium text-muted-fg">
        <ShieldCheck className="h-4 w-4 text-forest" aria-hidden />
        {t("reserveNote")}
      </p>

      {open.length === 0 ? (
        <div className="glass-card rounded-2xl">
          <EmptyState
            icon={ShieldCheck}
            title={t("empty.title")}
            description={t("empty.description")}
          />
        </div>
      ) : (
        <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {open.map((row) => (
            <ExposureCard
              key={row.priceQuoteId}
              row={row}
              action={action}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** One open, un-fixed commodity reservation as a glass card with its lock affordance. */
function ExposureCard({
  row,
  action,
}: {
  row: FixationExposureRow;
  action: LockFixationAction;
}) {
  const t = useTranslations("hedge");
  const hasMark = row.currentCPrice != null;

  return (
    <div className="glass-card glass-hover perf-contain flex flex-col gap-4 rounded-2xl p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-display text-sm font-semibold text-ink">
            {row.greenLotCode}
          </p>
          <p className="mt-0.5 text-xs text-muted-fg">
            {t("card.monthLabel")} {row.iceCContractMonth}
          </p>
        </div>
        <Badge tone="coffee" dot>
          C
        </Badge>
      </div>

      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-muted-fg">{t("card.kgLabel")}</dt>
          <dd className="font-display text-sm font-semibold tabular-nums text-ink">
            {fmtKg(row.kg)} kg
          </dd>
        </div>
        <div>
          <dt className="text-muted-fg">{t("card.currentCLabel")}</dt>
          <dd className="font-display text-sm font-semibold tabular-nums text-ink">
            {hasMark ? (row.currentCPrice as number).toFixed(2) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-fg">{t("card.exposureLabel")}</dt>
          <dd className="font-display text-sm font-semibold tabular-nums text-ink">
            {row.exposureUsd != null ? USD0.format(row.exposureUsd) : "—"}
          </dd>
        </div>
      </dl>

      {!hasMark && (
        <p className="rounded-xl bg-honey-100/80 px-3 py-2 text-xs font-medium text-honey-700">
          {t("card.noMark")}
        </p>
      )}

      <div className="mt-auto flex justify-end pt-1">
        <LockFixationButton row={row} action={action} />
      </div>
    </div>
  );
}

/**
 * Pick the "C" reference mark to headline: the mark for the contract month the
 * most open lots reference, breaking ties by freshness, else the freshest mark.
 */
function pickReferenceMark(
  open: FixationExposureRow[],
  iceC: IceCMark[],
): IceCMark | null {
  if (iceC.length === 0) return null;

  const counts = new Map<string, number>();
  for (const r of open) {
    counts.set(
      r.iceCContractMonth,
      (counts.get(r.iceCContractMonth) ?? 0) + 1,
    );
  }

  const byFreshness = [...iceC].sort(
    (a, b) => Date.parse(b.asOf) - Date.parse(a.asOf),
  );

  if (counts.size > 0) {
    let best: IceCMark | null = null;
    let bestCount = -1;
    for (const mark of byFreshness) {
      const c = counts.get(mark.contractMonth) ?? 0;
      if (c > bestCount) {
        bestCount = c;
        best = mark;
      }
    }
    if (best && bestCount > 0) return best;
  }

  return byFreshness[0];
}
