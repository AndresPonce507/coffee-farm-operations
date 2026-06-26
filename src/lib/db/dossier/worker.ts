import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";
import { getCrewRoster, type CrewRosterMember } from "@/lib/db/people";
import { mapWorkerPay, type WorkerPay, type WorkerPayRow } from "@/lib/db/payroll";

/* ====================================================================== */
/* Phase 5 · /workers/[id] DOSSIER (US-04) — dossier-scoped read-port.      */
/* This file is OWNED by the worker-dossier slice (file-disjoint per the    */
/* parallel-fleet rule): only the worker dossier reads from here. It does   */
/* NOT redefine the shared people/weigh/payroll getters — it IMPORTS them    */
/* read-only and adds the three thin reads the dossier needs but the shared  */
/* files don't expose: the identity ANCHOR (getWorkerById), the per-worker   */
/* weigh-event evidence (plot + lot bearing, getWorkerWeighEvents), and the  */
/* cross-period pay history (getWorkerPayHistory). All are cache()'d, read    */
/* only, snake_case → camelCase with Number() coercion — mirrors the         */
/* people.ts / weigh.ts / payroll.ts shape. No migration, no write door.      */
/* ====================================================================== */

/* ---------------------------------------------------------------------- */
/* Identity anchor — composed from v_crew_roster + workers_view            */
/* ---------------------------------------------------------------------- */

/**
 * The worker dossier's identity anchor — the roster identity facts (name,
 * role, crew, comarca of origin, languages, rehire eligibility) plus the
 * employment facts the roster view doesn't carry (daily rate, the year they
 * started). One denormalized shape so the identity section + the shell header
 * read from a single object. `crewId` links the dossier to /crew/[id].
 */
export interface WorkerIdentity {
  workerId: string;
  name: string;
  preferredName: string | null;
  role: string;
  crewName: string;
  crewId: string | null;
  comarcaOrigin: string | null;
  languages: string[];
  rehireEligible: boolean;
  attendance: string;
  dailyRateUsd: number | null;
  startedYear: number | null;
}

/** A `workers_view` row, narrowed to the employment facts the roster lacks. */
interface WorkerEmploymentRow {
  id: string;
  daily_rate_usd: number | string | null;
  started_year: number | string | null;
}

/** Pure compose: roster member (identity) + optional employment row (rate/year). */
export function composeWorkerIdentity(
  member: CrewRosterMember,
  employment: WorkerEmploymentRow | null,
): WorkerIdentity {
  return {
    workerId: member.workerId,
    name: member.name,
    preferredName: member.preferredName,
    role: member.role,
    crewName: member.crewName,
    crewId: member.crewId,
    comarcaOrigin: member.comarcaOrigin,
    languages: member.languages,
    rehireEligible: member.rehireEligible,
    attendance: member.attendance,
    dailyRateUsd:
      employment?.daily_rate_usd == null
        ? null
        : Number(employment.daily_rate_usd),
    startedYear:
      employment?.started_year == null
        ? null
        : Number(employment.started_year),
  };
}

/**
 * ONE worker's identity by id — the /workers/[id] dossier ANCHOR (the existence
 * gate, P2). Resolves the worker from the live `v_crew_roster` (the richest
 * identity projection), then enriches with the `workers_view` employment facts
 * (daily rate, started year). Returns null when the id matches no roster member
 * so the dossier calls notFound() — never a fabricated worker. Read-only.
 */
export const getWorkerById = cache(
  async (workerId: string): Promise<WorkerIdentity | null> => {
    const member = (await getCrewRoster()).find(
      (m) => m.workerId === workerId,
    );
    if (!member) return null;

    const { data, error } = await (await getSupabase())
      .from("workers_view")
      .select("id,daily_rate_usd,started_year")
      .eq("id", workerId)
      .maybeSingle();
    if (error) throw new Error(`getWorkerById: ${error.message}`);

    return composeWorkerIdentity(member, (data as WorkerEmploymentRow) ?? null);
  },
);

/* ---------------------------------------------------------------------- */
/* Per-worker weigh evidence — weigh_event (plot + lot bearing)            */
/* ---------------------------------------------------------------------- */

/** A `weigh_event` row narrowed to the worker dossier's productivity columns. */
export interface WorkerWeighRow {
  event_uid: string;
  plot_id: string;
  lot_code: string;
  kg: number | string;
  ripeness: string;
  brix: number | string | null;
  geofence_ok: boolean | null;
  occurred_at: string;
}

/** Domain shape of one of a worker's weigh events (plot + lot linkable). */
export interface WorkerWeigh {
  eventUid: string;
  plotId: string;
  lotCode: string;
  kg: number;
  ripeness: string;
  brix: number | null;
  geofenceOk: boolean | null;
  occurredAt: string;
}

/** Pure row → domain mapper (numeric coercion of kg/brix). */
export function mapWorkerWeigh(r: WorkerWeighRow): WorkerWeigh {
  return {
    eventUid: r.event_uid,
    plotId: r.plot_id,
    lotCode: r.lot_code,
    kg: Number(r.kg),
    ripeness: r.ripeness,
    brix: r.brix === null ? null : Number(r.brix),
    geofenceOk: r.geofence_ok,
    occurredAt: r.occurred_at,
  };
}

/**
 * One worker's append-only weigh-event evidence — every lata they emptied,
 * newest first. Unlike the today-only summary (getWorkerWeighSummary), this
 * carries each event's plot_id AND lot_code, so the productivity section links
 * out to both /plots/[id] (where they picked) and /lots/[code] (what they fed).
 * Read-only.
 */
export const getWorkerWeighEvents = cache(
  async (workerId: string): Promise<WorkerWeigh[]> => {
    const { data, error } = await (await getSupabase())
      .from("weigh_event")
      .select(
        "event_uid,plot_id,lot_code,kg,ripeness,brix,geofence_ok,occurred_at",
      )
      .eq("worker_id", workerId)
      .order("occurred_at", { ascending: false });
    if (error) throw new Error(`getWorkerWeighEvents: ${error.message}`);
    return (data as WorkerWeighRow[]).map(mapWorkerWeigh);
  },
);

/* ---------------------------------------------------------------------- */
/* Cross-period pay history — v_worker_pay (every period for the worker)   */
/* ---------------------------------------------------------------------- */

/**
 * One worker's pay history across ALL periods — every original (non-reversal)
 * calculated pay line for this worker, newest period first. The shared
 * getWorkerPayForPeriod() is period-scoped; the dossier needs the worker's
 * lifetime ledger so each row links to its /pay-period/[id]. Reverses are
 * filtered (reverses_id is null). Reuses the frozen mapWorkerPay mapper.
 * Read-only.
 */
export const getWorkerPayHistory = cache(
  async (workerId: string): Promise<WorkerPay[]> => {
    const { data, error } = await (await getSupabase())
      .from("v_worker_pay")
      .select("*")
      .eq("worker_id", workerId)
      .is("reverses_id", null)
      .order("period_start", { ascending: false });
    if (error) throw new Error(`getWorkerPayHistory: ${error.message}`);
    return (data as WorkerPayRow[]).map(mapWorkerPay);
  },
);
