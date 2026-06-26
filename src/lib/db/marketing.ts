import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/* ====================================================================== */
/* P3-S20 — Lifecycle marketing READ-port (ADR-003 derived-read). The       */
/* lifecycle console reads the CONSENT-GATED audience (`v_marketing_audience`*/
/* — a non-consenting / unsubscribed contact is physically ABSENT, the       */
/* CAN-SPAM/GDPR promise enforced at the data layer), the campaign board     */
/* with queued/sent tallies (`v_campaign_board`), a single campaign          */
/* (`marketing_campaigns`) and the live delivery log (`v_delivery_log`). The */
/* only writers are the SECURITY DEFINER RPCs in the command ports           */
/* (`draft_campaign` / `queue_campaign_send` / `mark_campaign_sent` /        */
/* `record_unsubscribe`). This port only READS. Mirrors the pricing.ts shape:*/
/* `Row` interface + pure `mapX` mapper + `cache()`'d getters; NULL optional  */
/* fields (a lot-less manual campaign, a still-queued row's sent_at) are      */
/* PRESERVED. CRUCIAL: the audience getter reads the consent-filtered VIEW,   */
/* NEVER the raw `contacts` table — there is no code path to a non-consenting */
/* contact from this surface.                                                 */
/* ====================================================================== */

/** A campaign's life-cycle trigger. 'manual' is the composer's own draft;
 *  the other three are the auto-draft event triggers (lot mint / shipment /
 *  sample dispatch). */
export type CampaignTrigger =
  | "lot-launch"
  | "replenishment"
  | "sample-follow-up"
  | "manual";

/** A campaign's status. AI drafts ('draft'); the owner queues ('queued'); the
 *  human-confirmed send flips it to 'sent'. */
export type CampaignStatus = "draft" | "queued" | "sent" | "archived";

/** An outbound row's delivery status. */
export type OutboundStatus = "queued" | "sent" | "failed" | "suppressed";

/** The contact comm-channel enum (shared with P3-S18 contacts). */
export type CommChannel =
  | "email"
  | "phone"
  | "whatsapp"
  | "meeting"
  | "event"
  | "other";

/** Coerce a numeric (PostgREST may serialize a count as a string) to a number. */
function n(v: number | string | null | undefined): number {
  return Number(v ?? 0);
}

/* ---------------- v_marketing_audience ---------------- */

/** Shape of a `v_marketing_audience` row (snake_case) — the consent-gated audience. */
export interface MarketingAudienceRow {
  contact_id: number;
  name: string;
  kind: string;
  country_code: string | null;
  preferred_channel: CommChannel | string | null;
  consent_source: string | null;
  consent_at: string | null;
}

/** A contact who can be marketed to RIGHT NOW (consent=true, not unsubscribed). */
export interface MarketingAudienceContact {
  contactId: number;
  name: string;
  kind: string;
  countryCode: string | null;
  preferredChannel: CommChannel | string | null;
  consentSource: string | null;
  consentAt: string | null;
}

/** Pure row → domain mapper for an audience contact (null contact fields pass
 *  through unchanged). */
export function mapMarketingAudienceContact(
  r: MarketingAudienceRow,
): MarketingAudienceContact {
  return {
    contactId: Number(r.contact_id),
    name: r.name,
    kind: r.kind,
    countryCode: r.country_code,
    preferredChannel: r.preferred_channel,
    consentSource: r.consent_source,
    consentAt: r.consent_at,
  };
}

/* ---------------- v_campaign_board ---------------- */

/** Shape of a `v_campaign_board` row (snake_case). `green_lot_code` is NULL for
 *  a lot-less manual campaign; the tallies may serialize as strings. */
export interface CampaignBoardRow {
  campaign_id: number;
  name: string;
  trigger_kind: CampaignTrigger | string;
  green_lot_code: string | null;
  status: CampaignStatus | string;
  created_at: string;
  updated_at: string;
  queued_total: number | string;
  sent_total: number | string;
}

/** One campaign on the board: trigger, lot, status + queued/sent tallies. */
export interface CampaignBoardEntry {
  campaignId: number;
  name: string;
  triggerKind: CampaignTrigger | string;
  greenLotCode: string | null;
  status: CampaignStatus | string;
  createdAt: string;
  updatedAt: string;
  queuedTotal: number;
  sentTotal: number;
}

/** Pure row → domain mapper for a board entry (numeric tally coercion; NULL lot
 *  preserved). */
export function mapCampaignBoardEntry(r: CampaignBoardRow): CampaignBoardEntry {
  return {
    campaignId: Number(r.campaign_id),
    name: r.name,
    triggerKind: r.trigger_kind,
    greenLotCode: r.green_lot_code,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    queuedTotal: n(r.queued_total),
    sentTotal: n(r.sent_total),
  };
}

/* ---------------- marketing_campaigns ---------------- */

