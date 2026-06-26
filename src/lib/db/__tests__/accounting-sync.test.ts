import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AccountMapRow,
  CashRunwayRow,
  PreharvestFinanceRow,
  SyncHealthRow,
  SyncInboundRow,
  SyncOutboxRow,
} from "@/lib/db/accounting-sync";

/**
 * Coverage of the `accounting-sync.ts` READ-port (P3-S17 — the AR mint/settle door +
 * the QBO/Xero/PAC sync seam). This port reads ONLY the S17-introduced surface (it is
 * file-disjoint from the S16 schema read-port): the sync queue + its inbound twin, the
 * account-code map, and the three cockpit views the migration ships
 * (`v_sync_health`, `v_cash_runway`, `v_preharvest_finance`).
 *
 *   - `getSyncHealth()`        reads `v_sync_health`        (outbox depth/failures per target — the dead-guard alarm).
 *   - `getCashRunway()`        reads `v_cash_runway`        (AR due − committed cost; the only place both ledgers net).
 *   - `getPreharvestFinance()` reads `v_preharvest_finance` (pre-sold reservations vs the open por-obra liability).
 *   - `listAccountMappings()`  reads `account_map`          (our-ledger-key → buyer-account-code).
 *   - `listSyncOutbox()`       reads `sync_outbox`          (the idempotent append-only post queue).
 *   - `listSyncInbound()`      reads `sync_inbound`         (the append-only log of pulls FROM QBO/Xero).
 *
 * Strategy mirrors `pricing.test.ts`: mock `@/lib/supabase/server` so `getSupabase()`
 * returns a chainable, thenable query-builder. The sync/cash math itself is the views'
 * job (pinned by the migration's PGlite tests, not re-implemented here); this port only
 * proves the snake_case→camelCase mapping, numeric coercion (PostgREST serializes
 * bigint/numeric as strings), NULL preservation, and that each getter hits the right
 * table/view.
 */

// ----- chainable, per-table Supabase query-builder stub ---------------------

interface QueryResult<T> {
  data: T;
  error: { message: string } | null;
}

type TableResults = Record<string, QueryResult<unknown>>;

function makeClient(results: TableResults) {
  const fromCalls: string[] = [];
  const client = {
    from: (table: string) => {
      fromCalls.push(table);
      const result = results[table] ?? { data: [], error: null };
      const builder: Record<string, unknown> = {
        select: vi.fn(() => builder),
        order: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        limit: vi.fn(() => builder),
        then: (
          onFulfilled: (value: QueryResult<unknown>) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) => Promise.resolve(result).then(onFulfilled, onRejected),
      };
      return builder;
    },
  };
  return { client, fromCalls };
}

const getSupabaseMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => getSupabaseMock(),
}));

