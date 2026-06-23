import { getBatches } from "@/lib/db/processing";
import { getFermentBatches } from "@/lib/db/ferment";
import { Badge } from "@/components/ui/badge";
import type { BadgeTone } from "@/components/ui/badge";
import { EntityLink } from "@/components/ui/entity-link";
import { ProgressBar } from "@/components/ui/progress-bar";
import { cn, kg, pct } from "@/lib/utils";
import type { BatchStage, ProcessMethod, ProcessingBatch } from "@/lib/types";

/**
 * StagePipeline — the processing kanban board (centerpiece of the Processing page).
 *
 * Server component: pure presentation over the static `batches` mock set. No hooks,
 * no handlers — the board is horizontally scrollable on narrow viewports and the six
 * pipeline stages each get a subtle, distinct accent so the eye can track a lot's
 * journey from cherry to green.
 */

/** Stage order across the wet mill → drying → green pipeline. */
const STAGE_ORDER: BatchStage[] = [
  "cherry",
  "fermentation",
  "drying",
  "parchment",
  "milled",
  "green",
];

/** Human-friendly column titles. */
const STAGE_LABEL: Record<BatchStage, string> = {
  cherry: "Cherry",
  fermentation: "Fermentation",
  drying: "Drying",
  parchment: "Parchment",
  milled: "Milled",
  green: "Green",
};

/** One-line description of what happens at each stage — quiet context under the title. */
const STAGE_SUB: Record<BatchStage, string> = {
  cherry: "Intake & sorting",
  fermentation: "Tanks & beds",
  drying: "Raised beds / patio",
  parchment: "Resting in pergamino",
  milled: "Hulled & graded",
  green: "Export-ready",
};

/**
 * Per-stage accent classes. Every value is a full literal class string so Tailwind's
 * static scanner can see them — never interpolate token fragments into a class name.
 */
interface StageAccent {
  /** Column surface tint. */
  column: string;
  /** Header underline / rail. */
  rail: string;
  /** Small dot beside the stage title. */
  dot: string;
  /** Tone for the count badge. */
  countTone: BadgeTone;
  /** Tone for the per-batch progress bar. */
  progressTone: "forest" | "honey" | "cherry" | "coffee" | "sky";
}

const STAGE_ACCENT: Record<BatchStage, StageAccent> = {
  cherry: {
    column: "bg-cherry-100/40",
    rail: "bg-cherry",
    dot: "bg-cherry",
    countTone: "cherry",
    progressTone: "cherry",
  },
  fermentation: {
    column: "bg-honey-100/50",
    rail: "bg-honey",
    dot: "bg-honey",
    countTone: "honey",
    progressTone: "honey",
  },
  drying: {
    column: "bg-sky-100/50",
    rail: "bg-sky",
    dot: "bg-sky",
    countTone: "sky",
    progressTone: "sky",
  },
  parchment: {
    column: "bg-coffee-200/30",
    rail: "bg-coffee-400",
    dot: "bg-coffee-400",
    countTone: "coffee",
    progressTone: "coffee",
  },
  milled: {
    column: "bg-forest-100/50",
    rail: "bg-forest-500",
    dot: "bg-forest-500",
    countTone: "forest",
    progressTone: "forest",
  },
  green: {
    column: "bg-forest-100",
    rail: "bg-forest",
    dot: "bg-forest",
    countTone: "ok",
    progressTone: "forest",
  },
};

/** Tone mapping for processing-method pills. */
const METHOD_TONE: Record<ProcessMethod, BadgeTone> = {
  Washed: "sky",
  Natural: "cherry",
  Honey: "honey",
  Anaerobic: "coffee",
};

/** Moisture is only meaningful once a batch is on the beds (drying onward). */
const SHOW_MOISTURE: Record<BatchStage, boolean> = {
  cherry: false,
  fermentation: false,
  drying: true,
  parchment: true,
  milled: true,
  green: true,
};

/**
 * The single lot furthest along the pipeline — the hero of the board. It earns the
 * one specular sheen sweep in this file (the lot closest to export-ready green).
 */
function heroBatchId(batches: ProcessingBatch[]): string | undefined {
  return batches.reduce<ProcessingBatch | null>(
    (lead, b) => (lead === null || b.progressPct > lead.progressPct ? b : lead),
    null,
  )?.id;
}

