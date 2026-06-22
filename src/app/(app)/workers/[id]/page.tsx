import { notFound } from "next/navigation";

import { DossierShell } from "@/components/dossier/dossier-shell";
import { WorkerIdentitySection } from "@/components/sections/workers/worker-identity-section";
import { WorkerProductivitySection } from "@/components/sections/workers/worker-productivity-section";
import { WorkerAttendanceSection } from "@/components/sections/workers/worker-attendance-section";
import { WorkerContractsSection } from "@/components/sections/workers/worker-contracts-section";
import { WorkerPaySection } from "@/components/sections/workers/worker-pay-section";
import {
  getWorkerById,
  getWorkerWeighEvents,
  getWorkerPayHistory,
} from "@/lib/db/dossier/worker";
import {
  getWorkerCertsValid,
  getWorkerAttendanceTimeline,
  getWorkerPorObraHistory,
  verifyAttendanceChain,
} from "@/lib/db/people";
import { getWorkerWeighSummary } from "@/lib/db/weigh";

/**
 * /workers/[id] — the per-worker DOSSIER (US-04, Phase 5).
 *
 * Server Component. Resolves the worker identity ANCHOR first (the existence
 * gate, P2) and 404s on an unknown id — never a fabricated worker — before any
 * section fetch. Then fans the section reads out in parallel (P3) and renders
 * through <DossierShell> + the five <…Section> server components (P4):
 * identity + certs (with cert validity), weighs/productivity, the attendance
 * timeline, por-obra contracts, and the cross-period pay history. Every entity
 * name is an <EntityLink> (P6) — out to crew, plot, lot and pay-period. No
 * src/lib/data/* import (P5); loading.tsx + per-section empty states (P7).
 */
export default async function WorkerDossierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // P2 — anchor existence gate: resolve identity with ONE getter, 404 if absent.
  const worker = await getWorkerById(id);
  if (!worker) notFound();

  // P3 — fan the section reads out in parallel (all cache()'d getters).
  const [certs, summary, events, attendance, chainVerified, contracts, pay] =
    await Promise.all([
      getWorkerCertsValid(id),
      getWorkerWeighSummary(id),
      getWorkerWeighEvents(id),
      getWorkerAttendanceTimeline(id),
      verifyAttendanceChain(id),
      getWorkerPorObraHistory(id),
      getWorkerPayHistory(id),
    ]);

  return (
    <DossierShell
      kind="worker"
      title={worker.preferredName ?? worker.name}
      eyebrow="Trabajador"
      subtitle={`${worker.role} · ${worker.crewName}`}
      backHref="/workers"
      backLabel="Todos los trabajadores"
    >
      <WorkerIdentitySection worker={worker} certs={certs} />
      <WorkerProductivitySection summary={summary} events={events} />
      <WorkerAttendanceSection
        events={attendance}
        chainVerified={chainVerified}
      />
      <WorkerContractsSection contracts={contracts} />
      <WorkerPaySection pay={pay} />
    </DossierShell>
  );
}
