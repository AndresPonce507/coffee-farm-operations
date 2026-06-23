import { PageHeader } from "@/components/ui/page-header";
import { EudrSummary } from "@/components/sections/eudr/eudr-summary";

/**
 * EUDR — the "/eudr" route for Coffee Farm Operations (S8).
 *
 * EU Deforestation Regulation due diligence made visible: every green lot's
 * standing — geolocated plots of origin, declared deforestation-free since the
 * 2020-12-31 cutoff — with a drill-through to each lot's full dossier on
 * /lots/[code]. The buyer/auditor artifact that turns the S3 lot graph + S1 plot
 * geometry into a compliance story.
 *
 * Server Component (no client JS): all data flows from the eudr read port; the
 * eudr_lot_status RPC is the SSOT for each verdict. The app shell is provided by
 * (app)/layout.tsx; this page renders only its inner content.
 */
export default function EudrPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="EUDR"
        subtitle="Debida diligencia libre de deforestación — origen geolocalizado por lote verde"
      />

      <EudrSummary />
    </div>
  );
}
