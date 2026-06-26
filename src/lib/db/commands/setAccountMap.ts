import { trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for the ACCOUNT-MAP editor (P3-S17 — `set_account_map`;
 * ADR-002 — all writes flow through a SECURITY DEFINER command RPC). This is WHY we
 * never rebuild bookkeeping: we MAP our coffee-native ledger keys — a
 * `cost_entry.allocation_rule` (cost side) or a `revenue_entry.source_kind` (revenue
 * side) — onto the buyer's chart-of-accounts code, so the sync seam posts to the
 * right account in QBO/Xero/PAC. The RPC is an UPSERT on (tenant, target, entry_kind,
 * match_key): it carries NO idempotency_key (config, not a money write) — this
 * command binds to the EXACT 5-arg signature.
 *
 * Symmetric twin of the read ports: a pure validator (`validateSetAccountMap`) plus a
 * thin command (`setAccountMap`) that calls the single `.rpc()` method it needs (the
 * `SetAccountMapStore` port) so it is testable against a fake store with no database.
 */

/** The `sync_target` enum (S17). */
export const SYNC_TARGETS = ["qbo", "xero", "dgi_pac"] as const;
export type SyncTarget = (typeof SYNC_TARGETS)[number];

/** Which side of the books the mapping covers (the `entry_kind` CHECK). */
export const ACCOUNT_ENTRY_KINDS = ["cost", "revenue"] as const;
export type AccountEntryKind = (typeof ACCOUNT_ENTRY_KINDS)[number];

/** Validated, domain-shaped mapping args (camelCase). */
export interface SetAccountMapInput {
  target: SyncTarget;
  entryKind: AccountEntryKind;
  /** Our ledger key: an `allocation_rule` (cost) or `source_kind` (revenue). */
  matchKey: string;
  /** The buyer's chart-of-accounts code this key posts to. */
  accountCode: string;
  /** A human label for the account (optional). */
  accountName: string | null;
}

function isSyncTarget(v: string): v is SyncTarget {
  return (SYNC_TARGETS as readonly string[]).includes(v);
}
function isAccountEntryKind(v: string): v is AccountEntryKind {
  return (ACCOUNT_ENTRY_KINDS as readonly string[]).includes(v);
}

/**
 * Pure validation of a raw mapping — mirrors the `account_map` constraints (a known
 * target, entry_kind in cost/revenue, a non-empty match key + account code) so errors
 * surface before the round-trip.
 */
export function validateSetAccountMap(
  raw: Record<string, unknown>,
): ValidationResult<SetAccountMapInput> {
  const errors: Record<string, string> = {};

  const rawTarget = trimmed(raw.target);
  if (!isSyncTarget(rawTarget)) errors.target = "Choose a valid sync target.";

  const rawEntryKind = trimmed(raw.entryKind);
  if (!isAccountEntryKind(rawEntryKind)) {
    errors.entryKind = "Choose cost or revenue.";
  }

  const matchKey = trimmed(raw.matchKey);
  if (!matchKey) errors.matchKey = "A ledger key is required.";

  const accountCode = trimmed(raw.accountCode);
  if (!accountCode) errors.accountCode = "An account code is required.";

  const accountName = trimmed(raw.accountName) || null;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      target: rawTarget as SyncTarget,
      entryKind: rawEntryKind as AccountEntryKind,
      matchKey,
      accountCode,
      accountName,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint mapping id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method `set_account_map` needs. */
export interface SetAccountMapStore {
  rpc(
    fn: "set_account_map",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the upserted mapping's id, or friendly/labelled errors. */
export type SetAccountMapResult =
  | { ok: true; mappingId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Validate then upsert: calls `set_account_map` exactly once with the snake_case
 * 5-arg envelope (no idempotency_key — the upsert dedupes on the unique mapping key).
 * Bad input never reaches the RPC (friendly errors); a failure surfaces labelled (raw
 * Postgres text never leaks).
 */
export async function setAccountMap(
  store: SetAccountMapStore,
  raw: Record<string, unknown>,
): Promise<SetAccountMapResult> {
  const parsed = validateSetAccountMap(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("set_account_map", {
    p_target: parsed.data.target,
    p_entry_kind: parsed.data.entryKind,
    p_match_key: parsed.data.matchKey,
    p_account_code: parsed.data.accountCode,
    p_account_name: parsed.data.accountName,
  });

  if (error) {
    return { ok: false, message: "This account mapping couldn't be saved right now. Please try again." };
  }
  if (data == null) {
    return { ok: false, message: "This account mapping couldn't be saved right now. Please try again." };
  }
  return { ok: true, mappingId: Number(data) };
}
