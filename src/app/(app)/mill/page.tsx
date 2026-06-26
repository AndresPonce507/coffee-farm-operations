import { getTranslations } from "next-intl/server";
import {
  CheckCircle2,
  CircleSlash,
  Cog,
  Factory,
  Sprout,
  Wheat,
} from "lucide-react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Tile } from "@/components/ui/tile";
import { num, pct, shortDate } from "@/lib/utils";
import {
  getMillBoard,
  getMillChain,
  type MillLotRow,
  type MillMachine,
} from "./data";
import { MillGate } from "./mill-gate.client";

/**
 * /mill — the dry-mill board (P3-S7 mill readiness + run skeleton).
 *
 * Server Component. Three reads compose the board: the chain registry
 * (`mill_machines`), every parchment lot's pipeline state (`v_mill_readiness` ⨝
 * `v_milling_runs` ⨝ `v_reposo_status`), and the candidate lots for the gate. The
 * keystone is rendered honestly: a lot that is not rested-and-in-spec reads "Gate
 * closed" with the EXACT reason it is blocked — never "ready", never "milling". The
 * one interactive surface is the <MillGate> spec-gate launcher; opening a run is
 * blocked at the database (open_milling_run raises) and mirrored disabled here.
 */

type MillT = Awaited<ReturnType<typeof getTranslations<"mill">>>;

type GateState = "finalized" | "milling" | "ready" | "blocked";

function gateState(lot: MillLotRow): GateState {
  if (lot.run?.status === "finalized") return "finalized";
  if (lot.run?.status === "open") return "milling";
  if (lot.run == null && lot.readiness?.passed) return "ready";
  return "blocked";
}

const STATE_TONE: Record<GateState, BadgeTone> = {
  finalized: "forest",
  milling: "honey",
  ready: "sky",
  blocked: "neutral",
};

