import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, Boxes, Gauge, Scale, Sprout } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Tile } from "@/components/ui/tile";
import { num, pct } from "@/lib/utils";
import {
  getMillRunWorkspace,
  type MillRunBalance,
  type MillByproduct,
  type MillPass,
  type MillRunWorkspace,
} from "./data";
import { MassBalanceWorkspace } from "./mass-balance-workspace.client";

/**
 * /mill/[runId]/balance — the closed mass-balance + machine-chain workspace (P3-S8).
 *
 * Server Component. Resolves the run's full milling payload (header + the
 * mill_run_balance readout + the ordered pass chain + the byproduct ledger), 404s on
 * an unknown / non-numeric run id (a hand-typed URL or a stale link must never
 * fabricate a run). The page tells the whole transform story:
 *   • a Sankey-style mass-balance gauge — parchment splitting into green, byproduct,
 *     reject, moisture loss and (the footgun) the unaccounted residual — that reads
 *     forest-green BALANCED only when `balance_ok` (the "weight-loss mystery" killed
 *     at a glance; the database is the real wall, the gauge mirrors its verdict);
 *   • a horizontal machine-chain rail (huller → polisher → graders) one card per pass;
 *   • the byproduct ledger, each stream its own sellable, traceable lot.
 * The right rail is the one interactive island, <MassBalanceWorkspace>, where the
 * operator records the next machine pass / byproduct (a human clicks — no untrusted
 * inbound ever drives the write, rail §7).
 */

type MillT = Awaited<ReturnType<typeof getTranslations<"millBalance">>>;

type BalanceState = "ok" | "off" | "pending";

function balanceState(balance: MillRunBalance | null): BalanceState {
  if (!balance) return "pending";
  if (balance.balanceOk) return "ok";
  if (balance.greenOut == null) return "pending";
  return "off";
}

