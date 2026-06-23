import { GitBranch, Mountain, Sparkles } from "lucide-react";

import type { LotGenealogy, MoistureReading, QcStatus } from "@/lib/types";
import type { FermentCurvePoint } from "@/lib/db/ferment";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { EntityLink } from "@/components/ui/entity-link";
import { FermentCurve } from "@/components/sections/ferment/ferment-curve";
import { MoistureCurve } from "@/components/sections/drying/moisture-curve";
import { kg } from "@/lib/utils";

/**
 * CupToCausePanel — the cup-to-cause context that sits BESIDE the scoresheet
 * (P2-S6). A cup score is only as useful as the cause it can be tied to; this panel
 * closes the make-quality loop: beside the score the cupper sees WHY it tastes how
 * it does — the lineage that produced the lot, its variety, its green-grading
 * defects, AND (now that S3/S4 are on main) the exact FERMENT CURVE, the DRYING
 * MOISTURE CURVE, and the masl PLOT that produced it.
 *
 * Server Component. Each cause stream is an OPTIONAL prop the page resolves with a
 * graceful .catch and passes in. The panel DEGRADES HONESTLY: a stream that is
 * genuinely absent is simply omitted — never a fabricated cause. When there is no
 * lineage at all, an honest empty state appears.
 */

/** The minimal plot identity the cup-to-cause loop surfaces: a name + elevation.
 *  `id` (when known) makes the plot a dossier link to `/plots/[id]` — the cup-to-
 *  cause loop's clickable anchor (Phase-5 L3 wire-up). Optional so a plot resolved
 *  by name-only still renders honestly (as plain text) rather than a broken link. */
export interface CupCausePlot {
  id?: string;
  name: string;
  altitudeMasl: number;
}

const STAGE_ORDER = [
  "cherry",
  "fermentation",
  "drying",
  "parchment",
  "milled",
  "green",
] as const;

function orderedStages(genealogy: LotGenealogy): { code: string; stage: string; variety: string; currentKg: number }[] {
  return [...genealogy.nodes]
    .sort((a, b) => {
      const ai = STAGE_ORDER.indexOf(a.stage as (typeof STAGE_ORDER)[number]);
      const bi = STAGE_ORDER.indexOf(b.stage as (typeof STAGE_ORDER)[number]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    })
    .map((n) => ({
      code: n.code,
      stage: String(n.stage),
      variety: n.variety,
      currentKg: n.currentKg,
    }));
}

export function CupToCausePanel({
  lotCode,
  genealogy,
  status,
  fermentCurve,
  moistureCurve,
  plot,
}: {
  lotCode: string;
  genealogy: LotGenealogy;
  status: QcStatus | null;
  /** The ferment pH series for the lot's fermentation stage (v_ferment_curve). */
  fermentCurve?: FermentCurvePoint[] | null;
  /** The lot's drying moisture series, oldest → newest (moisture_readings). */
  moistureCurve?: MoistureReading[] | null;
  /** The originating plot + its elevation (harvests.plot_id → plots.altitude_masl). */
  plot?: CupCausePlot | null;
}) {
  const stages = orderedStages(genealogy);
  const variety = stages[0]?.variety;

  // Each cause stream is shown ONLY when it carries real data — never fabricated.
  const hasFerment = (fermentCurve?.length ?? 0) > 0;
  const hasMoisture = (moistureCurve?.length ?? 0) > 0;
  const hasPlot = plot != null;

  return (
    <Card className="animate-rise">
      <CardHeader>
        <div>
          <CardTitle>Cup-to-cause</CardTitle>
          <CardDescription>
            What produced <span className="font-mono text-forest-700">{lotCode}</span>{" "}
            — the lineage behind the score
          </CardDescription>
        </div>
        <Sparkles className="h-5 w-5 text-honey-700" aria-hidden />
      </CardHeader>

      <CardContent className="space-y-4 pt-4">
        {stages.length === 0 ? (
          <EmptyState
            icon={GitBranch}
            title="No lineage data yet"
            description="This lot's farm-to-green genealogy isn't available yet — the score still binds to the lot, and the cause fills in as ferment and drying are logged."
          />
        ) : (
          <>
            {variety && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-fg">
                  Variety
                </span>
                <Badge tone="forest" dot>
                  {variety}
                </Badge>
              </div>
            )}

            {/* The masl plot that produced it — the cup-to-cause loop's anchor:
                "the 1,650 masl plot that produced it." Omitted, never invented,
                when the originating plot can't be resolved. */}
            {hasPlot && (
              <div className="flex items-center gap-2">
                <Mountain className="h-4 w-4 text-forest-600" aria-hidden />
                <span className="text-sm text-ink">
                  Plot{" "}
                  {plot.id ? (
                    <EntityLink
                      kind="plot"
                      id={plot.id}
                      name={`${plot.id} ${plot.name}`}
                      className="font-medium text-forest-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
                    >
                      {plot.name}
                    </EntityLink>
                  ) : (
                    <span className="font-medium text-forest-700">{plot.name}</span>
                  )}
                  {" — "}
                  <span className="tabular-nums">
                    {plot.altitudeMasl.toLocaleString("en-US")} masl
                  </span>
                </span>
              </div>
            )}

            {/* The stage chain — the make-quality path the cup walked. */}
            <ol className="relative space-y-3 border-l border-line/70 pl-5">
              {stages.map((s) => (
                <li key={s.code} className="relative">
                  <span
                    aria-hidden
                    className="absolute -left-[1.45rem] top-1.5 h-2.5 w-2.5 rounded-full bg-forest-300 ring-2 ring-paper"
                  />
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium capitalize text-ink">
                      {s.stage}
                    </span>
                    <EntityLink
                      kind="lot"
                      id={s.code}
                      name={s.code}
                      className="font-mono text-xs text-muted-fg underline-offset-4 transition-colors hover:text-forest-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
                    >
                      {s.code}
                    </EntityLink>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-fg tabular-nums">
                    {kg(s.currentKg)}
                  </p>
                </li>
              ))}
            </ol>

            {/* The ferment curve that produced it — "the exact ferment curve"
                (P2-S6). The reused FermentCurve SVG is zero-JS server-rendered. */}
            {hasFerment && (
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-fg">
                  Ferment curve (pH)
                </p>
                <FermentCurve points={fermentCurve!} targetPh={null} kind="ph" />
              </div>
            )}

            {/* The drying curve that produced it — "the exact drying curve"
                (P2-S6). The reused MoistureCurve converges on the reposo band. */}
            {hasMoisture && (
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-fg">
                  Drying moisture curve
                </p>
                <MoistureCurve curve={moistureCurve!} height={140} />
              </div>
            )}

            {/* Defect context — the green-grading signal the cup sits alongside. */}
            {status && (
              <div className="rounded-2xl border border-white/60 bg-white/55 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-fg">
                  Green-grading defects
                </p>
                <div className="mt-1 flex items-center gap-4 text-sm">
                  <span className="tabular-nums">
                    <span
                      className={
                        status.primaryDefects > 0
                          ? "font-semibold text-cherry"
                          : "font-semibold text-ink"
                      }
                    >
                      {status.primaryDefects}
                    </span>{" "}
                    <span className="text-muted-fg">primary</span>
                  </span>
                  <span className="tabular-nums">
                    <span className="font-semibold text-ink">
                      {status.secondaryDefects}
                    </span>{" "}
                    <span className="text-muted-fg">secondary</span>
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
