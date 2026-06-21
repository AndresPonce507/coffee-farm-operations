import { Clock, Droplets, SprayCan, TimerReset, User } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { num } from "@/lib/utils";
import type { SprayLogEntry } from "@/lib/types";

/**
 * SprayHistory — the append-only spray log (P2-S12).
 *
 * Pure Server Component: a row per logged application, each showing the product +
 * active ingredient, the plot, the (necessarily certified) applicator, and the
 * stamped PHI/REI windows. The log is evidence — append-only at the data layer — so
 * every spray that ever happened is here, immutably, with its safety intervals.
 */
export function SprayHistory({ rows }: { rows: SprayLogEntry[] }) {
  if (rows.length === 0) {
    return (
      <Card data-testid="spray-empty" className="animate-rise">
        <CardContent>
          <EmptyState
            icon={SprayCan}
            title="No sprays logged yet"
            description="A spray can only be logged by a certified applicator — once one is, it appears here immutably with its PHI/REI windows."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="stagger space-y-2">
      {rows.map((r) => (
        <Card key={r.id} className="glass-hover animate-rise overflow-hidden">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="truncate font-display text-sm font-semibold text-ink">
                {r.product}
                {r.activeIngredient ? (
                  <span className="ml-2 text-xs font-normal text-muted-fg">
                    {r.activeIngredient}
                  </span>
                ) : null}
              </p>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-fg">
                <span className="inline-flex items-center gap-1">
                  <Droplets className="h-3 w-3" aria-hidden /> {r.plotName}
                </span>
                <span className="inline-flex items-center gap-1">
                  <User className="h-3 w-3" aria-hidden /> {r.workerName}
                </span>
                <span>{r.appliedAt.slice(0, 10)}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className="inline-flex items-center gap-1 rounded-full border border-white/60 bg-white/55 px-2 py-0.5 font-medium text-muted-fg">
                <Clock className="h-3 w-3" aria-hidden /> PHI {num(r.phiDays)}d
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-white/60 bg-white/55 px-2 py-0.5 font-medium text-muted-fg">
                <TimerReset className="h-3 w-3" aria-hidden /> REI {num(r.reiHours)}h
              </span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
