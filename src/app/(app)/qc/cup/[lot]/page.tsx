import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { DossierShell } from "@/components/dossier/dossier-shell";
import { DossierSection } from "@/components/dossier/dossier-section";
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
  const t = await getTranslations("qc");

  const [genealogy, qcStatus, workers, defects] = await Promise.all([
    getLotGenealogy(lotCode).catch(() => ({ nodes: [], edges: [] })),
    getQcStatus().catch(() => []),
    getWorkers().catch(() => []),
    getGreenDefects(lotCode).catch(() => []),
  ]);

  // The ⌘K palette (and any hand-typed/injected URL) can route to /qc/cup/JC-999
  // even when no such green lot exists. A cuppable lot always has a v_qc_status
  // roll-up row; if there is none, there is no lot to cup — 404 rather than render
  // a fabricated scoresheet for an unknown code (review finding: qc-cup-notfound).
  const status = qcStatus.find((s) => s.greenLotCode === lotCode) ?? null;
  if (!status) {
    notFound();
  }

  const cuppers = workers.map((w) => ({ id: w.id, name: w.name }));

  return (
    <DossierShell
      kind="lot"
      title={t("cupPage.title", { lot: lotCode })}
      eyebrow={t("cupPage.eyebrow")}
      subtitle={t("cupPage.subtitle")}
      backHref="/qc"
      backLabel={t("cupPage.backLabel")}
    >
      {status?.held && (
        <QcHoldBanner lotCode={lotCode} reason={status.holdReason} />
      )}

      <DossierSection id="cupping" title={t("cupPage.sectionTitle")}>
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-6">
            <CuppingScoresheet lotCode={lotCode} cuppers={cuppers} />
            <DefectEntryForm lotCode={lotCode} defects={defects} />
          </div>
          <CupToCausePanel
            lotCode={lotCode}
            genealogy={genealogy}
            status={status}
          />
        </div>
      </DossierSection>
    </DossierShell>
  );
}
