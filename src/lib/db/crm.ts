import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/* ====================================================================== */
/* P3-S18 — Direct-trade CRM READ-port (ADR-003 derived-read). The trust    */
/* backbone over the lot graph: the mutable `contacts` anchor is surfaced    */
/* through `v_contact_directory` (with a DERIVED lifetime value — never a    */
/* stored counter), its append-only, hash-chained relationship ledger        */
/* through `v_contact_timeline` (each `contact:<id>` stream is verifiable via */
/* `verify_chain`), and open B2B sample dispatches through                    */
/* `v_sample_dispatch_pipeline` (with the latest cup verdict). The only       */
/* writers are the SECURITY DEFINER RPCs in the command ports                 */
/* (`upsert_contact` / `record_contact_event` / `record_sample_dispatch` /    */
/* `record_sample_feedback`). This port only READS — and only ever the        */
/* tenant-scoped VIEWS, never the raw PII tables. Mirrors the pricing.ts /     */
/* marketing.ts shape: `Row` interface + pure `mapX` mapper + `cache()`'d      */
/* getters; NULLs (an un-bound buyer, an un-graded lot, an awaited verdict)    */
/* are PRESERVED, never fabricated to 0 — the UI shows "—" instead.            */
/* ====================================================================== */

/** A contact's kind — mirrors the `contact_kind` enum. */
export type ContactKind =
  | "roaster"
  | "importer"
  | "agent"
  | "distributor"
  | "retailer"
  | "press"
  | "individual"
  | "other";

/** A contact's relationship status — mirrors the `contact_status` enum. */
export type ContactStatus = "lead" | "prospect" | "active" | "dormant" | "lost";

/** A preferred comm channel — mirrors the `comm_channel` enum. */
export type CommChannel =
  | "email"
  | "phone"
  | "whatsapp"
  | "meeting"
  | "event"
  | "other";

/** A relationship-event kind — mirrors the `contact_event_kind` enum. */
export type ContactEventKind =
  | "inquiry"
  | "sample_requested"
  | "sample_sent"
  | "sample_feedback"
  | "quote_sent"
  | "meeting"
  | "call"
  | "note"
  | "consent_granted"
  | "consent_withdrawn";

/** A buyer's cup verdict on a sample — mirrors the feedback CHECK. */
export type SampleVerdict = "approved" | "rejected" | "counter";

/** Coerce a nullable numeric (PostgREST may serialize as a string) to a number,
 *  PRESERVING null — an un-graded lot / un-rendered score stays null, never a 0. */
function num(v: number | string | null | undefined): number | null {
  return v == null ? null : Number(v);
}

/* ---------------- v_contact_directory ---------------- */

/** Shape of a `v_contact_directory` row (snake_case). `buyer_id`/`buyer_name`
 *  are NULL until the contact is bound to a P3-S1 `b2b_buyers` master; the
 *  consent fields are NULL until a marketing consent is granted; `event_count`
 *  and `lifetime_value_usd` may serialize as strings. */
export interface ContactDirectoryRow {
  contact_id: number;
  name: string;
  kind: ContactKind | string;
  status: ContactStatus | string;
  country_code: string | null;
  preferred_channel: CommChannel | string | null;
  buyer_id: number | null;
  buyer_name: string | null;
  consent_marketing: boolean;
  consent_source: string | null;
  consent_at: string | null;
  unsubscribed_at: string | null;
  last_event_at: string | null;
  event_count: number | string;
  lifetime_value_usd: number | string;
}

/** One contact on the roster: identity, status, the B2B master link, consent
 *  posture, last-touch + event tally, and the DERIVED lifetime value (Σ accepted
 *  quotes whose reservation is bound to this contact). */
export interface ContactDirectoryEntry {
  contactId: number;
  name: string;
  kind: ContactKind | string;
  status: ContactStatus | string;
  countryCode: string | null;
  preferredChannel: CommChannel | string | null;
  buyerId: number | null;
  buyerName: string | null;
  consentMarketing: boolean;
  consentSource: string | null;
  consentAt: string | null;
  unsubscribedAt: string | null;
  lastEventAt: string | null;
  eventCount: number;
  lifetimeValueUsd: number;
}

/** Pure row → domain mapper for a directory entry (numeric coercion of the
 *  count/value; NULL buyer/consent/last-event fields preserved). */
export function mapContactDirectoryEntry(
  r: ContactDirectoryRow,
): ContactDirectoryEntry {
  return {
    contactId: Number(r.contact_id),
    name: r.name,
    kind: r.kind,
    status: r.status,
    countryCode: r.country_code,
    preferredChannel: r.preferred_channel,
    buyerId: num(r.buyer_id),
    buyerName: r.buyer_name,
    consentMarketing: r.consent_marketing,
    consentSource: r.consent_source,
    consentAt: r.consent_at,
    unsubscribedAt: r.unsubscribed_at,
    lastEventAt: r.last_event_at,
    eventCount: Number(r.event_count ?? 0),
    lifetimeValueUsd: Number(r.lifetime_value_usd ?? 0),
  };
}

/* ---------------- v_contact_timeline ---------------- */

/** Shape of a `v_contact_timeline` row (snake_case) — one append-only,
 *  hash-chained relationship event. `device_seq` may serialize as a string. */
export interface ContactTimelineRow {
  contact_id: number;
  event_uid: string;
  stream_key: string;
  kind: ContactEventKind | string;
  payload: Record<string, unknown>;
  occurred_at: string;
  recorded_at: string;
  device_id: string;
  device_seq: number | string;
}

/** One event on a contact's chain-verifiable timeline (the stream is
 *  `contact:<id>`; `verify_chain('contact:<id>')` proves it untampered). */
