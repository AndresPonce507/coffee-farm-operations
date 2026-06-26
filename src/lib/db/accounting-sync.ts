import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/* ====================================================================== */
/* P3-S17 — AR mint/settle + the QBO/Xero/PAC sync seam READ-port           */
/* (ADR-003 derived-read). The financial sink's bridge to the buyer's       */
/* books: we MAP our coffee-native ledger keys onto a chart of accounts     */
/* (`account_map`) and queue idempotent posts (`sync_outbox`) a worker      */
/* Edge Function drains; pulls FROM QBO/Xero land in `sync_inbound` first    */
/* (never blind-trusted). This port READS ONLY the S17-introduced surface — */
/* the sync tables + the three cockpit views the migration ships            */
/* (`v_sync_health`, `v_cash_runway`, `v_preharvest_finance`). It is        */
/* file-disjoint from the S16 accounting schema read-port (ar_doc /         */
/* revenue_entry / v_ar_aging / v_lot_margin live there). The only writers  */
/* are the SECURITY DEFINER RPCs in the command ports (`@/lib/db/commands/  */
/* issueArDoc|settleArPayment|voidArDoc|setAccountMap`). This port only      */
/* READS. Mirrors pricing.ts: `Row` interface + pure `mapX` mapper +        */
/* `cache()`'d getters; NULLs (no failures / nothing unsynced / no live     */
/* mapping) are PRESERVED, never fabricated to 0.                           */
/* ====================================================================== */

/** A sync destination: QuickBooks Online, Xero, or the Panama DGI PAC. */
export type SyncTarget = "qbo" | "xero" | "dgi_pac";

/** Where a queued post stands on its journey to the buyer's books. */
export type SyncState = "pending" | "claimed" | "synced" | "failed";

/** Which side of the books an account_map row maps. */
export type AccountEntryKind = "cost" | "revenue";

/** What a queued outbox post represents. */
export type SyncEntityKind = "ar_doc" | "ar_payment" | "ar_void";

/** What an inbound pull from the external system recorded. */
export type SyncInboundEventKind = "payment" | "void";

/** Coerce a nullable numeric (PostgREST may serialize as a string) to a number,
 *  PRESERVING null — a clean target's max-attempts / oldest-unsynced / a pending
 *  post's external id / ar_doc id stays null (never a fabricated 0). */
function num(v: number | string | null | undefined): number | null {
  return v == null ? null : Number(v);
}

/* ---------------- v_sync_health ---------------- */

/** Shape of a `v_sync_health` row (snake_case). Counts may serialize as strings;
 *  `max_attempts_failed` / `oldest_unsynced_at` are NULL when nothing is failed/
 *  unsynced for the target. */
export interface SyncHealthRow {
  target: SyncTarget | string;
  pending: number | string;
  in_flight: number | string;
  failed: number | string;
  synced: number | string;
  max_attempts_failed: number | string | null;
  oldest_unsynced_at: string | null;
}

/** Per target: the outbox depth/failures/oldest pending — the dead-guard alarm
 *  the /finance/sync cockpit reddens. A non-zero `failed` or an old
 *  `oldestUnsyncedAt` means a stuck post the worker isn't draining. */
export interface SyncHealth {
  target: SyncTarget | string;
  pending: number;
  inFlight: number;
  failed: number;
  synced: number;
  /** Max attempt count among failed posts. NULL ⇒ no failures. */
  maxAttemptsFailed: number | null;
  /** Oldest still-unsynced post's timestamp. NULL ⇒ nothing unsynced. */
  oldestUnsyncedAt: string | null;
}

/** Pure row → domain mapper for a sync-health row (count coercion; NULL
 *  max-attempts / oldest-unsynced preserved). */
export function mapSyncHealth(r: SyncHealthRow): SyncHealth {
  return {
    target: r.target,
    pending: Number(r.pending),
    inFlight: Number(r.in_flight),
    failed: Number(r.failed),
    synced: Number(r.synced),
    maxAttemptsFailed: num(r.max_attempts_failed),
    oldestUnsyncedAt: r.oldest_unsynced_at,
  };
}

/* ---------------- v_cash_runway ---------------- */

/** Shape of a `v_cash_runway` row (snake_case) — the single per-tenant net. */
export interface CashRunwayRow {
  ar_outstanding_usd: number | string;
  committed_cost_usd: number | string;
  net_position_usd: number | string;
}

/** The only place both ledgers net: AR outstanding − committed cost run-rate.
 *  (Phase-2 payroll forecast + scheduled milling/freight join in a later pass.) */
export interface CashRunway {
  arOutstandingUsd: number;
  committedCostUsd: number;
  netPositionUsd: number;
}

