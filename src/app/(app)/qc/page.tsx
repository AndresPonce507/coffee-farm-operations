import { PageHeader } from "@/components/ui/page-header";
import { QcStatusTable } from "@/components/sections/qc/qc-status-table";
import { CupperDriftCard } from "@/components/sections/qc/cupper-drift-card";
import { getCupperDrift, getQcStatus } from "@/lib/db/qc";

/**
 * QC & cupping — the "/qc" route (P2-S6, the make-quality trunk capstone).
 *
 * Where Phase-1 dead-ended at a single `cupping_score` per green lot, this surface
 * makes quality a first-class, auditable system: SCA CVA (2023) + legacy 100-pt
 * cupping sessions with an append-only score ledger, a green-grading defect engine,
 * cupper-drift calibration, and the QC-HOLD quarantine that physically blocks a
 * held lot from being reserved or shipped (the cup-protection teeth, enforced in
 * the database by the `_prevent_held_lot_commit` trigger family).
 *
 * Server Component: it awaits the derived `v_qc_status` roll-up and the
 * `v_cupper_drift` calibration evidence in parallel and composes the header above
 * the QC table + the drift card. The only client JS is the hold-control island
 * inside the table (place/release a QC-hold). The cupping scoresheet lives on
 * /qc/cup/[lot]. The app shell comes from (app)/layout.tsx.
 */
export default async function QcPage() {
  const [status, drift] = await Promise.all([getQcStatus(), getCupperDrift()]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quality control"
        subtitle="Cup scores, defect grading, and the QC-HOLD that keeps a flawed lot from being sold"
      />

      <QcStatusTable rows={status} />

      <CupperDriftCard drift={drift} />
    </div>
  );
}