export default async function MillBalancePage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const t = await getTranslations("millBalance");

  const parsed = Number(decodeURIComponent(runId));
  const ws: MillRunWorkspace | null = Number.isInteger(parsed)
    ? await getMillRunWorkspace(parsed).catch(() => null)
    : null;
  if (!ws) {
    notFound();
  }

  const { run, balance, passes, byproducts } = ws;
  const state = balanceState(balance);
  const outturn = run.outturnPct;

  return (
    <div className="space-y-6">
      {/* back link to the mill shell */}
      <Link
        href="/mill"
        className="inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted-fg transition-colors hover:text-forest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t("back")}
      </Link>

      {/* header */}
      <div className="animate-rise relative mb-2 pb-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-fg">
          {t("page.eyebrow")}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
            {t("page.title")}
          </h1>
          <Badge tone="neutral" dot>
            {t(`status.${run.status}`)}
          </Badge>
          <BalanceBadge state={state} t={t} />
        </div>
        <p className="mt-1 text-sm text-muted-fg">
          {t("page.subtitle", { run: run.runId, lot: run.parchmentLotCode })}
        </p>
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-forest/30 via-line to-transparent"
        />
      </div>

      {/* KPI strip */}
      <div className="glass-card grid grid-cols-2 gap-px overflow-hidden rounded-2xl lg:grid-cols-4">
        <Tile
          label={t("summary.parchmentIn")}
          value={`${num(Math.round(run.parchmentKgIn))} kg`}
          sub={t("summary.parchmentInSub", { variety: run.variety ?? "—" })}
          accent="coffee"
          icon={Boxes}
        />
        <Tile
          label={t("summary.greenOut")}
          value={
            run.greenKgOut == null
              ? "—"
              : `${num(Math.round(run.greenKgOut))} kg`
          }
          sub={
            run.greenKgOut == null
              ? t("summary.greenOutPending")
              : t("summary.greenOutSub")
          }
          accent="forest"
          icon={Sprout}
        />
        <Tile
          label={t("summary.outturn")}
          value={outturn == null ? "—" : pct(outturn * 100)}
          sub={
            outturn == null
              ? t("summary.outturnPending")
              : t("summary.outturnSub")
          }
          accent="honey"
          icon={Gauge}
        />
        <Tile
          label={t("summary.byproducts")}
          value={`${num(Math.round(balance?.sumByproduct ?? 0))} kg`}
          sub={t("summary.byproductsSub")}
          accent="sky"
          icon={Scale}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <MassBalanceGauge
            balance={balance}
            parchmentIn={run.parchmentKgIn}
            state={state}
            t={t}
          />

          {/* machine-chain rail */}
          <section className="glass-card rounded-2xl p-5">
            <h2 className="font-display text-base font-semibold text-ink">
              {t("chain.title")}
            </h2>
            <p className="mt-0.5 text-xs text-muted-fg">{t("chain.subtitle")}</p>
            {passes.length === 0 ? (
              <EmptyState
                icon={Sprout}
                title={t("empty.title")}
                description={t("empty.description")}
                className="py-8"
              />
            ) : (
              <ol className="stagger mt-4 flex gap-3 overflow-x-auto pb-1">
                {passes.map((p, i) => (
                  <PassCard
                    key={p.passNo}
                    pass={p}
                    last={i === passes.length - 1}
                    t={t}
                  />
                ))}
              </ol>
            )}
          </section>

          {/* byproduct ledger */}
          <section className="glass-card rounded-2xl p-5">
            <h2 className="font-display text-base font-semibold text-ink">
              {t("byproducts.title")}
            </h2>
            <p className="mt-0.5 text-xs text-muted-fg">
              {t("byproducts.subtitle")}
            </p>
            {byproducts.length === 0 ? (
              <p className="mt-4 text-sm text-muted-fg">
                {t("byproducts.empty")}
              </p>
            ) : (
              <ul className="mt-4 space-y-2">
                {byproducts.map((b) => (
                  <ByproductRow key={b.byproductLotCode} byproduct={b} t={t} />
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* the one interactive island */}
        <MassBalanceWorkspace
          runId={run.runId}
          status={run.status}
          parchmentKgIn={run.parchmentKgIn}
          lastPassNo={passes.length === 0 ? 0 : passes[passes.length - 1].passNo}
          lastPassOutputKg={
            passes.length === 0 ? null : passes[passes.length - 1].outputKg
          }
        />
      </div>
    </div>
  );
}

function BalanceBadge({ state, t }: { state: BalanceState; t: MillT }) {
  const tone = state === "ok" ? "ok" : state === "off" ? "danger" : "warn";
  const label =
    state === "ok"
      ? t("balanceBadge.ok")
      : state === "off"
        ? t("balanceBadge.off")
        : t("balanceBadge.pending");
  return (
    <Badge tone={tone} dot>
      {label}
    </Badge>
  );
}

/* ───────────────────────── the Sankey mass-balance gauge ───────────────────── */

interface Segment {
  id: "green" | "byproduct" | "reject" | "moisture" | "unaccounted";
  kg: number;
  bar: string;
  dot: string;
  label: string;
}

function MassBalanceGauge({
  balance,
  parchmentIn,
  state,
  t,
}: {
  balance: MillRunBalance | null;
  parchmentIn: number;
  state: BalanceState;
  t: MillT;
}) {
  const greenKg = balance?.greenOut ?? 0;
  const byproductKg = balance?.sumByproduct ?? 0;
  const rejectKg = balance?.sumReject ?? 0;
  const moistureKg = balance?.accountedMoistureLoss ?? 0;
  const unaccountedKg = balance?.unaccountedLoss ?? parchmentIn;
  const ceilingKg = balance?.lossCeiling ?? 0;

  const segments: Segment[] = [
    {
      id: "green",
      kg: greenKg,
      bar: "bg-forest-500",
      dot: "bg-forest-500",
      label: t("sankey.green"),
    },
    {
      id: "byproduct",
      kg: byproductKg,
      bar: "bg-honey",
      dot: "bg-honey",
      label: t("sankey.byproduct"),
    },
    {
      id: "reject",
      kg: rejectKg,
      bar: "bg-cherry",
      dot: "bg-cherry",
      label: t("sankey.reject"),
    },
    {
      id: "moisture",
      kg: moistureKg,
      bar: "bg-sky",
      dot: "bg-sky",
      label: t("sankey.moisture"),
    },
    {
      id: "unaccounted",
      kg: Math.max(0, unaccountedKg),
      bar: state === "off" ? "bg-cherry-700" : "bg-line-strong",
      dot: state === "off" ? "bg-cherry-700" : "bg-line-strong",
      label: t("sankey.unaccounted"),
    },
  ];

  const width = (kg: number) =>
    parchmentIn > 0 ? Math.max(0, (kg / parchmentIn) * 100) : 0;

  const headline =
    state === "ok"
      ? t("sankey.balanced")
      : state === "off"
        ? t("sankey.unbalanced", {
            kg: num(Math.round(unaccountedKg)),
            ceiling: num(Math.round(ceilingKg)),
          })
        : t("sankey.pendingGreen");

  return (
    <section className="glass-card rounded-2xl p-5">
      <h2 className="font-display text-base font-semibold text-ink">
        {t("sankey.title")}
      </h2>
      <p className="mt-0.5 text-xs text-muted-fg">{t("sankey.subtitle")}</p>

      {/* the gauge proper: the proportional bar + the verdict headline */}
      <div
        data-testid="mass-balance-gauge"
        data-balance-ok={String(balance?.balanceOk === true)}
        className={
          "mt-4 rounded-2xl border p-4 transition-colors " +
          (state === "ok"
            ? "border-forest/25 bg-forest/[0.04]"
            : state === "off"
              ? "border-cherry/30 bg-cherry/[0.05]"
              : "border-line bg-paper/60")
        }
      >
        {/* the proportional flow bar */}
        <div
          className="flex h-5 w-full overflow-hidden rounded-full bg-muted ring-1 ring-line"
          role="img"
          aria-label={t("sankey.title")}
        >
          {segments.map((s) => (
            <div
              key={s.id}
              data-testid={`mass-segment-${s.id}`}
              className={s.bar}
              style={{ width: `${width(s.kg)}%` }}
              aria-label={`${s.label}: ${num(Math.round(s.kg))} kg`}
              title={`${s.label}: ${num(Math.round(s.kg))} kg`}
            />
          ))}
        </div>

        <p
          className={
            "mt-3 text-sm font-medium tabular-nums " +
            (state === "ok"
              ? "text-forest"
              : state === "off"
                ? "text-cherry-700"
                : "text-muted-fg")
          }
        >
          {headline}
        </p>
        {balance && state !== "pending" && (
          <p className="mt-0.5 text-xs tabular-nums text-muted-fg">
            {t("sankey.ceilingNote", { kg: num(Math.round(ceilingKg)) })}
          </p>
        )}
      </div>

      {/* legend — OUTSIDE the gauge testid so the verdict copy stays unambiguous */}
      <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {segments.map((s) => (
          <li key={s.id} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden
              className={"h-2.5 w-2.5 shrink-0 rounded-full " + s.dot}
            />
            <span className="text-muted-fg">{s.label}</span>
            <span className="ml-auto font-medium tabular-nums text-ink">
              {t("sankey.kgValue", { kg: num(Math.round(s.kg)) })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ───────────────────────────── machine-chain rail ──────────────────────────── */

function PassCard({
  pass,
  last,
  t,
}: {
  pass: MillPass;
  last: boolean;
  t: MillT;
}) {
  return (
    <li
      data-testid={`mill-pass-${pass.passNo}`}
      className="relative flex min-w-[10.5rem] flex-col rounded-xl border border-line bg-paper/70 p-3"
    >
      <div className="flex items-center justify-between">
        <span className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-fg">
          {t("chain.pass", { no: pass.passNo })}
        </span>
        {!last && (
          <span aria-hidden className="text-muted-fg/70">
            →
          </span>
        )}
      </div>
      <p className="mt-1 font-display text-sm font-semibold text-ink">
        {t(`machine.${pass.machineKind}`)}
      </p>
      <dl className="mt-2 space-y-0.5 text-xs tabular-nums">
        <div className="flex justify-between gap-2">
          <dt className="text-muted-fg">{t("chain.inLabel")}</dt>
          <dd className="text-ink">{num(Math.round(pass.inputKg))} kg</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-fg">{t("chain.outLabel")}</dt>
          <dd className="font-medium text-forest">{num(Math.round(pass.outputKg))} kg</dd>
        </div>
        {pass.rejectKg > 0 && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted-fg">{t("chain.rejectLabel")}</dt>
            <dd className="text-cherry-700">{num(Math.round(pass.rejectKg))} kg</dd>
          </div>
        )}
      </dl>
    </li>
  );
}

/* ───────────────────────────── byproduct ledger ────────────────────────────── */

function ByproductRow({
  byproduct,
  t,
}: {
  byproduct: MillByproduct;
  t: MillT;
}) {
  return (
    <li
      data-testid={`byproduct-${byproduct.byproductLotCode}`}
      className="flex items-center justify-between gap-3 rounded-xl bg-paper/70 px-3 py-2.5"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">
          {t(`byproductKind.${byproduct.kind}`)}
        </p>
        <p className="text-xs tabular-nums text-muted-fg">
          {byproduct.byproductLotCode}
        </p>
      </div>
      <Badge tone="honey">
        {t("byproducts.kgValue", { kg: num(Math.round(byproduct.kg)) })}
      </Badge>
    </li>
  );
}