/** Pure row → domain mapper for the cash-runway net (numeric coercion). */
export function mapCashRunway(r: CashRunwayRow): CashRunway {
  return {
    arOutstandingUsd: Number(r.ar_outstanding_usd),
    committedCostUsd: Number(r.committed_cost_usd),
    netPositionUsd: Number(r.net_position_usd),
  };
}

/* ---------------- v_preharvest_finance ---------------- */

/** Shape of a `v_preharvest_finance` row (snake_case). */
export interface PreharvestFinanceRow {
  presold_kg: number | string;
  active_por_obra_contracts: number | string;
  indicative_labor_rate_usd: number | string;
}

/** The financing gap BEFORE the picking crew shows up: pre-sold reservations vs
 *  the open por-obra labor liability. */
export interface PreharvestFinance {
  presoldKg: number;
  activePorObraContracts: number;
  indicativeLaborRateUsd: number;
}

/** Pure row → domain mapper for the pre-harvest finance row (numeric coercion). */
export function mapPreharvestFinance(r: PreharvestFinanceRow): PreharvestFinance {
  return {
    presoldKg: Number(r.presold_kg),
    activePorObraContracts: Number(r.active_por_obra_contracts),
    indicativeLaborRateUsd: Number(r.indicative_labor_rate_usd),
  };
}

/* ---------------- account_map ---------------- */

/** Shape of an `account_map` row (snake_case) for the editor. */
export interface AccountMapRow {
  id: number | string;
  target: SyncTarget | string;
  entry_kind: AccountEntryKind | string;
  match_key: string;
  account_code: string;
  account_name: string | null;
  created_at: string;
  updated_at: string;
}

/** One mapping: our ledger key (`allocation_rule` / `source_kind`) → the buyer's
 *  chart-of-accounts code. The reason we MAP, never rebuild, bookkeeping. */
