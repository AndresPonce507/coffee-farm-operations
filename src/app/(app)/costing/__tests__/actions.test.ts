import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Behaviour test for the S7 costing Server Action `bookCostEntry` — the first
 * WRITE the owner makes against the append-only `cost_entry` ledger from the UI
 * (today costs are demo-seeded only). Server Actions are the driving port
 * (ADR-002 — only ever invoked by an authenticated human submitting a form).
 *
 * Drives the action with plain input objects against a mocked Supabase client +
 * a mocked `revalidatePath`, proving:
 *   - a valid lot/plot/farm entry INSERTS the right snake_case row shape, then
 *     calls the `refresh_lot_cost` RPC so the new cost is reflected immediately,
 *     and revalidates `/costing`,
 *   - the DB CHECK-shape rules are enforced app-side BEFORE a round-trip: a farm
 *     row carrying a target_code is rejected, and a plot/lot row WITHOUT one is
 *     rejected (no insert, no refresh, no revalidate),
 *   - a negative original amount is rejected (an original must be >= 0; a
 *     reversal — out of scope here — is the only negative path),
 *   - enum membership (driver / allocation_rule / target_kind) is validated,
 *   - a labelled DB error surfaces as a CLEAN { ok:false, error } result.
 *
 * Mirrors the supabase-server mock idiom in
 * src/app/(app)/inventory/__tests__/actions.test.ts.
 */

const getSupabaseMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => getSupabaseMock(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => revalidatePathMock(p),
}));

import { bookCostEntry } from "@/app/(app)/costing/actions";

/** A Supabase-client stand-in: `.from().insert()` for the append, `.rpc()` for refresh. */
function makeClient(opts?: {
  insert?: { data: unknown; error: { message: string; code?: string } | null };
  rpc?: { data: unknown; error: { message: string } | null };
}): {
  client: unknown;
  insert: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
} {
  const insert = vi.fn(() =>
    Promise.resolve(opts?.insert ?? { data: null, error: null }),
  );
  const rpc = vi.fn(() =>
    Promise.resolve(opts?.rpc ?? { data: null, error: null }),
  );
  const from = vi.fn(() => ({ insert }));
  return { client: { from, rpc }, insert, rpc };
}

