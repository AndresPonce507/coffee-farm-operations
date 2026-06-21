import { GitBranch, Sparkles } from "lucide-react";

import type { LotGenealogy, QcStatus } from "@/lib/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { kg } from "@/lib/utils";

/**
 * CupToCausePanel — the cup-to-cause context that sits BESIDE the scoresheet
 * (P2-S6). A cup score is only as useful as the cause it can be tied to; this panel
 * shows the lineage that produced the lot — the stages it passed through, its
 * variety, and (when present) its defect tallies — so the cupper sees WHY it tastes
 * how it does, the make-quality loop closed.
 *
 * Server Component. Ferment curves and drying curves ship in sibling slices (S3/S4)
 * — this panel reads whatever lineage exists today and DEGRADES GRACEFULLY: an
 * absent stage is simply not shown, never a fabricated cause. When there is no
 * lineage at all, an honest empty state appears.
 */

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
}: {
  lotCode: string;
  genealogy: LotGenealogy;
  status: QcStatus | null;
}) {
  const stages = orderedStages(genealogy);
  const variety = stages[0]?.variety;

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
                    <span className="font-mono text-xs text-muted-fg">{s.code}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-fg tabular-nums">
                    {kg(s.currentKg)}
                  </p>
                </li>
              ))}
            </ol>

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
