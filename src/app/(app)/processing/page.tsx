import Link from "next/link";
import { Coffee, Wind } from "lucide-react";

import { EntityLink } from "@/components/ui/entity-link";
import { PageHeader } from "@/components/ui/page-header";
import { getLots } from "@/lib/db/lots";
import { getDryingLots } from "@/lib/db/drying";
import { ProcessingSummary } from "@/components/sections/processing/processing-summary";
import { StagePipeline } from "@/components/sections/processing/stage-pipeline";
import { BatchTable } from "@/components/sections/processing/batch-table";
import { AddBatchButton } from "@/components/sections/processing/batch-actions";

/**
 * Processing — the "/processing" route for Coffee Farm Operations.
 *
 * Walks a lot from the wet mill through the drying beds to export-ready green
 * coffee: a strip of headline numbers (ProcessingSummary), the stage-by-stage
 * pipeline board (StagePipeline), then the full, editable batch ledger
 * (BatchTable).
 *
 * Server component: fetches the lot codes once (for the create/edit forms) plus
 * the composed per-lot drying read, and composes the header (with the live
 * "New batch" action) above the read-only summary/pipeline and the editable
 * batch table. The app shell (sidebar, topbar, padded main) is provided by
 * (app)/layout.tsx; this page renders only its inner content.
 *
 * Per-lot drying deep-links (review finding #107): S4 consolidated the per-lot
 * drying detail into the /drying board's cards rather than building a separate
 * `/process/[lot]/drying` route. To keep the drill-in a manager expects from
 * this overview — and parity with /ferment, which deep-links each batch — we
 * surface the lots currently resting as a compact chip strip, each a link into
 * that lot's full detail surface (/lots/[code]). No new route, no duplicated
 * board: just the missing deep-link affordance.
 */
export default async function ProcessingPage() {
  const [lots, dryingLots] = await Promise.all([getLots(), getDryingLots()]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Beneficio"
        subtitle="Beneficio húmedo, camas de secado y café verde"
      >
        <Link
          href="/drying"
          className="inline-flex items-center gap-1.5 rounded-full border border-white/60 bg-white/55 px-3.5 py-2 text-sm font-medium text-forest-600 transition-colors hover:border-white/80 hover:bg-white/75 hover:text-forest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-300"
        >
          <Wind aria-hidden className="h-4 w-4" />
          Drying &amp; reposo
        </Link>
        <AddBatchButton lots={lots} />
      </PageHeader>

      <ProcessingSummary />

      <StagePipeline />

      {dryingLots.length > 0 && (
        <section
          aria-label="Resting lots — open a lot's drying detail"
          className="rounded-2xl border border-white/55 bg-white/45 px-4 py-3"
        >
          <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-fg">
            <Wind aria-hidden className="h-3.5 w-3.5" />
            Resting lots
            <span className="font-normal normal-case tracking-normal text-muted-fg/80">
              · open one to see its moisture curve and reposo gate
            </span>
          </div>
          <ul className="flex flex-wrap gap-2">
            {dryingLots.map((lot) => (
              <li
                key={lot.lotCode}
                data-testid="resting-lot-link"
                data-ready={lot.reposo.ready ? "true" : "false"}
                title={`Open lot ${lot.lotCode} — ${lot.reposo.reason}`}
              >
                <EntityLink
                  kind="lot"
                  id={lot.lotCode}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/60 bg-white/60 px-3 py-1.5 text-xs font-semibold text-forest-600 transition-colors hover:border-white/80 hover:bg-white/80 hover:text-forest"
                >
                  <Coffee aria-hidden className="h-3.5 w-3.5 text-honey-700" />
                  {lot.lotCode}
                  <span
                    aria-hidden
                    className={
                      lot.reposo.ready
                        ? "h-1.5 w-1.5 rounded-full bg-forest"
                        : "h-1.5 w-1.5 rounded-full bg-cherry"
                    }
                  />
                </EntityLink>
              </li>
            ))}
          </ul>
        </section>
      )}

      <BatchTable lots={lots} />
    </div>
  );
}
