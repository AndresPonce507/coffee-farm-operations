import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/* ====================================================================== */
/* P2-S1 — crew + worker system-of-record read-port.                       */
/* The people side of the farm: who is on the crew today, the append-only  */
/* attendance timeline, por-obra (piece-rate) contract history, valid      */
/* certifications, and the per-worker life-event stream — each read from    */
/* the frozen DB contract (v_crew_roster / worker_attendance_today /        */
/* v_worker_certs_valid views + attendance_event / por_obra_contracts /     */
/* worker_certifications / worker_stream_event tables). Writes never flow    */
/* through here — they go through the command RPCs. The verify_chain RPC is  */
/* the chain-verified badge's source of truth (stream_key 'attendance:<id>'  */
/* for the attendance ledger). Mirrors the eudr.ts / events.ts shape:        */
/* Row iface + pure map + cache()'d getter, snake_case → camelCase, numeric  */
/* coercion via Number(), languages array default [].                        */
/* ====================================================================== */

/* ---------------------------------------------------------------------- */
/* Crew roster — v_crew_roster                                             */
/* ---------------------------------------------------------------------- */

/** A `v_crew_roster` row as PostgREST returns it (snake_case). */
export interface CrewRosterRow {
  worker_id: string;
  name: string;
  role: string;
  crew_name: string;
  crew_id: string | null;
  attendance: string;
  preferred_name: string | null;
  comarca_origin: string | null;
  languages: string[] | null;
  rehire_eligible: boolean;
}

/** Domain shape of one crew-roster member (camelCase). */
export interface CrewRosterMember {
  workerId: string;
  name: string;
  role: string;
  crewName: string;
  crewId: string | null;
  attendance: string;
  preferredName: string | null;
  comarcaOrigin: string | null;
  languages: string[];
  rehireEligible: boolean;
}

/** Pure row → domain mapper. `languages` defaults to [] when null/absent. */
export function mapCrewRosterRow(r: CrewRosterRow): CrewRosterMember {
  return {
    workerId: r.worker_id,
    name: r.name,
    role: r.role,
    crewName: r.crew_name,
    crewId: r.crew_id,
    attendance: r.attendance,
    preferredName: r.preferred_name,
    comarcaOrigin: r.comarca_origin,
    languages: r.languages ?? [],
    rehireEligible: r.rehire_eligible,
  };
}

/**
 * The full crew roster — every worker with their crew, today's attendance, and
 * the identity facts (preferred name, comarca of origin, languages, rehire
 * eligibility), ordered by worker id.
 */
export const getCrewRoster = cache(async (): Promise<CrewRosterMember[]> => {
  const { data, error } = await (await getSupabase())
    .from("v_crew_roster")
    .select("*")
    .order("worker_id", { ascending: true });
  if (error) throw new Error(`getCrewRoster: ${error.message}`);
  return (data as CrewRosterRow[]).map(mapCrewRosterRow);
});

/* ---------------------------------------------------------------------- */
/* Attendance today — worker_attendance_today                             */
/* ---------------------------------------------------------------------- */

/** A `worker_attendance_today` row as PostgREST returns it (snake_case). */
export interface AttendanceTodayRow {
  worker_id: string;
  crew_id: string | null;
  event_kind: string;
  plot_id: string | null;
  occurred_at: string;
}

/** Domain shape of one worker's attendance state for today (camelCase). */
export interface AttendanceToday {
  workerId: string;
  crewId: string | null;
  eventKind: string;
  plotId: string | null;
  occurredAt: string;
}

/** Pure row → domain mapper. */
export function mapAttendanceToday(r: AttendanceTodayRow): AttendanceToday {
  return {
    workerId: r.worker_id,
    crewId: r.crew_id,
    eventKind: r.event_kind,
    plotId: r.plot_id,
    occurredAt: r.occurred_at,
  };
}

/**
 * Today's attendance snapshot — each worker's latest attendance event for the
 * current day (clock-in / clock-out / rest-day / absent).
 */
export const getAttendanceToday = cache(
  async (): Promise<AttendanceToday[]> => {
    const { data, error } = await (await getSupabase())
      .from("worker_attendance_today")
      .select("*");
    if (error) throw new Error(`getAttendanceToday: ${error.message}`);
    return (data as AttendanceTodayRow[]).map(mapAttendanceToday);
  },
);

