import Link from "next/link";
import { Wind } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { getLots } from "@/lib/db/lots";
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
 * Server component: fetches the lot codes once (for the create/edit forms) and
 * composes the header (with the live "New batch" action) above the read-only
 * summary/pipeline and the editable batch table. The app shell (sidebar,
 * topbar, padded main) is provided by (app)/layout.tsx; this page renders only
 * its inner content.
 */
export default async function ProcessingPage() {
  const lots = await getLots();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Processing"
        subtitle="Wet mill, drying beds and green coffee"
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

      <BatchTable lots={lots} />
    </div>
  );
}
