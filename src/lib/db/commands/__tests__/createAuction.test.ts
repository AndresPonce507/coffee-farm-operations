import { describe, expect, it, vi } from "vitest";

import {
  createAuction,
  validateCreateAuction,
  type CreateAuctionStore,
} from "@/lib/db/commands/createAuction";

/**
 * Pure-domain command test for the auction-header writer (P3-S4). Drives the
 * command against a fake `.rpc('create_auction', …)` store and proves the
 * friendly-validation seam (platform must be one of the `auction_platform` enum
 * values, name required, deadlines optional → null when blank), the exact
 * snake_case argument envelope, and clean error surfacing. The tenant clamp +
 * idempotency are the real enforcement (the migration's PGlite tests). Mirrors
 * recordAuctionComp.test.ts.
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: CreateAuctionStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as CreateAuctionStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  platform: "best_of_panama",
  name: "Best of Panama 2026",
  entryDeadline: "2026-03-01T00:00:00Z",
  scoringDeadline: "2026-05-01T00:00:00Z",
  idempotencyKey: "idem-auc-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateCreateAuction", () => {
  it("accepts a complete, well-formed auction", () => {
    const r = validateCreateAuction(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.platform).toBe("best_of_panama");
      expect(r.data.name).toBe("Best of Panama 2026");
      expect(r.data.entryDeadline).toBe("2026-03-01T00:00:00Z");
      expect(r.data.scoringDeadline).toBe("2026-05-01T00:00:00Z");
    }
  });

  it("accepts an auction with no deadlines (blank → null)", () => {
    const r = validateCreateAuction({
      platform: "private",
      name: "Private direct lot",
      idempotencyKey: "idem-x",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.entryDeadline).toBeNull();
      expect(r.data.scoringDeadline).toBeNull();
    }
  });

  it("rejects a platform outside the auction_platform enum", () => {
    const r = validateCreateAuction({ ...validRaw(), platform: "ebay" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.platform).toBeDefined();
  });

  it("rejects a missing platform", () => {
    const r = validateCreateAuction({ ...validRaw(), platform: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.platform).toBeDefined();
  });

  it("rejects a missing name", () => {
    const r = validateCreateAuction({ ...validRaw(), name: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.name).toBeDefined();
  });

  it("rejects a malformed entry deadline", () => {
    const r = validateCreateAuction({ ...validRaw(), entryDeadline: "not-a-date" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.entryDeadline).toBeDefined();
  });

  it("rejects a missing idempotency key", () => {
    const r = validateCreateAuction({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("createAuction", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await createAuction(store, { ...validRaw(), platform: "ebay" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls create_auction with the exact snake_case envelope and returns the auction id", async () => {
    const { store, rpc } = fakeStore({ data: 7, error: null });
    const result = await createAuction(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("create_auction", {
      p_platform: "best_of_panama",
      p_name: "Best of Panama 2026",
      p_entry_deadline: "2026-03-01T00:00:00Z",
      p_scoring_deadline: "2026-05-01T00:00:00Z",
      p_idempotency_key: "idem-auc-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.auctionId).toBe(7);
  });

  it("forwards null for blank deadlines", async () => {
    const { store, rpc } = fakeStore({ data: 1, error: null });
    await createAuction(store, {
      platform: "algrano",
      name: "Algrano round",
      idempotencyKey: "idem-y",
    });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_entry_deadline).toBeNull();
    expect(args.p_scoring_deadline).toBeNull();
  });

  it("surfaces a labelled error when the RPC fails", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "permission denied for table auctions" },
    });
    const result = await createAuction(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("permission denied");
  });
});
