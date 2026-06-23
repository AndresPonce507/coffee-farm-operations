import { notFound } from "next/navigation";

import { DossierShell } from "@/components/dossier/dossier-shell";
import { CrewRosterSection } from "@/components/sections/crew/crew-roster-section";
import { CrewPlotsSection } from "@/components/sections/crew/crew-plots-section";
import { CrewDispatchSection } from "@/components/sections/crew/crew-dispatch-section";
import { CrewProductivitySection } from "@/components/sections/crew/crew-productivity-section";
import { getCrewById } from "@/lib/db/people";
import {
  getCrewAssignedPlots,
  getCrewDispatchHistory,
  getCrewProductivity,
} from "@/lib/db/dossier/crew";

/**
 * /crew/[id] — the crew DOSSIER (Phase 5 L2, facet-02 §5).
 *
 * Async Server Component (Next 15 `params: Promise<…>`). It resolves the ANCHOR
 * crew with ONE getter (`getCrewById`, the frozen people read-port — imported
 * read-only, never duplicated) and calls `notFound()` BEFORE any section fetch:
 * an unknown / injected crew id 404s rather than fabricate a dossier (P2). Only
 * then does it `Promise.all` the three deeper section reads (P3, no waterfall) and
 * render through `<DossierShell>` + four `<…Section>` server components (P4). Every
 * entity name inside a section is an `<EntityLink>` (P6); the route ships a
 * loading.tsx skeleton + error.tsx boundary (P7). Cross-links OUT: worker (roster +
 * productivity), plot (assigned plots + dispatch lines), dispatch-run (history) — ≥4.
 */
export default async function CrewDossierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // 1. Resolve the anchor crew first (the existence gate). One cheap getter.
  const crew = await getCrewById(id);
  if (!crew) notFound(); // unknown id → 404, no fabricated dossier.

  // 2. Fan the section reads out in parallel (all cache()'d getters).
  const [assignedPlots, dispatchHistory, productivity] = await Promise.all([
    getCrewAssignedPlots(id),
    getCrewDispatchHistory(id),
    getCrewProductivity(id),
  ]);

  return (
    <DossierShell
      kind="crew"
      title={crew.crewName}
      eyebrow="Cuadrilla"
      subtitle={`${crew.memberCount} ${
        crew.memberCount === 1 ? "integrante" : "integrantes"
      } · ${crew.presentCount} ${
        crew.presentCount === 1 ? "presente" : "presentes"
      } hoy`}
      backHref="/crew"
      backLabel="Todas las cuadrillas"
    >
      <CrewRosterSection members={crew.members} />
      <CrewPlotsSection plots={assignedPlots} />
      <CrewDispatchSection history={dispatchHistory} />
      <CrewProductivitySection productivity={productivity} />
    </DossierShell>
  );
}