/** Shape of a `marketing_campaigns` row (snake_case). `green_lot_code`/`subject`/
 *  `body_template` are NULL on a freshly auto-drafted shell. */
export interface MarketingCampaignRow {
  id: number;
  name: string;
  trigger_kind: CampaignTrigger | string;
  green_lot_code: string | null;
  subject: string | null;
  body_template: string | null;
  status: CampaignStatus | string;
  created_at: string;
  updated_at: string;
}

/** A campaign header (the composer binds to this). */
export interface MarketingCampaign {
  id: number;
  name: string;
  triggerKind: CampaignTrigger | string;
  greenLotCode: string | null;
  subject: string | null;
  bodyTemplate: string | null;
  status: CampaignStatus | string;
  createdAt: string;
  updatedAt: string;
}

/** Pure row → domain mapper for a campaign (NULL lot/subject/body passthrough). */
export function mapMarketingCampaign(r: MarketingCampaignRow): MarketingCampaign {
  return {
    id: Number(r.id),
    name: r.name,
    triggerKind: r.trigger_kind,
    greenLotCode: r.green_lot_code,
    subject: r.subject,
    bodyTemplate: r.body_template,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/* ---------------- v_delivery_log ---------------- */

/** Shape of a `v_delivery_log` row (snake_case). `sent_at` is NULL while a row
 *  is still queued. */
export interface DeliveryLogRow {
  outbound_id: number;
  campaign_id: number;
  campaign_name: string;
  contact_id: number;
  contact_name: string;
  channel: CommChannel | string;
  status: OutboundStatus | string;
  sent_at: string | null;
  created_at: string;
}

/** One row in the live delivery log (outbound ⨝ campaign ⨝ contact). */
export interface DeliveryLogEntry {
  outboundId: number;
  campaignId: number;
  campaignName: string;
  contactId: number;
  contactName: string;
  channel: CommChannel | string;
  status: OutboundStatus | string;
  sentAt: string | null;
  createdAt: string;
}

/** Pure row → domain mapper for a delivery-log entry (NULL sent_at preserved). */
export function mapDeliveryLogEntry(r: DeliveryLogRow): DeliveryLogEntry {
  return {
    outboundId: Number(r.outbound_id),
    campaignId: Number(r.campaign_id),
    campaignName: r.campaign_name,
    contactId: Number(r.contact_id),
    contactName: r.contact_name,
    channel: r.channel,
    status: r.status,
    sentAt: r.sent_at,
    createdAt: r.created_at,
  };
}

/* ---------------- getters (request-scoped cache) ---------------- */

/**
 * The CONSENT-GATED audience (`v_marketing_audience`), ordered by name — the ONLY
 * source the audience builder reads. A non-consenting or unsubscribed contact is
 * physically absent from this view, so the builder can't even see, let alone
 * target, a row that hasn't opted in (the CAN-SPAM/GDPR promise as DB enforcement).
 */
export const getMarketingAudience = cache(
  async (): Promise<MarketingAudienceContact[]> => {
    const { data, error } = await (await getSupabase())
      .from("v_marketing_audience")
      .select("*")
      .order("name");
    if (error) throw new Error(`getMarketingAudience: ${error.message}`);
    return (data as MarketingAudienceRow[]).map(mapMarketingAudienceContact);
  },
);

/**
 * The campaign board (`v_campaign_board`), newest first — every campaign's
 * trigger, lot, status and queued/sent tallies. The trigger board's source.
 */
export const getCampaignBoard = cache(
  async (): Promise<CampaignBoardEntry[]> => {
    const { data, error } = await (await getSupabase())
      .from("v_campaign_board")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(`getCampaignBoard: ${error.message}`);
    return (data as CampaignBoardRow[]).map(mapCampaignBoardEntry);
  },
);

/**
 * One campaign header (`marketing_campaigns` filtered to the id), or `null` when
 * the id has no row (notFound() territory for the /marketing/[id] composer).
 */
export const getCampaign = cache(
  async (id: number): Promise<MarketingCampaign | null> => {
    const { data, error } = await (await getSupabase())
      .from("marketing_campaigns")
      .select("*")
      .eq("id", id);
    if (error) throw new Error(`getCampaign: ${error.message}`);
    const rows = (data as MarketingCampaignRow[] | null) ?? [];
    return rows.length > 0 ? mapMarketingCampaign(rows[0]) : null;
  },
);

/**
 * The live delivery log (`v_delivery_log`), newest first — every queued/sent
 * outbound row joined to its campaign + contact. The console's delivery feed.
 */
export const getDeliveryLog = cache(async (): Promise<DeliveryLogEntry[]> => {
  const { data, error } = await (await getSupabase())
    .from("v_delivery_log")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`getDeliveryLog: ${error.message}`);
  return (data as DeliveryLogRow[]).map(mapDeliveryLogEntry);
});