export default async function MillPage() {
  const t = await getTranslations("mill");
  const [chain, board] = await Promise.all([getMillChain(), getMillBoard()]);

  const cleared = board.filter(
    (r) => r.run == null && r.readiness?.passed,
  ).length;
  const open = board.filter((r) => r.run?.status === "open").length;
  const finalized = board.filter((r) => r.run?.status === "finalized").length;

  // The gate composes a NEW run, so only lots without a run yet are candidates.
  const gateLots = board.filter((r) => r.run == null);

  return (
    <div className="space-y-6">
      <PageHeader title={t("page.title")} subtitle={t("page.subtitle")}>
        <MillGate lots={gateLots} />
      </PageHeader>

      {/* Summary strip — chain depth + the live gate funnel. */}
      <div className="glass-card grid grid-cols-2 gap-px overflow-hidden rounded-2xl lg:grid-cols-4">
        <Tile
          label={t("summary.stages")}
          value={num(chain.length)}
          sub={t("summary.stagesSub")}
          accent="coffee"
          icon={Factory}
        />
        <Tile
          label={t("summary.cleared")}
          value={num(cleared)}
          sub={t("summary.clearedSub")}
          accent="sky"
          icon={CheckCircle2}
        />
        <Tile
          label={t("summary.open")}
          value={num(open)}
          sub={t("summary.openSub")}
          accent="honey"
          icon={Cog}
        />
        <Tile
          label={t("summary.finalized")}
          value={num(finalized)}
          sub={t("summary.finalizedSub")}
          accent="forest"
          icon={Sprout}
        />
      </div>

      {/* The dry-mill chain registry — five stages, parchment to export green. */}
      <ChainRegistry machines={chain} t={t} />

      {board.length === 0 ? (
        <EmptyState
          icon={Wheat}
          title={t("empty.title")}
          description={t("empty.description")}
        />
      ) : (
        <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {board.map((lot) => (
            <LotCard key={lot.parchmentLotCode} lot={lot} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function ChainRegistry({ machines, t }: { machines: MillMachine[]; t: MillT }) {
  return (
    <section className="glass-card rounded-2xl p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-base font-semibold text-ink">
          {t("chain.title")}
        </h2>
        <p className="text-xs text-muted-fg">{t("chain.subtitle")}</p>
      </div>

      {machines.length === 0 ? (
        <p className="mt-3 text-sm text-muted-fg">{t("chain.empty")}</p>
      ) : (
        <ol className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {machines.map((m) => (
            <li
              key={m.id}
              className="rounded-xl border border-forest/10 bg-paper/70 px-3 py-3"
            >
              <span className="grid h-8 w-8 place-items-center rounded-lg border border-white/50 bg-coffee-200/40 text-coffee shadow-sm">
                <Cog className="h-4 w-4" aria-hidden />
              </span>
              <p className="mt-2 text-sm font-medium text-ink">{m.name}</p>
              <p className="text-[0.6875rem] tabular-nums text-muted-fg">
                {t("chain.hours", { hours: num(m.hoursRun) })}
              </p>
              <p className="text-[0.6875rem] text-muted-fg">
                {m.calibrationDue == null
                  ? t("chain.calibrationOk")
                  : t("chain.calibrationDue", {
                      date: shortDate(m.calibrationDue),
                    })}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function LotCard({ lot, t }: { lot: MillLotRow; t: MillT }) {
  const state = gateState(lot);
  const { readiness, run, reposoReady } = lot;
  // The auditor-honest gate note appears only when the gate is NOT yet clear and no
  // run exists — telling the operator EXACTLY what is missing (never a blank verdict).
  const showGateNote = run == null && !readiness?.passed;

  return (
    <div
      data-testid={`mill-lot-${lot.parchmentLotCode}`}
      className="glass-card perf-contain rounded-2xl p-5"
    >
      {/* Header: lot code + gate-state badge */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-base font-semibold text-ink">
            {lot.parchmentLotCode}
          </p>
          {run && (
            <p className="text-xs tabular-nums text-muted-fg">
              {t("card.run", { id: num(run.runId) })}
            </p>
          )}
        </div>
        <Badge tone={STATE_TONE[state]} dot>
          {t(`status.${state}`)}
        </Badge>
      </div>

      {/* Reposo (upstream) clearance */}
      <div className="mt-4 rounded-xl bg-paper/70 px-3 py-2">
        <div className="flex items-center gap-1.5">
          {reposoReady ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-forest" aria-hidden />
          ) : (
            <CircleSlash className="h-3.5 w-3.5 text-muted-fg" aria-hidden />
          )}
          <p className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
            {t("card.reposo")}
          </p>
        </div>
        <p className="mt-0.5 text-sm text-ink">
          {lot.reposoReason ??
            (lot.latestMoisture == null
              ? "—"
              : `${num(lot.latestMoisture, 1)}%`)}
        </p>
      </div>

      {/* Spec reading */}
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-sm text-ink">
          {readiness == null
            ? t("card.noReading")
            : t("card.reading", {
                moisture: num(readiness.moisturePct, 1),
                aw: num(readiness.waterActivityAw, 2),
              })}
        </p>
        {readiness && (
          <Badge tone={readiness.passed ? "ok" : "danger"}>
            {readiness.passed ? t("card.passed") : t("card.failed")}
          </Badge>
        )}
      </div>

      {/* Run outcome (finalized → green outturn) */}
      {run && (
        <div className="mt-3 rounded-xl border border-forest/15 bg-forest/[0.04] px-3 py-2.5">
          <p className="text-xs font-medium text-forest tabular-nums">
            {t("card.kgIn", { kg: num(run.parchmentKgIn) })}
          </p>
          {run.outturnPct != null && run.greenKgOut != null && (
            <p className="mt-0.5 text-xs text-muted-fg tabular-nums">
              {t("card.outturn", {
                out: num(run.greenKgOut),
                pct: pct(run.outturnPct * 100),
              })}
            </p>
          )}
        </div>
      )}

      {/* The keystone, told honestly: WHY this lot cannot open a run yet. */}
      {showGateNote && (
        <p className="mt-3 text-xs text-muted-fg">{t("card.gateNote")}</p>
      )}
    </div>
  );
}
