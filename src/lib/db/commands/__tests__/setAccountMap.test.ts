import { describe, expect, it, vi } from "vitest";

import {
  setAccountMap,
  validateSetAccountMap,
  type SetAccountMapStore,
} from "@/lib/db/commands/setAccountMap";

/**
 * Pure-domain command test for the account-map editor (P3-S17 — `set_account_map`).
 * This is WHY we never rebuild bookkeeping: we MAP our coffee-native ledger keys
 * (a `cost_entry.allocation_rule` or a `revenue_entry.source_kind`) onto the buyer's
 * chart-of-accounts code. The RPC is an UPSERT on (tenant, target, entry_kind,
 * match_key) — config, not a money write, so it carries NO idempotency_key (binds to
 * the EXACT 5-arg signature). Drives the command against a fake
 * `.rpc('set_account_map', …)` store and proves the validation seam + the exact
 * snake_case envelope.
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: SetAccountMapStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as SetAccountMapStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  target: "qbo",
  entryKind: "revenue",
  matchKey: "green_sale",
  accountCode: "4000",
  accountName: "Coffee Sales",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateSetAccountMap", () => {
  it("accepts a complete, well-formed mapping", () => {
    const r = validateSetAccountMap(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.target).toBe("qbo");
      expect(r.data.entryKind).toBe("revenue");
      expect(r.data.matchKey).toBe("green_sale");
      expect(r.data.accountCode).toBe("4000");
      expect(r.data.accountName).toBe("Coffee Sales");
    }
  });

  it("allows an omitted account name (null)", () => {
    const { accountName: _a, ...rest } = validRaw();
    const r = validateSetAccountMap(rest);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.accountName).toBeNull();
  });

  it("rejects an unknown sync target", () => {
    const r = validateSetAccountMap({ ...validRaw(), target: "sap" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.target).toBeDefined();
  });

  it("rejects an entry kind that is not cost / revenue", () => {
    const r = validateSetAccountMap({ ...validRaw(), entryKind: "asset" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.entryKind).toBeDefined();
  });

  it("rejects a missing match key", () => {
    const r = validateSetAccountMap({ ...validRaw(), matchKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.matchKey).toBeDefined();
  });

  it("rejects a missing account code", () => {
    const r = validateSetAccountMap({ ...validRaw(), accountCode: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.accountCode).toBeDefined();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("setAccountMap", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await setAccountMap(store, { ...validRaw(), accountCode: "" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls set_account_map with the exact snake_case 5-arg envelope and returns the mapping id", async () => {
    const { store, rpc } = fakeStore({ data: 5, error: null });
    const result = await setAccountMap(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("set_account_map", {
      p_target: "qbo",
      p_entry_kind: "revenue",
      p_match_key: "green_sale",
      p_account_code: "4000",
      p_account_name: "Coffee Sales",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.mappingId).toBe(5);
  });

  it("passes p_account_name null when omitted", async () => {
    const { store, rpc } = fakeStore({ data: 6, error: null });
    const { accountName: _a, ...rest } = validRaw();
    await setAccountMap(store, rest);
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_account_name).toBeNull();
  });

  it("falls back to a labelled message for an RPC failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "permission denied for function set_account_map" },
    });
    const result = await setAccountMap(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });
});
