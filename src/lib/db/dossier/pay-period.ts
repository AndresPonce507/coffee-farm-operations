import { cache } from "react";

import { getWorkerPayForPeriod, type WorkerPay } from "@/lib/db/payroll";
import { getCrewRoster } from "@/lib/db/people";

/* ====================================================================== */
/* Phase 5 · R4 — /pay-period/[id] DOSSIER-scoped read composites.         */
/*                                                                         */
/* The pay-period dossier is a THIN dossier over already-live read ports   */
/* (facet-02 §1b/§5/§11): no new DB surface, no migration. Its anchor      */
/* (`getPayPeriodById`) and section reads (`getWorkerPayForPeriod`,        */
/* `getDisbursementsForPeriod`) already live in `src/lib/db/payroll.ts` —  */
/* the page imports those read-only.                                       */
/*                                                                         */
/* This dossier-scoped file (owned solely by the pay-period slice, so the  */
/* parallel dossier fleet never collides on a shared getter file) adds ONE */
/* composite the dossier needs that payroll.ts does not expose: each pay   */
/* line joined to the live roster so it can link to BOTH the worker AND    */
/* the crew dossier. A `v_worker_pay` row carries `crewName` but never      */
/* `crewId`; the roster (`v_crew_roster`) is the SSOT for workerId→crewId,  */
/* so we resolve the link target from it rather than fabricate one. Pure    */
/* composition over tested read ports; cache()'d so it dedupes per request. */
/* ====================================================================== */

/** A period pay line augmented with the roster-resolved crew dossier id. */
export interface PayPeriodPayLine extends WorkerPay {
  /** The worker's crew id from the live roster, for the /crew/[id] link.
   *  null when the worker is no longer on the roster (no fabricated link). */
  crewId: string | null;
}

/**
 * One period's per-worker pay lines, each joined to the live roster so the
 * dossier can link every line to BOTH a /workers/[id] AND a /crew/[id] dossier.
 *
 * Reads the SAME `v_worker_pay` rows the payroll cockpit reads (via the tested
 * `getWorkerPayForPeriod`), then attaches `crewId` resolved from `v_crew_roster`
 * (the SSOT for workerId→crewId — the pay row only carries `crewName`). A worker
 * who has left the roster gets `crewId: null` so the section omits the crew link
 * rather than point at a crew that no longer exists. Read-only; no new DB surface.
 */
export const getPayPeriodPayLines = cache(
  async (payPeriodId: string): Promise<PayPeriodPayLine[]> => {
    const [lines, roster] = await Promise.all([
      getWorkerPayForPeriod(payPeriodId),
      getCrewRoster(),
    ]);

    const crewIdByWorker = new Map(
      roster.map((m) => [m.workerId, m.crewId]),
    );

    return lines.map((line) => ({
      ...line,
      crewId: crewIdByWorker.get(line.workerId) ?? null,
    }));
  },
);
