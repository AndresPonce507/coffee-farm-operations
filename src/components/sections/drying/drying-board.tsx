import Link from "next/link";
import { Coffee, MapPin } from "lucide-react";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { EntityLink } from "@/components/ui/entity-link";
import { ReposoGateChip } from "./reposo-gate-chip";
import { MoistureCurve } from "./moisture-curve";
import { cn, kg } from "@/lib/utils";
import type { DryingLot } from "@/lib/types";

/**
 * DryingBoard — the per-lot resting view. Each lot in/through drying gets a glass
 * card carrying its moisture curve (converging on the 10.5–11.5% reposo band), its
 * station, and THE REPOSO GATE CHIP — red "resting · N days · 11.8%" until the lot
 * is rest-stable, then green "clear to mill". Until the gate opens the
 * advance-to-mill affordance is shown as a DISABLED button carrying the gate's
 * exact reason — courtesy only: the gate is enforced in the database (the
 * precondition inside advance_processing_stage + the trigger backstop on `lots`),
 * so a milled advance is physically impossible until the lot is rest-stable.
 *
 * Once rest-stable, the affordance becomes an HONEST navigable control — a Link
 * to /processing, where the wired AdvanceStageControl island performs the real
 * drying→milled advance (the shared Dialog confirm + stable idempotency key). We
 * deliberately do NOT render an enabled primary button here: this is a Server
 * Component with no handler, so a clickable button would be an inert, misleading
 * CTA. The working advance path already lives one route over, so we link to it.
 *
 * Server component (no client JS): pure presentation over the composed read.
 */
export function DryingBoard({ lots }: { lots: DryingLot[] }) {
  const blocked = lots.filter((l) => !l.reposo.ready).length;
  const ready = lots.length - blocked;

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Resting lots · the reposo gate</CardTitle>
        <div className="flex items-center gap-2">
          {ready > 0 && <Badge tone="ok" dot>{ready} clear to mill</Badge>}
          {blocked > 0 && <Badge tone="cherry" dot>{blocked} resting</Badge>}
        </div>
      </CardHeader>

      <div className="px-5 pb-5 pt-3">
        {lots.length === 0 ? (
          <EmptyState
            title="No lots resting yet"
            description="Lots appear here once they reach the drying stage and start their reposo rest."
          />
        ) : (
          <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {lots.map((lot) => (
              <li
                key={lot.lotCode}
                data-testid="drying-lot-card"
                data-ready={lot.reposo.ready ? "true" : "false"}
                className={cn(
                  "rounded-2xl border p-4 transition-shadow",
                  "shadow-[0_2px_10px_-6px_rgba(0,41,29,0.25)]",
                  lot.reposo.ready
                    ? "border-forest-100 bg-forest-100/40"
                    : "border-white/55 bg-white/55",
                )}
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <EntityLink
                      kind="lot"
                      id={lot.lotCode}
                      name={lot.lotCode}
                      className="flex items-center gap-1.5 font-display text-base font-bold tracking-tight text-ink rounded-sm outline-none transition-colors hover:text-forest-700 focus-visible:ring-2 focus-visible:ring-forest/40"
                    >
                      <Coffee aria-hidden className="h-4 w-4 text-honey-700" />
                      {lot.lotCode}
                    </EntityLink>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-fg">
                      {lot.variety && <span>{lot.variety}</span>}
                      {lot.currentKg != null && (
                        <span className="tabular-nums">{kg(lot.currentKg)}</span>
                      )}
                      {lot.stationName && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin aria-hidden className="h-3 w-3" />
                          {lot.stationName}
                        </span>
                      )}
                    </p>
                  </div>
                  <ReposoGateChip reposo={lot.reposo} />
                </div>

                <MoistureCurve curve={lot.curve} height={140} />

                {/* The advance-to-mill affordance. Blocked: a disabled button
                    carrying the gate's reason (DB is the real gate; this is
                    courtesy). Rest-stable: an HONEST Link to /processing, where
                    the wired AdvanceStageControl performs the real advance — never
                    an enabled primary button with no handler in this server view. */}
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-[11px] text-muted-fg">{lot.reposo.reason}</p>
                  {lot.reposo.ready ? (
                    <Link
                      href="/processing"
                      title="Advance this lot to milling on the Processing surface"
                      aria-label={`Advance lot ${lot.lotCode} to milling`}
                      className={cn(
                        "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
                        "bg-forest text-paper hover:bg-forest-600",
                        "outline-none focus-visible:ring-2 focus-visible:ring-forest/40",
                      )}
                    >
                      Advance to mill →
                    </Link>
                  ) : (
                    <button
                      type="button"
                      disabled
                      aria-disabled
                      title={`Blocked by the reposo gate: ${lot.reposo.reason}`}
                      className={cn(
                        "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
                        "cursor-not-allowed bg-muted text-muted-fg",
                      )}
                    >
                      Mill — locked
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
