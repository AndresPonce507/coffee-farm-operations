import { ShieldCheck, ShieldAlert, MapPin } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Tile } from "@/components/ui/tile";
import { EntityLink } from "@/components/ui/entity-link";
import { getEudrSummary } from "@/lib/db/eudr";
import { num } from "@/lib/utils";

import { EudrStatusBadge } from "./eudr-status-badge";

/**
 * EudrSummary — the /eudr overview: every green lot's EU Deforestation Regulation
 * standing at a glance, with a drill-through to each lot's full dossier.
 *
 * Server Component (no client JS): pulls every green lot's dossier (getEudrSummary
 * → the eudr_lot_status verdict + plots of origin per lot), then surfaces the
 * portfolio headline (how many lots are export-ready vs. need attention) and a
 * per-lot grid. Nothing here re-derives the verdict — the RPC is the SSOT.
 */
export async function EudrSummary() {
  const lots = await getEudrSummary();

  const compliant = lots.filter((l) => l.status === "compliant").length;
  const needsAttention = lots.length - compliant;

  if (lots.length === 0) {
    return (
      <Card data-testid="eudr-empty" className="animate-rise">
        <CardContent className="py-12 text-center text-sm text-muted-fg">
          No green lots yet. EUDR due-diligence dossiers appear here once a lot
          reaches the green stage.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="animate-rise overflow-hidden">
        <CardContent className="p-0">
          <div className="stagger grid grid-cols-1 divide-y divide-white/50 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <Tile
              label="Export-ready"
              value={num(compliant)}
              sub={`of ${num(lots.length)} green lots`}
              accent="forest"
              icon={ShieldCheck}
              className="glass-hover"
            />
            <Tile
              label="Needs attention"
              value={num(needsAttention)}
              sub="incomplete or unverified origin"
              accent="honey"
              icon={ShieldAlert}
              className="glass-hover"
            />
            <Tile
              label="Cutoff"
              value="2020"
              sub="deforestation-free since 2020-12-31"
              accent="coffee"
              icon={MapPin}
              className="glass-hover"
            />
          </div>
        </CardContent>
      </Card>

      <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {lots.map((lot) => (
          // Plain div — never wrap a card in <a> when its body also contains
          // <EntityLink> anchors (nested <a> in <a> is invalid HTML and breaks
          // both navigations). The lot code header carries its own discrete link.
          <div key={lot.code}>
            <Card className="h-full transition-transform hover:-translate-y-0.5">
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  {/*
                    Lot code → lot dossier link. This is the ONLY <a> for the
                    lot entity on this card, so plot EntityLinks below are safe
                    siblings (never descendants of this anchor).
                  */}
                  <span data-testid={`eudr-lot-${lot.code}`}>
                    <EntityLink
                      kind="lot"
                      id={lot.code}
                      anchor="eudr"
                      className="rounded font-mono text-sm font-semibold text-ink underline-offset-4 outline-none ring-forest/30 transition-colors hover:text-forest hover:underline focus-visible:ring-2"
                    >
                      {lot.code}
                    </EntityLink>
                  </span>
                  <EudrStatusBadge status={lot.status} />
                </div>
                {lot.originPlots.length === 0 ? (
                  <p
                    data-testid={`eudr-no-plots-${lot.code}`}
                    className="text-xs text-muted-fg"
                  >
                    No plots of origin traced
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {lot.originPlots.map((plot) => (
                      <span
                        key={plot.plotId}
                        data-testid={`eudr-origin-plot-${plot.plotId}`}
                      >
                        <EntityLink
                          kind="plot"
                          id={plot.plotId}
                          className="inline-block rounded px-1.5 py-0.5 text-xs font-medium text-forest ring-1 ring-forest/25 transition hover:bg-forest/10"
                        >
                          {plot.plotName}
                        </EntityLink>
                      </span>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        ))}
      </div>
    </div>
  );
}
