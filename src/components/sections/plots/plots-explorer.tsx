"use client";

import { useState } from "react";
import { MapPin, Sprout } from "lucide-react";

import { plots } from "@/lib/data/plots";
import type { CoffeeVariety, Plot, PlotStatus } from "@/lib/types";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Segmented } from "@/components/ui/segmented";
import { cn, kg, num, pct } from "@/lib/utils";

type ViewMode = "grid" | "list";
type VarietyFilter = "All" | CoffeeVariety;

type ProgressTone = "forest" | "honey" | "cherry" | "coffee" | "sky";

/** Status → badge tone + human label. */
const STATUS_META: Record<PlotStatus, { tone: BadgeTone; label: string }> = {
  healthy: { tone: "ok", label: "Healthy" },
  watch: { tone: "warn", label: "Watch" },
  "at-risk": { tone: "danger", label: "At risk" },
};

/** Drive the harvest progress fill off how far along the plot is. */
const PROGRESS_TONE: Record<PlotStatus, ProgressTone> = {
  healthy: "forest",
  watch: "honey",
  "at-risk": "cherry",
};

const VIEW_OPTIONS = [
  { id: "grid", label: "Grid" },
  { id: "list", label: "List" },
] as const;

function harvestPct(plot: Plot): number {
  if (plot.expectedYieldKg <= 0) return 0;
  return (plot.harvestedKg / plot.expectedYieldKg) * 100;
}

/** Unique varieties, preserving the order they appear in the data. */
function uniqueVarieties(): CoffeeVariety[] {
  const seen = new Set<CoffeeVariety>();
  const out: CoffeeVariety[] = [];
  for (const plot of plots) {
    if (!seen.has(plot.variety)) {
      seen.add(plot.variety);
      out.push(plot.variety);
    }
  }
  return out;
}

/* ----------------------------- Sub-views ----------------------------- */

interface FactProps {
  label: string;
  value: string;
}

function Fact({ label, value }: FactProps) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-fg">
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}

interface PlotCardProps {
  plot: Plot;
}