beforeEach(() => {
  getSupabaseMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

// ----- sample rows ----------------------------------------------------------

const syncHealthRow: SyncHealthRow = {
  target: "qbo",
  pending: "3", // PostgREST may serialize a count as a string
  in_flight: "1",
  failed: "2",
  synced: "10",
  max_attempts_failed: "4",
  oldest_unsynced_at: "2026-06-20T10:00:00Z",
};

const cleanSyncHealthRow: SyncHealthRow = {
  target: "xero",
  pending: "0",
  in_flight: "0",
  failed: "0",
  synced: "8",
  max_attempts_failed: null, // no failures ⇒ NULL, preserved
  oldest_unsynced_at: null, // nothing unsynced ⇒ NULL, preserved
};

const cashRunwayRow: CashRunwayRow = {
  ar_outstanding_usd: "12000.50",
  committed_cost_usd: "8000",
  net_position_usd: "4000.50",
};

const preharvestRow: PreharvestFinanceRow = {
  presold_kg: "500",
  active_por_obra_contracts: "3",
  indicative_labor_rate_usd: "1500",
};

const accountMapRow: AccountMapRow = {
  id: 1,
  target: "qbo",
  entry_kind: "revenue",
  match_key: "green_sale",
  account_code: "4000",
  account_name: "Coffee Sales",
  created_at: "2026-06-20T10:00:00Z",
  updated_at: "2026-06-20T10:00:01Z",
};

const syncOutboxRow: SyncOutboxRow = {
  id: "7", // bigint as string
  target: "qbo",
  entity_kind: "ar_doc",
  entity_ref: "JC-CI-0001",
  ar_doc_id: "4",
  content_hash: "abc123",
  payload: { doc_id: 4, doc_number: "JC-CI-0001" },
  state: "pending",
  external_id: null,
  attempts: "0",
  last_error: null,
  idempotency_key: "qbo:ar_doc:JC-CI-0001:abc123",
  created_at: "2026-06-20T10:00:00Z",
  updated_at: "2026-06-20T10:00:00Z",
};

const syncInboundRow: SyncInboundRow = {
  id: "2",
  target: "qbo",
  external_id: "QBO-PMT-9",
  event_kind: "payment",
  payload: { ar_doc_id: 4, amount_doc: 100 },
  applied: true,
  applied_ref: "55",
  received_at: "2026-06-20T10:05:00Z",
  created_at: "2026-06-20T10:05:00Z",
};

// ----- pure mapper: mapSyncHealth -------------------------------------------

describe("mapSyncHealth", () => {
  it("maps a v_sync_health row to camelCase with numeric coercion of the counts", async () => {
    const { mapSyncHealth } = await import("@/lib/db/accounting-sync");
    expect(mapSyncHealth(syncHealthRow)).toEqual({
      target: "qbo",
      pending: 3,
      inFlight: 1,
      failed: 2,
      synced: 10,
      maxAttemptsFailed: 4,
      oldestUnsyncedAt: "2026-06-20T10:00:00Z",
    });
  });

  it("preserves NULL max-attempts / oldest-unsynced when the target is clean", async () => {
    const { mapSyncHealth } = await import("@/lib/db/accounting-sync");
    const h = mapSyncHealth(cleanSyncHealthRow);
    expect(h.maxAttemptsFailed).toBeNull();
    expect(h.oldestUnsyncedAt).toBeNull();
    expect(h.pending).toBe(0);
    expect(h.synced).toBe(8);
  });
});

// ----- pure mapper: mapCashRunway -------------------------------------------

describe("mapCashRunway", () => {
  it("maps a v_cash_runway row, coercing the money strings to numbers", async () => {
    const { mapCashRunway } = await import("@/lib/db/accounting-sync");
    expect(mapCashRunway(cashRunwayRow)).toEqual({
      arOutstandingUsd: 12000.5,
      committedCostUsd: 8000,
      netPositionUsd: 4000.5,
    });
  });
});

// ----- pure mapper: mapPreharvestFinance ------------------------------------

describe("mapPreharvestFinance", () => {
  it("maps a v_preharvest_finance row with numeric coercion", async () => {
    const { mapPreharvestFinance } = await import("@/lib/db/accounting-sync");
    expect(mapPreharvestFinance(preharvestRow)).toEqual({
      presoldKg: 500,
      activePorObraContracts: 3,
      indicativeLaborRateUsd: 1500,
    });
  });
});

// ----- pure mapper: mapAccountMapping ---------------------------------------

describe("mapAccountMapping", () => {
  it("maps an account_map row to camelCase", async () => {
    const { mapAccountMapping } = await import("@/lib/db/accounting-sync");
    expect(mapAccountMapping(accountMapRow)).toEqual({
      id: 1,
      target: "qbo",
      entryKind: "revenue",
      matchKey: "green_sale",
      accountCode: "4000",
      accountName: "Coffee Sales",
      createdAt: "2026-06-20T10:00:00Z",
      updatedAt: "2026-06-20T10:00:01Z",
    });
  });

  it("passes a null account_name through unchanged", async () => {
    const { mapAccountMapping } = await import("@/lib/db/accounting-sync");
    const m = mapAccountMapping({ ...accountMapRow, account_name: null });
    expect(m.accountName).toBeNull();
  });
});

// ----- pure mapper: mapSyncOutbox -------------------------------------------

describe("mapSyncOutbox", () => {
  it("maps a sync_outbox row, coercing bigint strings and preserving the jsonb payload", async () => {
    const { mapSyncOutbox } = await import("@/lib/db/accounting-sync");
    expect(mapSyncOutbox(syncOutboxRow)).toEqual({
      id: 7,
      target: "qbo",
      entityKind: "ar_doc",
      entityRef: "JC-CI-0001",
      arDocId: 4,
      contentHash: "abc123",
      payload: { doc_id: 4, doc_number: "JC-CI-0001" },
      state: "pending",
      externalId: null,
      attempts: 0,
      lastError: null,
      idempotencyKey: "qbo:ar_doc:JC-CI-0001:abc123",
      createdAt: "2026-06-20T10:00:00Z",
      updatedAt: "2026-06-20T10:00:00Z",
    });
  });

  it("preserves NULL external_id / ar_doc_id / last_error on a pending post", async () => {
    const { mapSyncOutbox } = await import("@/lib/db/accounting-sync");
    const o = mapSyncOutbox({ ...syncOutboxRow, ar_doc_id: null });
    expect(o.externalId).toBeNull();
    expect(o.arDocId).toBeNull();
    expect(o.lastError).toBeNull();
  });

  it("coerces a synced post's external_id and attempts", async () => {
    const { mapSyncOutbox } = await import("@/lib/db/accounting-sync");
    const o = mapSyncOutbox({
      ...syncOutboxRow,
      state: "synced",
      external_id: "QBO-INV-77",
      attempts: "2",
    });
    expect(o.state).toBe("synced");
    expect(o.externalId).toBe("QBO-INV-77");
    expect(o.attempts).toBe(2);
  });
});

// ----- pure mapper: mapSyncInbound ------------------------------------------

describe("mapSyncInbound", () => {
  it("maps a sync_inbound row to camelCase", async () => {
    const { mapSyncInbound } = await import("@/lib/db/accounting-sync");
    expect(mapSyncInbound(syncInboundRow)).toEqual({
      id: 2,
      target: "qbo",
      externalId: "QBO-PMT-9",
      eventKind: "payment",
      payload: { ar_doc_id: 4, amount_doc: 100 },
      applied: true,
      appliedRef: "55",
      receivedAt: "2026-06-20T10:05:00Z",
      createdAt: "2026-06-20T10:05:00Z",
    });
  });

  it("preserves a null applied_ref on an un-applied pull", async () => {
    const { mapSyncInbound } = await import("@/lib/db/accounting-sync");
    const i = mapSyncInbound({ ...syncInboundRow, applied: false, applied_ref: null });
    expect(i.applied).toBe(false);
    expect(i.appliedRef).toBeNull();
  });
});

// ----- getter: getSyncHealth -------------------------------------------------

describe("getSyncHealth", () => {
  it("reads v_sync_health and returns camelCase rows", async () => {
    const { client, fromCalls } = makeClient({
      v_sync_health: { data: [syncHealthRow, cleanSyncHealthRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getSyncHealth } = await import("@/lib/db/accounting-sync");
    const rows = await getSyncHealth();

    expect(fromCalls).toContain("v_sync_health");
    expect(rows).toHaveLength(2);
    expect(rows[0].target).toBe("qbo");
    expect(rows[0].pending).toBe(3);
    expect(rows[1].maxAttemptsFailed).toBeNull();
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      v_sync_health: { data: null, error: { message: "health boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getSyncHealth } = await import("@/lib/db/accounting-sync");
    await expect(getSyncHealth()).rejects.toThrow("getSyncHealth: health boom");
  });
});

// ----- getter: getCashRunway -------------------------------------------------

describe("getCashRunway", () => {
  it("reads v_cash_runway and returns the single tenant row", async () => {
    const { client, fromCalls } = makeClient({
      v_cash_runway: { data: [cashRunwayRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getCashRunway } = await import("@/lib/db/accounting-sync");
    const runway = await getCashRunway();

    expect(fromCalls).toContain("v_cash_runway");
    expect(runway).not.toBeNull();
    expect(runway?.arOutstandingUsd).toBe(12000.5);
    expect(runway?.netPositionUsd).toBe(4000.5);
  });

  it("returns null when the tenant has no cash-runway row yet", async () => {
    const { client } = makeClient({
      v_cash_runway: { data: [], error: null },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getCashRunway } = await import("@/lib/db/accounting-sync");
    expect(await getCashRunway()).toBeNull();
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      v_cash_runway: { data: null, error: { message: "runway boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getCashRunway } = await import("@/lib/db/accounting-sync");
    await expect(getCashRunway()).rejects.toThrow("getCashRunway: runway boom");
  });
});

// ----- getter: getPreharvestFinance ------------------------------------------

describe("getPreharvestFinance", () => {
  it("reads v_preharvest_finance and returns the single tenant row", async () => {
    const { client, fromCalls } = makeClient({
      v_preharvest_finance: { data: [preharvestRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getPreharvestFinance } = await import("@/lib/db/accounting-sync");
    const pf = await getPreharvestFinance();

    expect(fromCalls).toContain("v_preharvest_finance");
    expect(pf).not.toBeNull();
    expect(pf?.presoldKg).toBe(500);
    expect(pf?.activePorObraContracts).toBe(3);
  });

  it("returns null when the tenant has no pre-harvest finance row", async () => {
    const { client } = makeClient({
      v_preharvest_finance: { data: [], error: null },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getPreharvestFinance } = await import("@/lib/db/accounting-sync");
    expect(await getPreharvestFinance()).toBeNull();
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      v_preharvest_finance: { data: null, error: { message: "pre boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getPreharvestFinance } = await import("@/lib/db/accounting-sync");
    await expect(getPreharvestFinance()).rejects.toThrow(
      "getPreharvestFinance: pre boom",
    );
  });
});

// ----- getter: listAccountMappings -------------------------------------------

describe("listAccountMappings", () => {
  it("reads account_map and returns camelCase mappings", async () => {
    const { client, fromCalls } = makeClient({
      account_map: { data: [accountMapRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { listAccountMappings } = await import("@/lib/db/accounting-sync");
    const maps = await listAccountMappings();

    expect(fromCalls).toContain("account_map");
    expect(maps[0].matchKey).toBe("green_sale");
    expect(maps[0].accountCode).toBe("4000");
    expect(maps[0].entryKind).toBe("revenue");
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      account_map: { data: null, error: { message: "map boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { listAccountMappings } = await import("@/lib/db/accounting-sync");
    await expect(listAccountMappings()).rejects.toThrow(
      "listAccountMappings: map boom",
    );
  });
});

// ----- getter: listSyncOutbox ------------------------------------------------

describe("listSyncOutbox", () => {
  it("reads sync_outbox and returns camelCase posts", async () => {
    const { client, fromCalls } = makeClient({
      sync_outbox: { data: [syncOutboxRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { listSyncOutbox } = await import("@/lib/db/accounting-sync");
    const posts = await listSyncOutbox();

    expect(fromCalls).toContain("sync_outbox");
    expect(posts[0].id).toBe(7);
    expect(posts[0].entityKind).toBe("ar_doc");
    expect(posts[0].state).toBe("pending");
    expect(posts[0].payload).toEqual({ doc_id: 4, doc_number: "JC-CI-0001" });
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      sync_outbox: { data: null, error: { message: "outbox boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { listSyncOutbox } = await import("@/lib/db/accounting-sync");
    await expect(listSyncOutbox()).rejects.toThrow("listSyncOutbox: outbox boom");
  });
});

// ----- getter: listSyncInbound -----------------------------------------------

describe("listSyncInbound", () => {
  it("reads sync_inbound and returns camelCase pulls", async () => {
    const { client, fromCalls } = makeClient({
      sync_inbound: { data: [syncInboundRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { listSyncInbound } = await import("@/lib/db/accounting-sync");
    const pulls = await listSyncInbound();

    expect(fromCalls).toContain("sync_inbound");
    expect(pulls[0].externalId).toBe("QBO-PMT-9");
    expect(pulls[0].eventKind).toBe("payment");
    expect(pulls[0].applied).toBe(true);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      sync_inbound: { data: null, error: { message: "inbound boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { listSyncInbound } = await import("@/lib/db/accounting-sync");
    await expect(listSyncInbound()).rejects.toThrow(
      "listSyncInbound: inbound boom",
    );
  });
});
