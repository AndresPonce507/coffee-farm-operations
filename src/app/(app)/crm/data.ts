import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/**
 * /crm read port (P3-S18 direct-trade CRM).
 *
 * Co-located with the route (the pricing-port rationale): it binds DIRECTLY to the
 * authoritative SQL surface the P3-S18 migration shipped — the `v_contact_directory`
 * /`v_contact_timeline` /`v_sample_dispatch_pipeline` views, the `green_lots_atp`
 * derived ATP view, and the `verify_chain('contact:<id>')` chain check — rather than
 * a sibling `@/lib/db/crm` port a parallel fan-out may still be authoring (importing
 * a not-yet-existent module hard-fails Vite's import analysis at test AND build time).
 * The only load-bearing contract here is the view/column/RPC names, which are frozen.
 *
 * READ-ONLY. Every write goes through the SECURITY DEFINER RPCs in `actions.ts`.
 * PostgREST numerics may arrive as strings → coerce with `n()`; NULL is PRESERVED
 * (lifetime value / cup score / ATP are "unknown", never a fabricated 0).
 */

export type ContactKind =
  | "roaster"
  | "importer"
  | "agent"
  | "distributor"
  | "retailer"
  | "press"
  | "individual"
  | "other";

export type ContactStatus = "lead" | "prospect" | "active" | "dormant" | "lost";

export type CommChannel =
  | "email"
  | "phone"
  | "whatsapp"
  | "meeting"
  | "event"
  | "other";

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

/** A roster line (mirrors `v_contact_directory`). */
export interface ContactDirectoryRow {
  contactId: number;
  name: string;
  kind: ContactKind;
  status: ContactStatus;
  countryCode: string | null;
  preferredChannel: CommChannel | null;
  buyerId: number | null;
  buyerName: string | null;
  consentMarketing: boolean;
  consentSource: string | null;
  consentAt: string | null;
  unsubscribedAt: string | null;
  lastEventAt: string | null;
  eventCount: number;
  /** Derived from accepted quotes bound to the contact; NULL/0 ⇒ none yet. */
  lifetimeValueUsd: number | null;
}

/** One append-only relationship event (mirrors `v_contact_timeline`). */
export interface ContactTimelineEvent {
  eventUid: string;
  contactId: number;
  kind: ContactEventKind;
  payload: Record<string, unknown>;
  occurredAt: string;
  recordedAt: string;
  deviceId: string;
  deviceSeq: number;
}

/** One dispatched sample (mirrors `v_sample_dispatch_pipeline`). */
export interface SampleDispatchRow {
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
  /** approved | rejected | counter — NULL ⇒ awaiting the buyer's cup. */
  latestVerdict: string | null;
}

/** A green lot with stock to sample (mirrors `green_lots_atp` where atp > 0). */
export interface SampleableLot {
  greenLotCode: string;
  scaGrade: string | null;
  atpKg: number | null;
}

/** The full contact sheet payload (directory row + ledger + pipeline + chain proof). */
export interface ContactSheet {
  contact: ContactDirectoryRow;
  /** Detail-only PII (NOT projected into the roster view) — read from `contacts`. */
  email: string | null;
  phone: string | null;
  timeline: ContactTimelineEvent[];
  samples: SampleDispatchRow[];
  /** verify_chain('contact:<id>') — the tamper-evident proof of the timeline. */
  chainVerified: boolean;
  /** Green lots that still have ATP, for the dispatch composer. */
  sampleableLots: SampleableLot[];
}

interface DirectoryViewRow {
  contact_id: number;
  name: string;
  kind: string;
  status: string;
  country_code: string | null;
  preferred_channel: string | null;
  buyer_id: number | null;
  buyer_name: string | null;
  consent_marketing: boolean;
  consent_source: string | null;
  consent_at: string | null;
  unsubscribed_at: string | null;
  last_event_at: string | null;
  event_count: number | string | null;
  lifetime_value_usd: number | string | null;
}

interface TimelineViewRow {
  event_uid: string;
  contact_id: number;
  kind: string;
  payload: Record<string, unknown> | null;
  occurred_at: string;
  recorded_at: string;
  device_id: string;
  device_seq: number | string;
}

interface PipelineViewRow {
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
  latest_verdict: string | null;
}

interface AtpViewRow {
  green_lot_code: string;
  sca_grade: string | null;
  atp: number | string | null;
}

/** Coerce a PostgREST numeric (which may arrive as a string) to number|null. */
const n = (v: number | string | null | undefined): number | null =>
  v == null ? null : Number(v);