export interface AccountMapping {
  id: number;
  target: SyncTarget | string;
  entryKind: AccountEntryKind | string;
  matchKey: string;
  accountCode: string;
  accountName: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Pure row → domain mapper for an account mapping (id coercion; null name passthrough). */
export function mapAccountMapping(r: AccountMapRow): AccountMapping {
  return {
    id: Number(r.id),
    target: r.target,
    entryKind: r.entry_kind,
    matchKey: r.match_key,
    accountCode: r.account_code,
    accountName: r.account_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/* ---------------- sync_outbox ---------------- */

/** Shape of a `sync_outbox` row (snake_case). bigints may serialize as strings;
 *  `ar_doc_id` / `external_id` / `last_error` are NULL on a fresh pending post. */
export interface SyncOutboxRow {
  id: number | string;
  target: SyncTarget | string;
  entity_kind: SyncEntityKind | string;
  entity_ref: string;
  ar_doc_id: number | string | null;
  content_hash: string;
  payload: Record<string, unknown>;
  state: SyncState | string;
  external_id: string | null;
  attempts: number | string;
  last_error: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

/** One queued post on its way to the buyer's books — the idempotent, append-only
 *  unit of exactly-once sync. `externalId` (the QBO/Xero doc id / dgi_pac CUFE)
 *  fills in once the worker marks it synced. */
export interface SyncOutboxPost {
  id: number;
  target: SyncTarget | string;
  entityKind: SyncEntityKind | string;
  entityRef: string;
  /** The AR doc this post belongs to. NULL only for non-doc posts. */
  arDocId: number | null;
  contentHash: string;
  payload: Record<string, unknown>;
  state: SyncState | string;
  /** The external doc id (CUFE for dgi_pac). NULL until synced. */
  externalId: string | null;
  attempts: number;
  /** The last failure text (worker-facing). NULL when not failed. */
  lastError: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

/** Pure row → domain mapper for an outbox post (bigint coercion; NULL external
 *  id / ar_doc id / last_error preserved). */
export function mapSyncOutbox(r: SyncOutboxRow): SyncOutboxPost {
  return {
    id: Number(r.id),
    target: r.target,
    entityKind: r.entity_kind,
    entityRef: r.entity_ref,
    arDocId: num(r.ar_doc_id),
    contentHash: r.content_hash,
    payload: r.payload,
    state: r.state,
    externalId: r.external_id,
    attempts: Number(r.attempts),
    lastError: r.last_error,
    idempotencyKey: r.idempotency_key,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/* ---------------- sync_inbound ---------------- */

/** Shape of a `sync_inbound` row (snake_case) — the append-only pull log. */
export interface SyncInboundRow {
  id: number | string;
  target: SyncTarget | string;
  external_id: string;
  event_kind: SyncInboundEventKind | string;
  payload: Record<string, unknown>;
  applied: boolean;
  applied_ref: string | null;
  received_at: string;
  created_at: string;
}

/** One pull FROM the external system (a payment/void entered directly in QBO/Xero).
 *  Idempotent on (target, external_id): a re-pull is a no-op — we never blind-trust
 *  the external system twice. `applied` / `appliedRef` flip once our ledger applies it. */
export interface SyncInboundEvent {
  id: number;
  target: SyncTarget | string;
  externalId: string;
  eventKind: SyncInboundEventKind | string;
  payload: Record<string, unknown>;
  applied: boolean;
  /** Our ar_payment id / void marker once applied. NULL while un-applied. */
  appliedRef: string | null;
  receivedAt: string;
  createdAt: string;
}

/** Pure row → domain mapper for an inbound pull (id coercion; null applied-ref passthrough). */
export function mapSyncInbound(r: SyncInboundRow): SyncInboundEvent {
  return {
    id: Number(r.id),
    target: r.target,
    externalId: r.external_id,
    eventKind: r.event_kind,
    payload: r.payload,
    applied: r.applied,
    appliedRef: r.applied_ref,
    receivedAt: r.received_at,
    createdAt: r.created_at,
  };
}

/* ---------------- getters (request-scoped cache) ---------------- */

/**
 * Per-target sync health (`v_sync_health`) — outbox depth/failures/oldest pending.
 * The /finance/sync cockpit's dead-guard alarm: a non-zero `failed` or a stale
 * `oldestUnsyncedAt` means the worker isn't draining and must be surfaced in red.
 */
export const getSyncHealth = cache(async (): Promise<SyncHealth[]> => {
  const { data, error } = await (await getSupabase())
    .from("v_sync_health")
    .select("*")
    .order("target");
  if (error) throw new Error(`getSyncHealth: ${error.message}`);
  return (data as SyncHealthRow[]).map(mapSyncHealth);
});

/**
 * The tenant's cash-runway net (`v_cash_runway`) — AR outstanding − committed cost
 * run-rate, the only place both ledgers net. Returns `null` when the tenant has no
 * AR and no cost yet (the empty-cockpit case). The runway-weeks story the /finance
 * stat cards lead with.
 */
export const getCashRunway = cache(async (): Promise<CashRunway | null> => {
  const { data, error } = await (await getSupabase())
    .from("v_cash_runway")
    .select("*");
  if (error) throw new Error(`getCashRunway: ${error.message}`);
  const rows = (data as CashRunwayRow[] | null) ?? [];
  return rows.length > 0 ? mapCashRunway(rows[0]) : null;
});

/**
 * The pre-harvest financing gap (`v_preharvest_finance`) — pre-sold reservations vs
 * the open por-obra labor liability, surfaced BEFORE the picking crew shows up.
 * Returns `null` when the tenant has neither reservations nor open contracts yet.
 */
export const getPreharvestFinance = cache(
  async (): Promise<PreharvestFinance | null> => {
    const { data, error } = await (await getSupabase())
      .from("v_preharvest_finance")
      .select("*");
    if (error) throw new Error(`getPreharvestFinance: ${error.message}`);
    const rows = (data as PreharvestFinanceRow[] | null) ?? [];
    return rows.length > 0 ? mapPreharvestFinance(rows[0]) : null;
  },
);

/**
 * The account-code map (`account_map`) — our ledger keys → the buyer's chart of
 * accounts, ordered for the /finance/sync editor (by target, then side, then key).
 * The reason we MAP, never rebuild, bookkeeping.
 */
export const listAccountMappings = cache(
  async (): Promise<AccountMapping[]> => {
    const { data, error } = await (await getSupabase())
      .from("account_map")
      .select("*")
      .order("target")
      .order("entry_kind")
      .order("match_key");
    if (error) throw new Error(`listAccountMappings: ${error.message}`);
    return (data as AccountMapRow[]).map(mapAccountMapping);
  },
);

/**
 * The sync outbox (`sync_outbox`), newest post first — the idempotent, append-only
 * post queue the worker Edge Function drains. The /finance/sync queue view + the
 * fiscal-gate provenance (a dgi_pac post reaching 'synced' with a CUFE is what flips
 * a DGI factura to 'issued').
 */
export const listSyncOutbox = cache(async (): Promise<SyncOutboxPost[]> => {
  const { data, error } = await (await getSupabase())
    .from("sync_outbox")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listSyncOutbox: ${error.message}`);
  return (data as SyncOutboxRow[]).map(mapSyncOutbox);
});

/**
 * The inbound pull log (`sync_inbound`), newest first — payments/voids entered
 * directly in QBO/Xero and pulled back (idempotent on (target, external_id), applied
 * via the SAME settle/void path, never echoed). The audit trail behind any
 * externally-sourced change to the books.
 */
export const listSyncInbound = cache(async (): Promise<SyncInboundEvent[]> => {
  const { data, error } = await (await getSupabase())
    .from("sync_inbound")
    .select("*")
    .order("received_at", { ascending: false });
  if (error) throw new Error(`listSyncInbound: ${error.message}`);
  return (data as SyncInboundRow[]).map(mapSyncInbound);
});