/* ---------------------------------------------------------------------- */
/* Attendance timeline — attendance_event (append-only)                   */
/* ---------------------------------------------------------------------- */

/** An `attendance_event` row as PostgREST returns it (snake_case). */
export interface AttendanceEventRow {
  event_uid: string;
  worker_id: string;
  crew_id: string | null;
  event_kind: string;
  plot_id: string | null;
  occurred_at: string;
  recorded_at: string;
  device_id: string;
  device_seq: number | string;
}

/** Domain shape of one append-only attendance event (camelCase). */
export interface AttendanceEvent {
  eventUid: string;
  workerId: string;
  crewId: string | null;
  eventKind: string;
  plotId: string | null;
  occurredAt: string;
  recordedAt: string;
  deviceId: string;
  deviceSeq: number;
}

/** Pure row → domain mapper (numeric coercion of device_seq). */
export function mapAttendanceEvent(r: AttendanceEventRow): AttendanceEvent {
  return {
    eventUid: r.event_uid,
    workerId: r.worker_id,
    crewId: r.crew_id,
    eventKind: r.event_kind,
    plotId: r.plot_id,
    occurredAt: r.occurred_at,
    recordedAt: r.recorded_at,
    deviceId: r.device_id,
    deviceSeq: Number(r.device_seq),
  };
}

/**
 * One worker's append-only attendance timeline — every clock-in/out, rest-day,
 * and absence, newest first (ordered by occurred_at desc).
 */
export const getWorkerAttendanceTimeline = cache(
  async (workerId: string): Promise<AttendanceEvent[]> => {
    const { data, error } = await (await getSupabase())
      .from("attendance_event")
      .select("*")
      .eq("worker_id", workerId)
      .order("occurred_at", { ascending: false });
    if (error) {
      throw new Error(`getWorkerAttendanceTimeline: ${error.message}`);
    }
    return (data as AttendanceEventRow[]).map(mapAttendanceEvent);
  },
);

/* ---------------------------------------------------------------------- */
/* Por-obra contract history — por_obra_contracts                         */
/* ---------------------------------------------------------------------- */

/** A `por_obra_contracts` row as PostgREST returns it (snake_case). */
export interface PorObraContractRow {
  id: number;
  worker_id: string;
  task_kind: string;
  rate_basis: string;
  rate_usd: number | string;
  effective_from: string;
  effective_to: string | null;
  signed_at: string;
  signature_ref: string | null;
  superseded_by: number | null;
}

/** Domain shape of one por-obra (piece-rate) contract (camelCase). */
export interface PorObraContract {
  id: number;
  workerId: string;
  taskKind: string;
  rateBasis: string;
  rateUsd: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  signedAt: string;
  signatureRef: string | null;
  supersededBy: number | null;
}

/** Pure row → domain mapper (numeric coercion of rate_usd). */
export function mapPorObraContract(r: PorObraContractRow): PorObraContract {
  return {
    id: r.id,
    workerId: r.worker_id,
    taskKind: r.task_kind,
    rateBasis: r.rate_basis,
    rateUsd: Number(r.rate_usd),
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    signedAt: r.signed_at,
    signatureRef: r.signature_ref,
    supersededBy: r.superseded_by,
  };
}

/**
 * One worker's por-obra contract history — every piece-rate agreement they have
 * signed, newest effective first (ordered by effective_from desc). The
 * superseded_by chain records which contract replaced which.
 */
export const getWorkerPorObraHistory = cache(
  async (workerId: string): Promise<PorObraContract[]> => {
    const { data, error } = await (await getSupabase())
      .from("por_obra_contracts")
      .select("*")
      .eq("worker_id", workerId)
      .order("effective_from", { ascending: false });
    if (error) {
      throw new Error(`getWorkerPorObraHistory: ${error.message}`);
    }
    return (data as PorObraContractRow[]).map(mapPorObraContract);
  },
);

/* ---------------------------------------------------------------------- */
/* Valid certifications — v_worker_certs_valid                            */
/* ---------------------------------------------------------------------- */

