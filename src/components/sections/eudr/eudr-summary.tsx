import Link from "next/link";
import { ShieldCheck, ShieldAlert, MapPin } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Tile } from "@/components/ui/tile";
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
          <Link
            key={lot.code}
            href={`/lots/${lot.code}#eudr`}
            data-testid={`eudr-lot-${lot.code}`}
            className="block rounded-2xl outline-none ring-forest/30 transition focus-visible:ring-2"
          >
            <Card className="h-full transition-transform hover:-translate-y-0.5">
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold text-ink">
                    {lot.code}
                  </span>
                  <EudrStatusBadge status={lot.status} />
                </div>
                <p className="text-xs text-muted-fg">
                  {lot.originPlots.length === 0
                    ? "No plots of origin traced"
                    : `${num(lot.originPlots.length)} ${
                        lot.originPlots.length === 1 ? "plot" : "plots"
                      } of origin`}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