export function mapDirectoryRow(r: DirectoryViewRow): ContactDirectoryRow {
  return {
    contactId: r.contact_id,
    name: r.name,
    kind: r.kind as ContactKind,
    status: r.status as ContactStatus,
    countryCode: r.country_code,
    preferredChannel: (r.preferred_channel as CommChannel | null) ?? null,
    buyerId: r.buyer_id,
    buyerName: r.buyer_name,
    consentMarketing: Boolean(r.consent_marketing),
    consentSource: r.consent_source,
    consentAt: r.consent_at,
    unsubscribedAt: r.unsubscribed_at,
    lastEventAt: r.last_event_at,
    eventCount: n(r.event_count) ?? 0,
    lifetimeValueUsd: n(r.lifetime_value_usd),
  };
}

function mapTimeline(r: TimelineViewRow): ContactTimelineEvent {
  return {
    eventUid: r.event_uid,
    contactId: r.contact_id,
    kind: r.kind as ContactEventKind,
    payload: r.payload ?? {},
    occurredAt: r.occurred_at,
    recordedAt: r.recorded_at,
    deviceId: r.device_id,
    deviceSeq: Number(r.device_seq),
  };
}

function mapSample(r: PipelineViewRow): SampleDispatchRow {
  return {
    sampleId: r.sample_id,
    greenLotCode: r.green_lot_code,
    contactId: r.contact_id,
    contactName: r.contact_name,
    grams: Number(r.grams),
    kg: Number(r.kg),
    courier: r.courier,
    trackingNo: r.tracking_no,
    dispatchedAt: r.dispatched_at,
    scaGrade: r.sca_grade,
    cuppingScore: n(r.cupping_score),
    latestVerdict: r.latest_verdict,
  };
}

/** The contact roster — every contact, with derived activity + lifetime value. */
export const getContactDirectory = cache(
  async (): Promise<ContactDirectoryRow[]> => {
    const sb = await getSupabase();
    const { data, error } = await sb
      .from("v_contact_directory")
      .select("*")
      .order("name");
    if (error) throw new Error(`getContactDirectory: ${error.message}`);
    return (data as DirectoryViewRow[]).map(mapDirectoryRow);
  },
);

/**
 * One contact's full sheet: the directory row, the append-only timeline (oldest
 * first, so the glass vertical timeline reads top-to-bottom), the sample pipeline,
 * the chain-verification proof, and the green lots still holding ATP (for the
 * dispatch composer). Returns null when the id resolves to no contact (the route
 * 404s — never a fabricated sheet). Soft reads degrade: a chain-check error leaves
 * `chainVerified` false rather than throwing the whole page.
 */
export const getContactSheet = cache(
  async (contactId: number): Promise<ContactSheet | null> => {
    const sb = await getSupabase();

    const { data: dir, error: dirErr } = await sb
      .from("v_contact_directory")
      .select("*")
      .eq("contact_id", contactId)
      .maybeSingle();
    if (dirErr) throw new Error(`getContactSheet: ${dirErr.message}`);
    if (!dir) return null;

    const [timelineRes, samplesRes, chainRes, lotsRes, pii] = await Promise.all([
      sb
        .from("v_contact_timeline")
        .select("*")
        .eq("contact_id", contactId)
        .order("occurred_at", { ascending: true })
        .order("device_seq", { ascending: true }),
      sb
        .from("v_sample_dispatch_pipeline")
        .select("*")
        .eq("contact_id", contactId)
        .order("dispatched_at", { ascending: false }),
      sb.rpc("verify_chain", { stream_key: `contact:${contactId}` }),
      sb
        .from("green_lots_atp")
        .select("green_lot_code, sca_grade, atp")
        .gt("atp", 0)
        .order("green_lot_code"),
      // Detail-only contact PII — not projected into the roster view. The `contacts`
      // table is tenant-read-granted, so this stays under the caller's RLS.
      sb
        .from("contacts")
        .select("email, phone")
        .eq("id", contactId)
        .maybeSingle(),
    ]);

    if (timelineRes.error)
      throw new Error(`getContactSheet(timeline): ${timelineRes.error.message}`);
    if (samplesRes.error)
      throw new Error(`getContactSheet(samples): ${samplesRes.error.message}`);

    const sampleableLots: SampleableLot[] = (
      (lotsRes.data as AtpViewRow[] | null) ?? []
    ).map((l) => ({
      greenLotCode: l.green_lot_code,
      scaGrade: l.sca_grade,
      atpKg: n(l.atp),
    }));

    const piiRow = pii.data as { email: string | null; phone: string | null } | null;

    return {
      contact: mapDirectoryRow(dir as DirectoryViewRow),
      email: piiRow?.email ?? null,
      phone: piiRow?.phone ?? null,
      timeline: ((timelineRes.data as TimelineViewRow[] | null) ?? []).map(
        mapTimeline,
      ),
      samples: ((samplesRes.data as PipelineViewRow[] | null) ?? []).map(
        mapSample,
      ),
      chainVerified: chainRes.error ? false : Boolean(chainRes.data),
      sampleableLots,
    };
  },
);
