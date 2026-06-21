import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";
import type {
  CertifiedApplicator,
  PlotOption,
} from "@/components/sections/ipm/spray-log-form";

/* ====================================================================== */
/* P2-S12 — Cert-gated applicator + plot read-port for the spray form.    */
/* The form must disable any worker who does NOT currently hold a valid    */
/* pesticide-handling cert — this is the UI projection of S1's             */
/* v_worker_certs_valid. The DB log_spray RPC re-checks the same gate      */
/* fail-closed; this list just makes the gate visible in the picker.       */
/* ====================================================================== */

/** The cert kind that gates spray work. */
export const SPRAY_CERT_KIND = "pesticide-handling";

interface WorkerRow {
  id: string;
  name: string;
}
interface ValidCertRow {
  worker_id: string;
  cert_kind: string;
}

/**
 * Pure join: project the crew into spray applicators, flagging who currently holds
 * a VALID pesticide-handling cert. Every worker appears (the form shows the whole
 * crew); only the certified ones are selectable.
 */
export function computeCertifiedApplicators(
  workers: ReadonlyArray<WorkerRow>,
  validCerts: ReadonlyArray<ValidCertRow>,
): CertifiedApplicator[] {
  const certified = new Set(
    validCerts.filter((c) => c.cert_kind === SPRAY_CERT_KIND).map((c) => c.worker_id),
  );
  return workers.map((w) => ({
    id: w.id,
    name: w.name,
    certified: certified.has(w.id),
  }));
}

/**
 * The crew as spray applicators, each flagged with their live cert status. Reads
 * `workers` and S1's `v_worker_certs_valid` and joins them with the pure helper.
 */
export const getValidApplicators = cache(async (): Promise<CertifiedApplicator[]> => {
  const supabase = await getSupabase();
  const [workersRes, certsRes] = await Promise.all([
    supabase.from("workers").select("id, name").order("name", { ascending: true }),
    supabase.from("v_worker_certs_valid").select("worker_id, cert_kind"),
  ]);
  if (workersRes.error) throw new Error(`getValidApplicators(workers): ${workersRes.error.message}`);
  if (certsRes.error) throw new Error(`getValidApplicators(certs): ${certsRes.error.message}`);
  return computeCertifiedApplicators(
    workersRes.data as WorkerRow[],
    certsRes.data as ValidCertRow[],
  );
});

/** The plots a spray can be logged against — {id, name}, ordered for the picker. */
export const getPlotOptions = cache(async (): Promise<PlotOption[]> => {
  const { data, error } = await (await getSupabase())
    .from("plots")
    .select("id, name")
    .order("name", { ascending: true });
  if (error) throw new Error(`getPlotOptions: ${error.message}`);
  return (data as PlotOption[]);
});
