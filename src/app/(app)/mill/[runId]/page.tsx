import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  ArrowLeft,
  CheckCircle2,
  Coffee,
  Gauge,
  Scale,
  Sprout,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Tile, type TileAccent } from "@/components/ui/tile";
import { num, pct } from "@/lib/utils";
import {
  getMillRunFinalize,
  type MillBalance,
  type MillRunFinalizeView,
  type MillRunStatus,
} from "./data";
import { scaPrepTone } from "./grade";
import { FinalizePanel, RegradePanel } from "./finalize-panel.client";

/**
 * /mill/[runId] — the finalize milling surface (P3-S9, the green→bag keystone).
 *
 * Server Component. Resolves one milling run, 404s on an unknown / non-numeric id
 * (never a fabricated run). The page is the closed-mass-balance CONFIRMATION + the mint:
 *   • the left rail server-renders the closed-outturn mass balance with an unmistakable
 *     balanced/unbalanced verdict (the spike's "weight-loss mystery" made visible);
 *   • the right rail routes on status — the FinalizePanel form for an OPEN run, the
 *     minted-green-lot result + a re-grade island for a FINALIZED run, and a blocked
 *     empty-state when the reposo / spec readiness gate has not cleared.
 * The mint itself (mass-conserving green node + COGS post) is the database's job; the
 * UI surfaces the verdict and gates the irreversible write behind a human confirm.
 */

const STATUS_TONE: Record<MillRunStatus, "honey" | "sky" | "forest"> = {
  readiness_pending: "honey",
  open: "sky",
  finalized: "forest",
};

type MillT = Awaited<ReturnType<typeof getTranslations<"millFinalize">>>;

export default async function FinalizeRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const id = Number(runId);
  if (!Number.isInteger(id) || id <= 0) {
    notFound();
  }

  const t = await getTranslations("millFinalize");
  const view = await getMillRunFinalize(id).catch(() => null);
  if (!view) {
    notFound();
  }

  const subtitle =
    view.status === "finalized"
      ? t("page.subtitleFinalized")
      : view.status === "open"
        ? t("page.subtitleOpen")
        : t("page.subtitlePending");

  return (
    <div className="space-y-6">
      <Link
        href="/mill"
        className="inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted-fg transition-colors hover:text-forest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t("page.back")}
      </Link>

      {/* header */}
      <div className="animate-rise relative mb-2 pb-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-fg">
          {t("page.eyebrow")}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
            {t("page.title", { run: view.runId })}
          </h1>
          <Badge tone={STATUS_TONE[view.status]} dot>
            {t(`status.${view.status}`)}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-fg">
          {t("page.parchmentLot", { lot: view.parchmentLotCode })}
          {view.variety ? ` · ${view.variety}` : ""}
        </p>
        <p className="mt-0.5 text-xs text-muted-fg">{subtitle}</p>
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent"
        />
      </div>

      {/* KPI strip */}
      <div className="glass-card grid grid-cols-2 gap-px overflow-hidden rounded-2xl lg:grid-cols-4">
        <Tile
          label={t("summary.parchmentIn")}
          value={`${num(Math.round(view.parchmentKgIn))} kg`}
          accent="coffee"
          icon={Coffee}
        />
        <Tile
          label={t("summary.greenOut")}
          value={greenOutLabel(view)}
          accent="forest"
          icon={Sprout}
        />
        <Tile
          label={t("summary.outturn")}
          value={outturnLabel(view)}
          accent="honey"
          icon={Gauge}
        />
        <Tile
          label={t("summary.status")}
          value={t(`status.${view.status}`)}
          accent={statusTileAccent(view.status)}
          icon={Scale}
        />
      </div>

      {view.status === "readiness_pending" ? (
        <EmptyState
          icon={Scale}
          title={t("empty.pendingTitle")}
          description={t("empty.pendingDescription")}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <MassBalanceCard balance={view.balance} t={t} />
          {view.status === "finalized" ? (
            <FinalizedResult view={view} t={t} />
          ) : (
            <FinalizePanel view={view} />
          )}
        </div>
      )}
    </div>
  );
}

function greenOutLabel(view: MillRunFinalizeView): string {
  const g = view.greenKgOut ?? view.balance?.greenOut ?? null;
  return g == null ? "—" : `${num(Math.round(g))} kg`;
}

function outturnLabel(view: MillRunFinalizeView): string {
  const o =
    view.outturnPct ??
    (view.balance?.greenOut != null && view.parchmentKgIn > 0
      ? view.balance.greenOut / view.parchmentKgIn
      : null);
  return o == null ? "—" : pct(o * 100);
}

function statusTileAccent(status: MillRunStatus): TileAccent {
  return status === "finalized" ? "forest" : status === "open" ? "sky" : "honey";
}

/* ───────────────────────────── mass balance ───────────────────────────── */

