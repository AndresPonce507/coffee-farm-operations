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

/**
 * A Supabase-client stand-in: `.from().insert()` for the append, `.rpc()` for the
 * `reaches_green` reachability gate AND the `refresh_lot_cost` refresh. The two
 * RPCs are dispatched by name so a test can fail the gate (reaches=false) while
 * leaving the refresh stub default. `reaches` defaults to `true` (the target
 * reaches COGS) so the happy-path tests don't have to opt in.
 */
function makeClient(opts?: {
  insert?: { data: unknown; error: { message: string; code?: string } | null };
  reaches?: {
    data: unknown;
    error: { message: string; code?: string } | null;
  };
  rpc?: { data: unknown; error: { message: string } | null };
}): {
  client: unknown;
  insert: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
} {
  const insert = vi.fn(() =>
    Promise.resolve(opts?.insert ?? { data: null, error: null }),
  );
  const rpc = vi.fn((name: string) => {
    if (name === "reaches_green") {
      return Promise.resolve(opts?.reaches ?? { data: true, error: null });
    }
    return Promise.resolve(opts?.rpc ?? { data: null, error: null });
  });
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
    // the reachability gate fires FIRST with the lot's target, BEFORE the append
    expect(rpc).toHaveBeenCalledWith("reaches_green", {
      p_target_kind: "lot",
      p_target_code: "JC-701",
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
    // a farm target passes a NULL code to the reachability gate (farm reaches
    // green iff any green lot exists — not a per-code lookup).
    expect(rpc).toHaveBeenCalledWith("reaches_green", {
      p_target_kind: "farm",
      p_target_code: null,
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
    // a CHECK violation (23514) carries an author-written, already-friendly
    // message (the shape/immutability guards) so it surfaces verbatim.
    if (!result.ok) expect(result.error).toContain("ledger boom");
    // a failed insert does NOT refresh the matview or revalidate (the
    // reachability gate may have run, but the refresh seam never does).
    expect(rpc).not.toHaveBeenCalledWith("refresh_lot_cost");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("rejects a lot whose cost would NOT reach a green terminal — no insert, no refresh (the COGS-orphan guard)", async () => {
    const { client, insert, rpc } = makeClient({
      reaches: { data: false, error: null }, // this lot reaches no green lot
    });
    getSupabaseMock.mockReturnValue(client);

    const result = await bookCostEntry({
      driver: "worker-day",
      allocationRule: "direct-labor",
      targetKind: "lot",
      targetCode: "JC-541", // an everyday harvest lot, stage NULL, no edges
      amountUsd: 42.5,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/green|reach|cost-per-kg-green/i);
      // the friendly message names the failure mode, not a raw SQL string
      expect(result.error).not.toMatch(/SQLSTATE|23514|null value|violates/i);
    }
    // the gate fired with this lot, and the append/refresh did NOT
    expect(rpc).toHaveBeenCalledWith("reaches_green", {
      p_target_kind: "lot",
      p_target_code: "JC-541",
    });
    expect(insert).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith("refresh_lot_cost");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("rejects a nonexistent target_code (the reachability gate returns false) — no insert", async () => {
    const { client, insert } = makeClient({
      reaches: { data: false, error: null }, // no such lot → reaches no green
    });
    getSupabaseMock.mockReturnValue(client);

    const result = await bookCostEntry({
      driver: "worker-day",
      allocationRule: "direct-labor",
      targetKind: "lot",
      targetCode: "JC-ZZZ", // a target that does not exist (#26)
      amountUsd: 10,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/green|reach/i);
    expect(insert).not.toHaveBeenCalled();
  });

  it("surfaces a FRIENDLY error (never the raw Postgres string) on an insert failure", async () => {
    const { client } = makeClient({
      insert: {
        data: null,
        error: {
          message:
            'null value in column "amount_usd" violates not-null constraint',
          code: "23502",
        },
      },
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
    if (!result.ok) {
      // the raw Postgres internals must NOT leak to the family-facing UI
      expect(result.error).not.toMatch(
        /violates|not-null constraint|column "amount_usd"|23502/i,
      );
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it("does NOT call the reachability gate before the shape validation rejects (no wasted round-trip)", async () => {
    const { client, rpc } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await bookCostEntry({
      driver: "worker-day",
      allocationRule: "direct-labor",
      targetKind: "lot",
      targetCode: "", // illegal shape — caught before any RPC
      amountUsd: 10,
    });

    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
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
