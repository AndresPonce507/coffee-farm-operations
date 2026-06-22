import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { CuppingScoresheet } from "@/components/sections/qc/cupping-scoresheet";
import { CupToCausePanel } from "@/components/sections/qc/cup-to-cause-panel";
import { DefectEntryForm } from "@/components/sections/qc/defect-entry-form";
import { QcHoldBanner } from "@/components/sections/qc/qc-hold-banner";
import { getLotGenealogy } from "@/lib/db/lots";
import { getGreenDefects, getQcStatus } from "@/lib/db/qc";
import { getWorkers } from "@/lib/db/workers";

/**
 * /qc/cup/[lot] — cup a green lot on the SCA CVA / legacy scoresheet, RIGHT BESIDE
 * the cup-to-cause panel that shows WHY it tastes how it does (P2-S6).
 *
 * Server Component. It awaits, in parallel: the green lot's lineage (the cup-to-
 * cause context — ferment/drying stages ship in sibling slices, so the panel
 * degrades gracefully to whatever lineage exists today), the per-lot QC status (to
 * surface a prominent QC-HOLD banner if the lot is quarantined), and the cupper
 * roster (to attribute the session). The scoresheet is the one interactive island;
 * everything else renders server-side. The closed cup-to-cause loop: a score bound
 * forever to the lot, ferment, drying, and plot that produced it.
 */

// Cuppers are workers in a tasting role; in the practice data any worker can cup,
// so we offer the full roster (the SQL FK is cupper_id → workers.id).
export default async function CuppingPage({
  params,
}: {
  params: Promise<{ lot: string }>;
}) {
  const { lot } = await params;
  const lotCode = decodeURIComponent(lot);

  const [genealogy, qcStatus, workers, defects] = await Promise.all([
    getLotGenealogy(lotCode).catch(() => ({ nodes: [], edges: [] })),
    getQcStatus().catch(() => []),
    getWorkers().catch(() => []),
    getGreenDefects(lotCode).catch(() => []),
  ]);

  const status = qcStatus.find((s) => s.greenLotCode === lotCode) ?? null;
  const cuppers = workers.map((w) => ({ id: w.id, name: w.name }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cupping"
        subtitle="Score the cup — and see exactly what produced it"
      >
        <Link
          href="/qc"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white/60 px-3 py-2 text-sm font-medium text-ink transition hover:border-forest-300 hover:text-forest-700"
        >
          <ArrowLeft className="h-4 w-4" />
          All QC
        </Link>
      </PageHeader>

      {status?.held && (
        <QcHoldBanner lotCode={lotCode} reason={status.holdReason} />
      )}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <CuppingScoresheet lotCode={lotCode} cuppers={cuppers} />
          <DefectEntryForm lotCode={lotCode} defects={defects} />
        </div>
        <CupToCausePanel lotCode={lotCode} genealogy={genealogy} status={status} />
      </div>
    </div>
  );
}