/** A `v_worker_certs_valid` row as PostgREST returns it (snake_case). */
export interface WorkerCertRow {
  worker_id: string;
  cert_kind: string;
  issued_at: string;
  expires_at: string | null;
  issuer: string | null;
}

/** Domain shape of one currently-valid worker certification (camelCase). */
export interface WorkerCert {
  workerId: string;
  certKind: string;
  issuedAt: string;
  expiresAt: string | null;
  issuer: string | null;
}

/** Pure row → domain mapper. */
export function mapWorkerCert(r: WorkerCertRow): WorkerCert {
  return {
    workerId: r.worker_id,
    certKind: r.cert_kind,
    issuedAt: r.issued_at,
    expiresAt: r.expires_at,
    issuer: r.issuer,
  };
}

/**
 * One worker's currently-valid certifications — the view already filters out
 * anything expired, so these are the live, in-force certs.
 */
export const getWorkerCertsValid = cache(
  async (workerId: string): Promise<WorkerCert[]> => {
    const { data, error } = await (await getSupabase())
      .from("v_worker_certs_valid")
      .select("*")
      .eq("worker_id", workerId);
    if (error) throw new Error(`getWorkerCertsValid: ${error.message}`);
    return (data as WorkerCertRow[]).map(mapWorkerCert);
  },
);

/* ---------------------------------------------------------------------- */
/* Worker life-event stream — worker_stream_event                         */
/* ---------------------------------------------------------------------- */

/** A `worker_stream_event` row as PostgREST returns it (snake_case). */
export interface WorkerStreamRow {
  event_uid: string;
  stream_key: string;
  kind: string;
  payload: Record<string, unknown> | null;
  occurred_at: string;
  recorded_at: string;
  device_id: string;
  device_seq: number | string;
}

/** Domain shape of one worker life-event ledger entry (camelCase). */
export interface WorkerStreamEvent {
  eventUid: string;
  streamKey: string;
  kind: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  recordedAt: string;
  deviceId: string;
  deviceSeq: number;
}

/** Pure row → domain mapper (numeric coercion of device_seq, payload default {}). */
export function mapWorkerStreamEvent(r: WorkerStreamRow): WorkerStreamEvent {
  return {
    eventUid: r.event_uid,
    streamKey: r.stream_key,
    kind: r.kind,
    payload: r.payload ?? {},
    occurredAt: r.occurred_at,
    recordedAt: r.recorded_at,
    deviceId: r.device_id,
    deviceSeq: Number(r.device_seq),
  };
}

/**
 * One worker's life-event ledger — the append-only `worker:<id>` stream
 * (hired, role changes, cert-added, …), in chain order (ordered by device_seq,
 * the per-stream monotonic counter the hash chain is built over).
 */
export const getWorkerStream = cache(
  async (workerId: string): Promise<WorkerStreamEvent[]> => {
    const { data, error } = await (await getSupabase())
      .from("worker_stream_event")
      .select("*")
      .eq("stream_key", `worker:${workerId}`)
      .order("device_seq", { ascending: true });
    if (error) throw new Error(`getWorkerStream: ${error.message}`);
    return (data as WorkerStreamRow[]).map(mapWorkerStreamEvent);
  },
);

/* ---------------------------------------------------------------------- */
/* Attendance chain verification — verify_chain RPC                       */
/* ---------------------------------------------------------------------- */

/**
 * Internal-consistency check for one worker's attendance ledger — recomputes the
 * hash chain server-side via the `verify_chain` RPC over the 'attendance:<id>'
 * stream. Returns true when each stored hash reconciles and links to its
 * predecessor, false on any drift. Mirrors `verifyStream` in events.ts: this is
 * a corruption detector feeding the chain-verified badge, not tamper PROOF (the
 * chain is self-anchored — the primary guards are append-only + RLS + no write
 * grant).
 */
export const verifyAttendanceChain = cache(
  async (workerId: string): Promise<boolean> => {
    const { data, error } = await (await getSupabase()).rpc("verify_chain", {
      stream_key: `attendance:${workerId}`,
    });
    if (error) throw new Error(`verifyAttendanceChain: ${error.message}`);
    return Boolean(data);
  },
);
