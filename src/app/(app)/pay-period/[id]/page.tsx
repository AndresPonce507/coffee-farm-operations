import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { DossierShell } from "@/components/dossier/dossier-shell";
import { PayPeriodSummarySection } from "@/components/sections/pay-period/pay-period-summary-section";
import { PayPeriodLinesSection } from "@/components/sections/pay-period/pay-period-lines-section";
import { PayPeriodMakeWholeSection } from "@/components/sections/pay-period/pay-period-make-whole-section";
import { PayPeriodDisbursementsSection } from "@/components/sections/pay-period/pay-period-disbursements-section";
import { statusLabelEs } from "@/components/sections/pay-period/labels";
import {
  getPayPeriodById,
  getDisbursementsForPeriod,
} from "@/lib/db/payroll";
import { getPayPeriodPayLines } from "@/lib/db/dossier/pay-period";

/**
 * /pay-period/[id] — the per-period PAYROLL DOSSIER (Phase 5 R4, facet-02 §5/§11).
 *
 * Server Component. Resolves the period ANCHOR first (the existence gate, P2) and
 * 404s on an unknown id — never a fabricated period — BEFORE any section fetch.
 * Then fans the section reads out in parallel (P3) and renders through
 * <DossierShell> + four <…Section> server components (P4):
 *   1. Resumen — the window + status + the Σ gross/net/make-whole roll-up (the
 *      computed totals DRILL to the editable source pay lines).
 *   2. Líneas de pago — every worker's line, each linking to BOTH the /workers/[id]
 *      AND /crew/[id] dossier (the connectivity spine, P6).
 *   3. Ajuste al mínimo legal — only the workers the legal-floor guard lifted, each
 *      linking to their dossier (the people-first invariant made legible).
 *   4. Pagos registrados — the append-only disbursement ledger, each payment
 *      linking its worker to their dossier.
 *
 * Cross-entity links (KPI ≥4 per dossier): every pay line → worker + crew, every
 * made-whole row → worker, every disbursement → worker — many more than four for
 * any real period. The disbursement ledger stores only worker ids, so the page
 * resolves a workerId→name map from the (already-fetched) pay lines and hands it
 * down — no extra read. No src/lib/data/* import (P5); loading.tsx skeleton +
 * per-section empty states (P7). es-PA-first.
 */
export default async function PayPeriodDossierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("payPeriod");

  // P2 — anchor existence gate: resolve the period with ONE getter, 404 if absent.
  const period = await getPayPeriodById(id);
  if (!period) notFound();

  // P3 — fan the section reads out in parallel (all cache()'d getters).
  const [lines, disbursements] = await Promise.all([
    getPayPeriodPayLines(id),
    getDisbursementsForPeriod(id),
  ]);

  // The ledger carries only worker ids; resolve names from the pay lines so each
  // payment can show + link the person (no fabricated name, no extra read).
  const workerNames: Record<string, string> = {};
  for (const line of lines) workerNames[line.workerId] = line.workerName;

  return (
    <DossierShell
      kind="pay-period"
      title={`${period.periodStart} → ${period.periodEnd}`}
      eyebrow={t("page.eyebrow")}
      subtitle={`${
        period.season ? t("page.seasonPrefix", { season: period.season }) : ""
      }${period.workerCount} ${
        period.workerCount === 1
          ? t("page.subtitleWorkerOne")
          : t("page.subtitleWorkerOther")
      } · ${statusLabelEs(period.status)}`}
      backHref="/payroll"
      backLabel={t("page.backLabel")}
    >
      <PayPeriodSummarySection period={period} />
      <PayPeriodLinesSection lines={lines} />
      <PayPeriodMakeWholeSection lines={lines} />
      <PayPeriodDisbursementsSection
        disbursements={disbursements}
        workerNames={workerNames}
      />
    </DossierShell>
  );
}
