import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { DossierShell } from "@/components/dossier/dossier-shell";
import { DispatchRunSection } from "@/components/sections/dispatch/dispatch-run-section";
import { DispatchAssignmentsSection } from "@/components/sections/dispatch/dispatch-assignments-section";
import { DispatchAckSection } from "@/components/sections/dispatch/dispatch-ack-section";
import { DispatchLifecycleSection } from "@/components/sections/dispatch/dispatch-lifecycle-section";
import { getDispatchRunDossier } from "@/lib/db/dossier/dispatch";

/**
 * /dispatch/[id] — the morning-dispatch RUN dossier (Phase 5, R4).
 *
 * Opens ONE dispatch run by its stable public handle (`v_dispatch_card.id`, a
 * numeric coerced from the string route param — NOT the idempotency_key) and reads
 * its full connected story: the run identity (→ crew dossier), the assignments
 * (each plot → /plots/[id], each crew member → /workers/[id]), the crew-lead
 * acknowledgement (evidence-only — untrusted text never drives an action), and the
 * outbound lifecycle. An unknown / injected / non-numeric id resolves to no run →
 * notFound() (404) rather than fabricate a dossier — mirrors /lots/[code] and
 * /ferment/[batch].
 *
 * Async Server Component (Next 15 async params). It resolves the ANCHOR with ONE
 * getter, 404s before any section work, then renders through <DossierShell> + the
 * four sections. No src/lib/data/* import (live getters only). No client JS.
 */
export default async function DispatchDossierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("dispatch");

  // 1. Resolve the ANCHOR run first (the existence gate). One getter.
  const dossier = await getDispatchRunDossier(id);
  if (!dossier) notFound();

  const { run, crewMembers, crewLanguages } = dossier;

  return (
    <DossierShell
      kind="dispatch"
      title={run.crewName}
      eyebrow={t("dossier.eyebrow")}
      subtitle={t("dossier.subtitle", {
        date: run.dispatchDate,
        plots: `${run.plotCount} ${
          run.plotCount === 1
            ? t("dossier.plotOne")
            : t("dossier.plotOther")
        }`,
        season: run.season,
      })}
      backHref="/dispatch"
      backLabel={t("dossier.backLabel")}
    >
      <DispatchRunSection run={run} crewLanguages={crewLanguages} />
      <DispatchAssignmentsSection run={run} crewMembers={crewMembers} />
      <DispatchAckSection run={run} />
      <DispatchLifecycleSection run={run} />
    </DossierShell>
  );
}