function PlotCard({ plot }: PlotCardProps) {
  const status = STATUS_META[plot.status];
  const progress = harvestPct(plot);

  return (
    <Card className="group glass-hover glass-sheen flex flex-col overflow-hidden">
      {/* Header band */}
      <div className="flex items-start justify-between gap-3 border-b border-white/50 bg-forest-100/50 px-5 pt-5 pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-fg">
            <MapPin className="h-3.5 w-3.5 text-forest-500" aria-hidden="true" />
            <span className="truncate">{plot.block}</span>
          </div>
          <h3 className="mt-1 truncate font-display text-lg font-semibold text-ink">
            {plot.name}
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge tone="forest">{plot.variety}</Badge>
            <Badge tone={status.tone} dot>
              {status.label}
            </Badge>
          </div>
        </div>
      </div>

      <CardContent className="flex flex-1 flex-col gap-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Fact label="Altitude" value={`${num(plot.altitudeMasl)} masl`} />
          <Fact label="Area" value={`${num(plot.areaHa, 1)} ha`} />
          <Fact label="Trees" value={num(plot.trees)} />
          <Fact label="Shade" value={pct(plot.shadePct)} />
        </dl>

        <div className="mt-auto">
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-fg">
              <Sprout className="h-3.5 w-3.5 text-forest-500" aria-hidden="true" />
              Harvest progress
            </span>
            <span className="font-display text-sm font-semibold text-ink">
              {pct(progress)}
            </span>
          </div>
          <ProgressBar value={progress} tone={PROGRESS_TONE[plot.status]} />
          <p className="mt-1.5 text-xs text-muted-fg">
            {kg(plot.harvestedKg)} of {kg(plot.expectedYieldKg)}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

interface PlotRowProps {
  plot: Plot;
}

function PlotRow({ plot }: PlotRowProps) {
  const status = STATUS_META[plot.status];
  const progress = harvestPct(plot);

  return (
    <div className="flex flex-col gap-3 px-5 py-4 transition-colors duration-200 hover:bg-white/45 sm:flex-row sm:items-center sm:gap-5">
      {/* Identity */}
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/60 bg-white/55 text-forest-500"
          aria-hidden="true"
        >
          <Sprout className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate font-display text-sm font-semibold text-ink">
            {plot.name}
          </p>
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-fg">
            <MapPin className="h-3 w-3" aria-hidden="true" />
            {plot.block}
          </p>
        </div>
      </div>

      {/* Variety + status */}
      <div className="flex shrink-0 items-center gap-1.5">
        <Badge tone="forest">{plot.variety}</Badge>
        <Badge tone={status.tone} dot>
          {status.label}
        </Badge>
      </div>

      {/* Quick facts */}
      <div className="hidden shrink-0 items-center gap-6 text-xs text-muted-fg lg:flex">
        <span>
          <span className="font-semibold text-ink">{num(plot.altitudeMasl)}</span> masl
        </span>
        <span>
          <span className="font-semibold text-ink">{num(plot.areaHa, 1)}</span> ha
        </span>
        <span>
          <span className="font-semibold text-ink">{num(plot.trees)}</span> trees
        </span>
        <span>
          <span className="font-semibold text-ink">{pct(plot.shadePct)}</span> shade
        </span>
      </div>

      {/* Harvest progress */}
      <div className="w-full shrink-0 sm:w-44">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="text-xs text-muted-fg">Harvest</span>
          <span className="font-display text-xs font-semibold text-ink">
            {pct(progress)}
          </span>
        </div>
        <ProgressBar value={progress} tone={PROGRESS_TONE[plot.status]} />
        <p className="mt-1 text-[11px] text-muted-fg">
          {kg(plot.harvestedKg)} / {kg(plot.expectedYieldKg)}
        </p>
      </div>
    </div>
  );
}

/* ----------------------------- Main ----------------------------- */

export function PlotsExplorer() {
  const [activeVariety, setActiveVariety] = useState<VarietyFilter>("All");
  const [view, setView] = useState<ViewMode>("grid");

  const varieties = uniqueVarieties();
  const filtered =
    activeVariety === "All"
      ? plots
      : plots.filter((plot) => plot.variety === activeVariety);

  return (
    <section className="animate-rise space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Filter plots by variety"
        >
          <Chip
            active={activeVariety === "All"}
            onClick={() => setActiveVariety("All")}
          >
            All
            <span className="ml-1.5 opacity-70">{plots.length}</span>
          </Chip>
          {varieties.map((variety) => {
            const count = plots.filter((p) => p.variety === variety).length;
            return (
              <Chip
                key={variety}
                active={activeVariety === variety}
                onClick={() => setActiveVariety(variety)}
              >
                {variety}
                <span className="ml-1.5 opacity-70">{count}</span>
              </Chip>
            );
          })}
        </div>

        <Segmented
          options={VIEW_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
          value={view}
          onChange={(id) => setView(id as ViewMode)}
          className="self-start sm:self-auto"
        />
      </div>

      {/* Result count */}
      <p className="text-sm text-muted-fg">
        Showing{" "}
        <span className="font-semibold text-ink">{filtered.length}</span>{" "}
        {filtered.length === 1 ? "plot" : "plots"}
        {activeVariety !== "All" && (
          <>
            {" "}
            of <span className="font-semibold text-ink">{activeVariety}</span>
          </>
        )}
        .
      </p>

      {/* Body */}
      {view === "grid" ? (
        <div className="stagger perf-contain grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((plot) => (
            <PlotCard key={plot.id} plot={plot} />
          ))}
        </div>
      ) : (
        <Card className={cn("cv-auto overflow-hidden")}>
          <div className="divide-y divide-white/50">
            {filtered.map((plot) => (
              <PlotRow key={plot.id} plot={plot} />
            ))}
          </div>
        </Card>
      )}
    </section>
  );
}