function MassBalanceCard({
  balance,
  t,
}: {
  balance: MillBalance | null;
  t: MillT;
}) {
  return (
    <section
      data-testid="mass-balance"
      className="glass-card rounded-2xl p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-base font-semibold text-ink">
          {t("balance.title")}
        </h2>
        {balance && (
          <Badge tone={balance.balanceOk ? "forest" : "cherry"} dot>
            {balance.balanceOk
              ? t("balance.balancedTag")
              : t("balance.unbalancedTag")}
          </Badge>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-fg">{t("balance.subtitle")}</p>

      {!balance ? (
        <p className="mt-4 text-sm text-muted-fg">{t("balance.noData")}</p>
      ) : (
        <>
          <BalanceBar balance={balance} />

          <dl className="mt-4 space-y-1.5 text-sm">
            <BalanceRow
              label={t("balance.parchmentIn")}
              kg={balance.parchmentIn}
              strong
              t={t}
            />
            <BalanceRow
              label={t("balance.greenOut")}
              kg={balance.greenOut ?? 0}
              tone="text-forest"
              t={t}
            />
            <BalanceRow
              label={t("balance.byproduct")}
              kg={balance.sumByproduct}
              tone="text-honey-700"
              t={t}
            />
            <BalanceRow
              label={t("balance.reject")}
              kg={balance.sumReject}
              tone="text-coffee"
              t={t}
            />
            <BalanceRow
              label={t("balance.moistureLoss")}
              kg={balance.accountedMoistureLoss}
              tone="text-muted-fg"
              t={t}
            />
            <div className="flex items-baseline justify-between border-t border-line pt-1.5">
              <dt
                className={
                  balance.balanceOk ? "text-muted-fg" : "font-medium text-cherry"
                }
              >
                {t("balance.unaccounted")}
              </dt>
              <dd
                className={
                  "tabular-nums " +
                  (balance.balanceOk ? "text-ink" : "font-semibold text-cherry")
                }
              >
                {t("balance.kg", { kg: num(round1(balance.unaccountedLoss)) })}
                <span className="ml-1 text-xs text-muted-fg">
                  / {t("balance.kg", { kg: num(round1(balance.lossCeiling)) })}
                </span>
              </dd>
            </div>
          </dl>

          <p
            className={
              "mt-3 flex items-start gap-1.5 text-xs " +
              (balance.balanceOk ? "text-forest" : "text-cherry")
            }
          >
            {balance.balanceOk && (
              <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            )}
            <span>
              {balance.balanceOk
                ? t("balance.balancedNote")
                : t("balance.unbalancedNote")}
            </span>
          </p>
        </>
      )}
    </section>
  );
}

function BalanceBar({ balance }: { balance: MillBalance }) {
  const total = balance.parchmentIn > 0 ? balance.parchmentIn : 1;
  const seg = (v: number) => `${Math.max(0, Math.min(100, (v / total) * 100))}%`;
  const loss =
    balance.accountedMoistureLoss + Math.max(0, balance.unaccountedLoss);
  return (
    <div
      aria-hidden
      className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-line/60"
    >
      <span className="h-full bg-forest" style={{ width: seg(balance.greenOut ?? 0) }} />
      <span className="h-full bg-honey-700/80" style={{ width: seg(balance.sumByproduct) }} />
      <span className="h-full bg-coffee/70" style={{ width: seg(balance.sumReject) }} />
      <span className="h-full bg-muted-fg/30" style={{ width: seg(loss) }} />
    </div>
  );
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function BalanceRow({
  label,
  kg,
  tone,
  strong,
  t,
}: {
  label: string;
  kg: number;
  tone?: string;
  strong?: boolean;
  t: MillT;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={strong ? "font-medium text-ink" : "text-muted-fg"}>{label}</dt>
      <dd className={"tabular-nums " + (tone ?? "text-ink")}>
        {t("balance.kg", { kg: num(round1(kg)) })}
      </dd>
    </div>
  );
}

/* ───────────────────────────── finalized result ───────────────────────────── */

function FinalizedResult({
  view,
  t,
}: {
  view: MillRunFinalizeView;
  t: MillT;
}) {
  const code = view.mintedGreenLotCode;
  const band = view.grade?.scaPrep ?? null;
  return (
    <div
      data-testid="finalize-result"
      className="glass-card glass-forest rounded-2xl p-5"
    >
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-5 w-5 text-forest" aria-hidden />
        <h2 className="font-display text-base font-semibold text-ink">
          {t("result.title")}
        </h2>
      </div>

      {code ? (
        <p className="mt-2 text-sm text-ink">
          {view.outturnPct == null
            ? t("result.mintedNoPct", { code })
            : t("result.mintedLine", {
                code,
                pct: pct(view.outturnPct * 100),
              })}
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted-fg">{t("result.title")}</p>
      )}

      {band && (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted-fg">
          <span>{t("result.gradeLabel")}</span>
          <Badge tone={scaPrepTone(view.grade!.scaPrep as never)}>
            {t(`grade.prep.${band}`)}
          </Badge>
        </p>
      )}
      <p className="mt-1 text-xs text-muted-fg">{t("result.costLine")}</p>

      {code && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link
            href={`/lots/${encodeURIComponent(code)}`}
            className="inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-forest transition-colors hover:text-forest-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
          >
            <Sprout className="h-4 w-4" aria-hidden />
            {t("result.viewLot")}
          </Link>
          <RegradePanel greenLotCode={code} />
        </div>
      )}
    </div>
  );
}