function BatchTile({
  batch,
  heroId,
  fermentId,
}: {
  batch: ProcessingBatch;
  heroId: string | undefined;
  /** ferment_batches UUID for this lot, or undefined when no ferment run exists. */
  fermentId: string | undefined;
}) {
  const accent = STAGE_ACCENT[batch.stage];
  const showMoisture = SHOW_MOISTURE[batch.stage];
  const isHero = batch.id === heroId;

  return (
    <article
      className={cn(
        "glass-card glass-hover rounded-xl p-3.5",
        isHero && "glass-sheen",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <EntityLink
          kind="lot"
          id={batch.lotCode}
          name={batch.lotCode}
          className="font-mono text-sm font-semibold tracking-tight text-ink underline-offset-2 outline-none transition-colors hover:text-forest hover:underline focus-visible:text-forest focus-visible:underline"
        >
          {batch.lotCode}
        </EntityLink>
        <span className="shrink-0 text-xs text-muted-fg">{batch.patio}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge tone="forest">{batch.variety}</Badge>
        <Badge tone={METHOD_TONE[batch.method]}>{batch.method}</Badge>
      </div>

      <dl className="mt-3 flex items-end justify-between gap-2">
        <div>
          <dt className="text-[0.7rem] uppercase tracking-wide text-muted-fg">
            Weight
          </dt>
          <dd className="font-display text-base font-semibold text-ink">
            {kg(batch.currentKg)}
          </dd>
        </div>
        {showMoisture && (
          <div className="text-right">
            <dt className="text-[0.7rem] uppercase tracking-wide text-muted-fg">
              Moisture
            </dt>
            <dd className="text-sm font-medium text-coffee">
              {pct(batch.moisturePct)}
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-[0.7rem] text-muted-fg">
          <span>Pipeline</span>
          <span className="font-medium text-ink">{pct(batch.progressPct)}</span>
        </div>
        <ProgressBar
          value={batch.progressPct}
          tone={accent.progressTone}
          className="h-1.5"
        />
      </div>

      {fermentId !== undefined && (
        <div className="mt-2.5 flex justify-end">
          <EntityLink
            kind="batch"
            id={fermentId}
            className="rounded-md px-2 py-0.5 text-[0.68rem] font-medium text-muted-fg ring-1 ring-inset ring-white/40 transition-colors hover:bg-white/30 hover:text-ink focus-visible:text-ink focus-visible:ring-forest/60"
          >
            Ver lote →
          </EntityLink>
        </div>
      )}
    </article>
  );
}

function StageColumn({
  stage,
  batches,
  heroId,
  fermentMap,
}: {
  stage: BatchStage;
  batches: ProcessingBatch[];
  heroId: string | undefined;
  /** lotCode → ferment_batches UUID. Used to resolve the "Ver lote →" href. */
  fermentMap: ReadonlyMap<string, string>;
}) {
  const accent = STAGE_ACCENT[stage];
  const items = batches.filter((b) => b.stage === stage);

  return (
    <section
      className={cn(
        "flex min-w-[230px] flex-1 flex-col rounded-2xl border border-white/60 p-3 shadow-[0_8px_24px_-12px_rgba(31,41,37,0.18)]",
        accent.column
      )}
      aria-label={`${STAGE_LABEL[stage]} stage`}
    >
      <header className="px-1 pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className={cn("h-2 w-2 rounded-full", accent.dot)}
              aria-hidden="true"
            />
            <h3 className="font-display text-sm font-semibold text-ink">
              {STAGE_LABEL[stage]}
            </h3>
          </div>
          <Badge tone={accent.countTone}>{items.length}</Badge>
        </div>
        <p className="mt-1 pl-4 text-xs text-muted-fg">{STAGE_SUB[stage]}</p>
        <div
          className={cn("mt-2 h-0.5 w-full rounded-full opacity-60", accent.rail)}
        />
      </header>

      <div className="cv-auto flex flex-col gap-2.5">
        {items.length > 0 ? (
          items.map((b) => (
            <BatchTile
              key={b.id}
              batch={b}
              heroId={heroId}
              fermentId={fermentMap.get(b.lotCode)}
            />
          ))
        ) : (
          <p className="rounded-xl border border-dashed border-white/60 bg-white/40 px-3 py-6 text-center text-xs text-muted-fg">
            No lots in this stage
          </p>
        )}
      </div>
    </section>
  );
}

export async function StagePipeline() {
  const [batches, fermentBatches] = await Promise.all([
    getBatches(),
    getFermentBatches(),
  ]);

  // Map lotCode → ferment_batches UUID so each BatchTile can link to the correct
  // /ferment/[uuid] route. processing_batches.id is a slug, NOT the ferment UUID.
  const fermentMap = new Map(fermentBatches.map((fb) => [fb.lotCode, fb.id]));

  const heroId = heroBatchId(batches);

  return (
    <div className="animate-rise">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">
            Processing pipeline
          </h2>
          <p className="text-sm text-muted-fg">
            Every active lot, from cherry intake to export-ready green coffee.
          </p>
        </div>
        <span className="hidden shrink-0 text-xs text-muted-fg sm:block">
          {batches.length} lots in process
        </span>
      </div>

      <div className="-mx-1 overflow-x-auto px-1 pb-2">
        <div className="stagger perf-contain flex min-w-max gap-3">
          {STAGE_ORDER.map((stage) => (
            <StageColumn
              key={stage}
              stage={stage}
              batches={batches}
              heroId={heroId}
              fermentMap={fermentMap}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