export interface ContactTimelineEvent {
  contactId: number;
  eventUid: string;
  streamKey: string;
  kind: ContactEventKind | string;
  payload: Record<string, unknown>;
  occurredAt: string;
  recordedAt: string;
  deviceId: string;
  deviceSeq: number;
}

/** Pure row → domain mapper for a timeline event (device_seq coercion; the
 *  jsonb payload passes through unchanged). */
export function mapContactTimelineEvent(
  r: ContactTimelineRow,
): ContactTimelineEvent {
  return {
    contactId: Number(r.contact_id),
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

/* ---------------- v_sample_dispatch_pipeline ---------------- */

/** Shape of a `v_sample_dispatch_pipeline` row (snake_case). `courier`/
 *  `tracking_no`/`sca_grade`/`cupping_score` may be NULL; `latest_verdict` is
 *  NULL while the buyer's cup is awaited; grams/kg/score may serialize as strings. */
export interface SampleDispatchPipelineRow {
  sample_id: number;
  green_lot_code: string;
  contact_id: number;
  contact_name: string;
  grams: number | string;
  kg: number | string;
  courier: string | null;
  tracking_no: string | null;
  dispatched_at: string;
  sca_grade: string | null;
  cupping_score: number | string | null;
  latest_verdict: SampleVerdict | string | null;
}

/** One open B2B sample dispatch ⨝ contact ⨝ green-lot grade, with the latest
 *  feedback verdict (NULL = awaiting the buyer's cup). */
export interface SampleDispatchPipelineEntry {
  sampleId: number;
  greenLotCode: string;
  contactId: number;
  contactName: string;
  grams: number;
  kg: number;
  courier: string | null;
  trackingNo: string | null;
  dispatchedAt: string;
  scaGrade: string | null;
  cuppingScore: number | null;
  latestVerdict: SampleVerdict | string | null;
}

/** Pure row → domain mapper for a pipeline entry (numeric coercion of grams/kg/
 *  score; NULL courier/tracking/grade/score/verdict preserved). */
export function mapSampleDispatchPipelineEntry(
  r: SampleDispatchPipelineRow,
): SampleDispatchPipelineEntry {
  return {
    sampleId: Number(r.sample_id),
    greenLotCode: r.green_lot_code,
    contactId: Number(r.contact_id),
    contactName: r.contact_name,
    grams: Number(r.grams),
    kg: Number(r.kg),
    courier: r.courier,
    trackingNo: r.tracking_no,
    dispatchedAt: r.dispatched_at,
    scaGrade: r.sca_grade,
    cuppingScore: num(r.cupping_score),
    latestVerdict: r.latest_verdict,
  };
}

/* ---------------- getters (request-scoped cache) ---------------- */

/**
 * The contact roster (`v_contact_directory`), ordered by name — every contact's
 * identity, status, B2B master link, consent posture, last-touch + event tally
 * and DERIVED lifetime value. The /crm directory's source.
 */
export const getContactDirectory = cache(
  async (): Promise<ContactDirectoryEntry[]> => {
    const { data, error } = await (await getSupabase())
      .from("v_contact_directory")
      .select("*")
      .order("name");
    if (error) throw new Error(`getContactDirectory: ${error.message}`);
    return (data as ContactDirectoryRow[]).map(mapContactDirectoryEntry);
  },
);

/**
 * One contact's directory entry (`v_contact_directory` filtered to the id), or
 * `null` when the id has no row (notFound() territory for the /crm/[contact]
 * sheet). Same derived-value semantics as `getContactDirectory`.
 */
export const getContact = cache(
  async (id: number): Promise<ContactDirectoryEntry | null> => {
    const { data, error } = await (await getSupabase())
      .from("v_contact_directory")
      .select("*")
      .eq("contact_id", id);
    if (error) throw new Error(`getContact: ${error.message}`);
    const rows = (data as ContactDirectoryRow[] | null) ?? [];
    return rows.length > 0 ? mapContactDirectoryEntry(rows[0]) : null;
  },
);

/**
 * One contact's append-only, hash-chained relationship timeline
 * (`v_contact_timeline` filtered to the contact), in append order (`device_seq`
 * ascending — the chain order `verify_chain('contact:<id>')` walks). The contact
 * sheet's glass vertical timeline.
 */
export const getContactTimeline = cache(
  async (contactId: number): Promise<ContactTimelineEvent[]> => {
    const { data, error } = await (await getSupabase())
      .from("v_contact_timeline")
      .select("*")
      .eq("contact_id", contactId)
      .order("device_seq");
    if (error) throw new Error(`getContactTimeline: ${error.message}`);
    return (data as ContactTimelineRow[]).map(mapContactTimelineEvent);
  },
);

/**
 * The open B2B sample-dispatch pipeline (`v_sample_dispatch_pipeline`), newest
 * dispatch first — each sample ⨝ contact ⨝ green-lot grade with the latest cup
 * verdict (NULL while awaited). The CRM dispatch path (distinct from P3-S2's
 * `v_sample_pipeline`, the green_samples → b2b_buyers path).
 */
export const getSampleDispatchPipeline = cache(
  async (): Promise<SampleDispatchPipelineEntry[]> => {
    const { data, error } = await (await getSupabase())
      .from("v_sample_dispatch_pipeline")
      .select("*")
      .order("dispatched_at", { ascending: false });
    if (error) throw new Error(`getSampleDispatchPipeline: ${error.message}`);
    return (data as SampleDispatchPipelineRow[]).map(
      mapSampleDispatchPipelineEntry,
    );
  },
);
