import { Bug, CheckCircle2, ListTodo, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { num } from "@/lib/utils";
import type { IpmThresholdStatus } from "@/lib/types";

/**
 * ScoutingBoard — the IPM scouting board (P2-S12).
 *
 * Pure Server Component (no client JS): a glass card per (plot, pest) latest
 * scouting read, showing the observed incidence against the published economic
 * action threshold and the evidence-driven recommend/hold call. Above-threshold →
 * a prominent RECOMMEND-CONTROL state (and the fired board task); below → HOLD &
 * monitor. The call is legible and earned, never a vague alert.
 *
 * World-class: glass-lite cards, AA contrast, tone-coded by the recommendation,
 * no motion beyond the shared stagger-in (reduced-motion safe).
 */
export function ScoutingBoard({ rows }: { rows: IpmThresholdStatus[] }) {
  if (rows.length === 0) {
    return (
      <Card data-testid="scouting-empty" className="animate-rise">
        <CardContent>
          <EmptyState
            icon={Bug}
            title="No plots scouted yet"
            description="Log a broca or roya scouting read and the economic-threshold engine surfaces a recommend-or-hold call here — and fires a control task when it crosses."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2">
      {rows.map((r) => {
        const known = r.threshold !== null;
        return (
          <Card
            key={`${r.plotId}-${r.pestKind}`}
            data-testid={`scouting-${r.plotId}-${r.pestKind}`}
            className="glass-hover animate-rise overflow-hidden"
          >
            <CardContent className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-display text-base font-semibold text-ink">
                    {r.plotName}
                  </h3>
                  <p className="mt-0.5 inline-flex items-center gap-1 text-xs capitalize text-muted-fg">
                    <Bug className="h-3.5 w-3.5" aria-hidden /> {r.pestKind}
                  </p>
                </div>
                {r.recommend ? (
                  <Badge tone="danger" className="inline-flex items-center gap-1 whitespace-nowrap">
                    <ShieldAlert className="h-3 w-3" aria-hidden /> Recommend control
                  </Badge>
                ) : (
                  <Badge tone="forest" className="inline-flex items-center gap-1 whitespace-nowrap">
                    <CheckCircle2 className="h-3 w-3" aria-hidden /> Hold &amp; monitor
                  </Badge>
                )}
              </div>

              <div className="flex items-baseline justify-between rounded-lg border border-white/60 bg-white/50 px-3 py-2">
                <div>
                  <p className="font-display text-2xl font-bold tabular-nums text-ink">
                    {num(r.incidencePct)}%
                  </p>
                  <p className="text-[11px] text-muted-fg">observed incidence</p>
                </div>
                <div className="text-right">
                  <p className="font-display text-sm font-semibold tabular-nums text-muted-fg">
                    {known ? `${num(r.threshold as number)}%` : "—"}
                  </p>
                  <p className="text-[11px] text-muted-fg">
                    {known ? "action threshold" : "no threshold (unknown pest)"}
                  </p>
                </div>
              </div>

              {r.firedTaskId ? (
                <p className="inline-flex items-center gap-1.5 text-xs font-medium text-cherry">
                  <ListTodo className="h-3.5 w-3.5" aria-hidden /> Control task fired to the board
                </p>
              ) : (
                <p className="text-xs italic text-muted-fg">
                  Below threshold — monitoring, no intervention warranted.
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
