import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/**
 * /marketing read port (P3-S20 lifecycle marketing).
 *
 * Co-located with the route on purpose: it binds DIRECTLY to the authoritative SQL
 * surface the P3-S20 migration shipped — the `v_campaign_board` / `v_marketing_audience`
 * / `v_delivery_log` views, plus `green_lots` + `v_lot_reputation` for the merge-tag
 * values the composer resolves — rather than a sibling `@/lib/db` port. Importing a
 * not-yet-written module would hard-fail Vite import-analysis at test AND build time;
 * the only load-bearing contract here is the view/column/RPC names, which are frozen.
 * The Wiring pass can collapse this into a shared port (one import swap).
 *
 * READ-ONLY. Every write goes through the SECURITY DEFINER RPCs in `actions.ts`
 * (draft_campaign / queue_campaign_send / mark_campaign_sent / record_unsubscribe).
 *
 * CONSENT is enforced at the database (a CHECK + a before-insert guard on the outbound
 * queue), and `v_marketing_audience` already filters to consenting, non-unsubscribed
 * contacts — so the audience this port returns is the ONLY set the owner can ever
 * reach. The UI never has to re-derive the gate; it reads the gated view.
 *
 * Merge-tag values mirror the queue RPC EXACTLY: the cup score is the green lot's
 * cupping_score, overridden by a live best accolade score from v_lot_reputation when
 * present; the grade is the green lot's sca_grade. A NULL is preserved (shown blank in
 * the preview), never fabricated.
 */

export type CampaignTrigger =
  | "lot-launch"
  | "replenishment"
  | "sample-follow-up"
  | "manual";
export type CampaignStatus = "draft" | "queued" | "sent" | "archived";

/** One campaign on the board (mirrors a `v_campaign_board` row). */
export interface CampaignBoardRow {
  campaignId: number;
  name: string;
  triggerKind: CampaignTrigger;
  greenLotCode: string | null;
  status: CampaignStatus;
  createdAt: string;
  updatedAt: string;
  queuedTotal: number;
  sentTotal: number;
}

/** A consenting, reachable contact (mirrors a `v_marketing_audience` row). */
export interface AudienceContact {
  contactId: number;
  name: string;
  kind: string | null;
  countryCode: string | null;
  preferredChannel: string | null;
  consentSource: string | null;
  consentAt: string | null;
}

/** One outbound delivery (mirrors a `v_delivery_log` row). */
export interface DeliveryLogRow {
  outboundId: number;
  campaignId: number;
  campaignName: string;
  contactId: number;
  contactName: string;
  channel: string;
  status: string;
  sentAt: string | null;
  createdAt: string;
}

/** The merge-tag values for one lot, resolved the way the queue RPC resolves them. */
export interface LotMergeTag {
  lotCode: string;
  cupScore: number | null;
  scaGrade: string | null;
}

/** The whole /marketing console payload. */
export interface MarketingConsole {
  campaigns: CampaignBoardRow[];
  audience: AudienceContact[];
  deliveryLog: DeliveryLogRow[];
  lots: LotMergeTag[];
}

interface BoardRow {
  campaign_id: number | string;
  name: string;
  trigger_kind: string;
  green_lot_code: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  queued_total: number | string | null;
  sent_total: number | string | null;
}

interface AudienceRow {
  contact_id: number | string;
  name: string;
  kind: string | null;
  country_code: string | null;
  preferred_channel: string | null;
  consent_source: string | null;
  consent_at: string | null;
}

interface DeliveryRow {
  outbound_id: number | string;
  campaign_id: number | string;
  campaign_name: string;
  contact_id: number | string;
  contact_name: string;
  channel: string;
  status: string;
  sent_at: string | null;
  created_at: string;
}

interface GreenLotRow {
  lot_code: string;
  cupping_score: number | string | null;
  sca_grade: string | null;
}

interface ReputationRow {
  lot_code: string;
  best_cup_score: number | string | null;
}

/** Coerce a PostgREST numeric (which may arrive as a string) to number|null. */
const n = (v: number | string | null | undefined): number | null =>
  v == null ? null : Number(v);

/** Coerce a count column to a plain integer (null ⇒ 0). */
const count = (v: number | string | null | undefined): number =>
  v == null ? 0 : Number(v);

/**
 * The marketing console: the campaign board, the consent-gated audience, the delivery
 * log, and the per-lot merge-tag values the composer resolves. All read-only — the
 * consent gate lives at the database, and this audience is already filtered to the
 * contacts the owner can lawfully reach.
 */
export const getMarketingConsole = cache(async (): Promise<MarketingConsole> => {
  const sb = await getSupabase();
  const [board, audience, delivery, lots, reputation] = await Promise.all([
    sb.from("v_campaign_board").select("*").order("updated_at", { ascending: false }),
    sb.from("v_marketing_audience").select("*").order("name"),
    sb
      .from("v_delivery_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50),
    sb.from("green_lots").select("lot_code, cupping_score, sca_grade").order("lot_code"),
    sb.from("v_lot_reputation").select("lot_code, best_cup_score"),
  ]);

  if (board.error) throw new Error(`getMarketingConsole: ${board.error.message}`);
  if (audience.error) {
    throw new Error(`getMarketingConsole(audience): ${audience.error.message}`);
  }
  if (delivery.error) {
    throw new Error(`getMarketingConsole(delivery): ${delivery.error.message}`);
  }
  if (lots.error) throw new Error(`getMarketingConsole(lots): ${lots.error.message}`);
  if (reputation.error) {
    throw new Error(`getMarketingConsole(reputation): ${reputation.error.message}`);
  }

  const bestByLot = new Map<string, number | null>(
    (reputation.data as ReputationRow[]).map((r) => [r.lot_code, n(r.best_cup_score)]),
  );

  const campaigns: CampaignBoardRow[] = (board.data as BoardRow[]).map((r) => ({
    campaignId: Number(r.campaign_id),
    name: r.name,
    triggerKind: r.trigger_kind as CampaignTrigger,
    greenLotCode: r.green_lot_code,
    status: r.status as CampaignStatus,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    queuedTotal: count(r.queued_total),
    sentTotal: count(r.sent_total),
  }));

  const audienceRows: AudienceContact[] = (audience.data as AudienceRow[]).map((r) => ({
    contactId: Number(r.contact_id),
    name: r.name,
    kind: r.kind,
    countryCode: r.country_code,
    preferredChannel: r.preferred_channel,
    consentSource: r.consent_source,
    consentAt: r.consent_at,
  }));

  const deliveryLog: DeliveryLogRow[] = (delivery.data as DeliveryRow[]).map((r) => ({
    outboundId: Number(r.outbound_id),
    campaignId: Number(r.campaign_id),
    campaignName: r.campaign_name,
    contactId: Number(r.contact_id),
    contactName: r.contact_name,
    channel: r.channel,
    status: r.status,
    sentAt: r.sent_at,
    createdAt: r.created_at,
  }));

  const lotTags: LotMergeTag[] = (lots.data as GreenLotRow[]).map((l) => {
    // EXACTLY the queue RPC's resolution: best accolade score overrides the cup.
    const best = bestByLot.get(l.lot_code);
    const cup = best != null ? best : n(l.cupping_score);
    return { lotCode: l.lot_code, cupScore: cup, scaGrade: l.sca_grade };
  });

  return { campaigns, audience: audienceRows, deliveryLog, lots: lotTags };
});