beforeEach(() => {
  getSupabaseMock.mockReset();
  revalidatePathMock.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("bookCostEntry", () => {
  it("inserts a lot-targeted row in snake_case, refreshes the matview, and revalidates /costing", async () => {
    const { client, insert, rpc } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await bookCostEntry({
      driver: "worker-day",
      allocationRule: "direct-labor",
      targetKind: "lot",
      targetCode: "JC-701",
      amountUsd: 42.5,
      memo: "Crew Norte picking day",
    });

    expect(result).toEqual({ ok: true });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith({
      driver: "worker-day",
      allocation_rule: "direct-labor",
      target_kind: "lot",
      target_code: "JC-701",
      amount_usd: 42.5,
      memo: "Crew Norte picking day",
    });
    // the refresh seam fires so the new cost is reflected immediately
    expect(rpc).toHaveBeenCalledWith("refresh_lot_cost");
    expect(revalidatePathMock).toHaveBeenCalledWith("/costing");
  });

  it("books a farm-wide overhead row with a null target_code (farm rows carry no target)", async () => {
    const { client, insert, rpc } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await bookCostEntry({
      driver: "task",
      allocationRule: "overhead",
      targetKind: "farm",
      targetCode: "", // a blank target_code is normalized to null for a farm row
      amountUsd: 200,
    });

    expect(result).toEqual({ ok: true });
    expect(insert).toHaveBeenCalledWith({
      driver: "task",
      allocation_rule: "overhead",
      target_kind: "farm",
      target_code: null,
      amount_usd: 200,
      memo: null,
    });
    expect(rpc).toHaveBeenCalledWith("refresh_lot_cost");
  });

  it("normalizes an empty/whitespace memo to null", async () => {
    const { client, insert } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    await bookCostEntry({
      driver: "processing-batch",
      allocationRule: "processing",
      targetKind: "lot",
      targetCode: "JC-701",
      amountUsd: 10,
      memo: "   ",
    });

    const row = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(row.memo).toBeNull();
  });

  it("rejects a farm row that carries a target_code WITHOUT a round-trip", async () => {
    const { client, insert, rpc } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await bookCostEntry({
      driver: "task",
      allocationRule: "overhead",
      targetKind: "farm",
      targetCode: "JC-701", // illegal — a farm row must have target_code null
      amountUsd: 200,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/farm|target/i);
    expect(insert).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("rejects a plot row WITHOUT a target_code WITHOUT a round-trip", async () => {
    const { client, insert, rpc } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await bookCostEntry({
      driver: "worker-day",
      allocationRule: "agronomy",
      targetKind: "plot",
      targetCode: "", // illegal — a plot row must name a target
      amountUsd: 30,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/target|plot|required/i);
    expect(insert).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a lot row WITHOUT a target_code WITHOUT a round-trip", async () => {
    const { client, insert } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await bookCostEntry({
      driver: "worker-day",
      allocationRule: "direct-labor",
      targetKind: "lot",
      targetCode: "",
      amountUsd: 30,
    });

    expect(result.ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects a negative amount (an original entry must be >= 0)", async () => {
    const { client, insert } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await bookCostEntry({
      driver: "worker-day",
      allocationRule: "direct-labor",
      targetKind: "lot",
      targetCode: "JC-701",
      amountUsd: -5,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/amount|negative|0/i);
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric / NaN amount", async () => {
    const { client, insert } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await bookCostEntry({
      driver: "worker-day",
      allocationRule: "direct-labor",
      targetKind: "lot",
      targetCode: "JC-701",
      amountUsd: Number.NaN,
    });

    expect(result.ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects an unknown driver / allocation_rule / target_kind enum value", async () => {
    const { client, insert } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const badDriver = await bookCostEntry({
      driver: "telepathy" as never,
      allocationRule: "direct-labor",
      targetKind: "lot",
      targetCode: "JC-701",
      amountUsd: 10,
    });
    const badRule = await bookCostEntry({
      driver: "worker-day",
      allocationRule: "bribes" as never,
      targetKind: "lot",
      targetCode: "JC-701",
      amountUsd: 10,
    });
    const badKind = await bookCostEntry({
      driver: "worker-day",
      allocationRule: "direct-labor",
      targetKind: "galaxy" as never,
      targetCode: "JC-701",
      amountUsd: 10,
    });

    expect(badDriver.ok).toBe(false);
    expect(badRule.ok).toBe(false);
    expect(badKind.ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it("surfaces a labelled DB error as a CLEAN { ok:false } (no raw exception, no refresh)", async () => {
    const { client, rpc } = makeClient({
      insert: { data: null, error: { message: "ledger boom", code: "23514" } },
    });
    getSupabaseMock.mockReturnValue(client);

    const result = await bookCostEntry({
      driver: "worker-day",
      allocationRule: "direct-labor",
      targetKind: "lot",
      targetCode: "JC-701",
      amountUsd: 10,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("ledger boom");
    // a failed insert does NOT refresh the matview or revalidate
    expect(rpc).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("still succeeds (best-effort) when the refresh RPC errors — the append committed", async () => {
    const { client, insert } = makeClient({
      rpc: { data: null, error: { message: "refresh hiccup" } },
    });
    getSupabaseMock.mockReturnValue(client);

    const result = await bookCostEntry({
      driver: "worker-day",
      allocationRule: "direct-labor",
      targetKind: "lot",
      targetCode: "JC-701",
      amountUsd: 10,
    });

    // the ledger row is the source of truth; a refresh hiccup must not lose it.
    expect(result.ok).toBe(true);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(revalidatePathMock).toHaveBeenCalledWith("/costing");
  });
});
