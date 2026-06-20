import { PageHeader } from "@/components/ui/page-header";
import { ProcessingSummary } from "@/components/sections/processing/processing-summary";
import { StagePipeline } from "@/components/sections/processing/stage-pipeline";
import { BatchTable } from "@/components/sections/processing/batch-table";

/**
 * Processing — the "/processing" route for Coffee Farm Operations.
 *
 * Walks a lot from the wet mill through the drying beds to export-ready green
 * coffee: a strip of headline numbers (ProcessingSummary), the stage-by-stage
 * pipeline board (StagePipeline), then the full batch ledger (BatchTable).
 *
 * Pure server component — every section reads from canonical mock data and
 * requires no props or client-side state. The app shell (sidebar, topbar,
 * padded main) is provided by (app)/layout.tsx; this page renders only its
 * inner content.
 */
export default function ProcessingPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Processing"
        subtitle="Wet mill, drying beds and green coffee"
      />

      <ProcessingSummary />

      <StagePipeline />

      <BatchTable />
    </div>
  );
}
