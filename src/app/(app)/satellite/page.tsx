import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/ui/page-header";
import { SatelliteBoard } from "@/components/sections/satellite/satellite-board";

/**
 * Satellite — the "/satellite" route for Coffee Farm Operations (P2-S12).
 *
 * Per-plot vegetation health from a fusion of optical (Sentinel-2 NDVI/NDRE) and
 * cloud-penetrating SAR (Sentinel-1) reads, each carrying an HONEST confidence
 * badge that survives Volcán's near-daily cloud — a SAR-carried "radar · medium" or
 * an "honestly unknown" low is surfaced plainly, never hidden behind a blank. The
 * differentiator over any generic NDVI tool here.
 *
 * Server Component (no client JS on the page): all data flows from the
 * remote-sensing read port (v_plot_vegetation). The app shell is provided by
 * (app)/layout.tsx; this page renders only its inner content.
 */
export default async function SatellitePage() {
  const t = await getTranslations("satellite");
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("page.title")}
        subtitle={t("page.subtitle")}
      />
      <SatelliteBoard />
    </div>
  );
}
