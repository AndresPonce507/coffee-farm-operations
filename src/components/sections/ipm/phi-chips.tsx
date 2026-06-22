import { Clock, ShieldCheck, TimerReset } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { EntityLink } from "@/components/ui/entity-link";
import type { PlotPhiStatus } from "@/lib/types";

/**
 * PhiChips — the per-plot PHI/REI countdown strip (P2-S12).
 *
 * Pure Server Component: a chip per plot with an active pre-harvest (PHI) or
 * re-entry (REI) interval. PHI-active means a pick CANNOT be scheduled inside the
 * window (the harvest planner reads the same v_plot_phi_status); REI-active means a
 * worker must not enter. A cleared plot shows a green "safe" state. The window is
 * visible everywhere, so safety is never a surprise.
 */
export function PhiChips({ rows }: { rows: PlotPhiStatus[] }) {
  const active = rows.filter((r) => r.phiActive || r.reiActive);
  if (active.length === 0) {
    return (
      <Card className="animate-rise">
        <CardContent>
          <EmptyState
            icon={ShieldCheck}
            title="No active PHI/REI windows"
            description="Every plot is clear to pick and safe to enter — no spray interval is currently open."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {active.map((r) => (
        <Card
          key={r.plotId}
          data-testid={`phi-${r.plotId}`}
          className="glass-hover animate-rise"
        >
          <CardContent className="flex items-center gap-3 py-3">
            <div className="min-w-0">
              <p className="truncate font-display text-sm font-semibold text-ink">
                <EntityLink
                  kind="plot"
                  id={r.plotId}
                  className="rounded outline-none transition-colors hover:text-forest-700 focus-visible:ring-2 focus-visible:ring-forest-200"
                >
                  {r.plotName}
                </EntityLink>
              </p>
              <p className="truncate text-[11px] text-muted-fg">{r.product}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {r.phiActive ? (
                <Badge tone="danger" className="inline-flex items-center gap-1 whitespace-nowrap">
                  <Clock className="h-3 w-3" aria-hidden /> PHI until {r.phiClearsOn}
                </Badge>
              ) : null}
              {r.reiActive ? (
                <Badge tone="warn" className="inline-flex items-center gap-1 whitespace-nowrap">
                  <TimerReset className="h-3 w-3" aria-hidden /> REI active
                </Badge>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
