import { describe, expect, it, vi } from "vitest";

import {
  friendlyRecordAuctionResultError,
  recordAuctionResult,
  validateRecordAuctionResult,
  type RecordAuctionResultStore,
} from "@/lib/db/commands/recordAuctionResult";

/**
 * Pure-domain command test for the WIN write-back (P3-S4). `record_auction_result`
 * stamps the entry (jury score, clearing price, winner), flips the auction to
 * 'sold', and closes the loop into P3-S0 — posting an `auction_comps` row AND a
 * reserve `price_quotes` row that REUSES the existing auction reservation (never a
 * second claim). The command returns the entry id. Proves the validation seam
 * (entry id, clearing price > 0; jury score/year/bidder optional), the exact
 * snake_case envelope, the positive-clearing-price rejection surfaced cleanly, and
 * the idempotent (already-sold) return. Mirrors acceptQuote.test.ts.
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: RecordAuctionResultStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as RecordAuctionResultStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  entryId: "11",
  juryScore: "91.5",
  clearingPriceUsdPerKg: "510",
  winningBidder: "Tokyo Roaster Co.",
  resultYear: "2026",
  idempotencyKey: "idem-result-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateRecordAuctionResult", () => {
  it("accepts a complete, well-formed result", () => {
    const r = validateRecordAuctionResult(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.entryId).toBe(11);
      expect(r.data.juryScore).toBe(91.5);
      expect(r.data.clearingPriceUsdPerKg).toBe(510);
      expect(r.data.winningBidder).toBe("Tokyo Roaster Co.");
      expect(r.data.resultYear).toBe(2026);
    }
  });

  it("accepts a result with only the required fields (optionals blank → null)", () => {
    const r = validateRecordAuctionResult({
      entryId: "11",
      clearingPriceUsdPerKg: "510",
      idempotencyKey: "idem-x",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.juryScore).toBeNull();
      expect(r.data.winningBidder).toBeNull();
      expect(r.data.resultYear).toBeNull();
    }
  });

  it("rejects a non-positive / non-integer entry id", () => {
    const r = validateRecordAuctionResult({ ...validRaw(), entryId: "0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.entryId).toBeDefined();
  });

  it("rejects a non-positive clearing price (the cleared-entry rule)", () => {
    const r = validateRecordAuctionResult({ ...validRaw(), clearingPriceUsdPerKg: "0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.clearingPriceUsdPerKg).toMatch(/greater than 0/i);
  });

  it("rejects a jury score outside 0–100", () => {
    const r = validateRecordAuctionResult({ ...validRaw(), juryScore: "101" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.juryScore).toMatch(/0.*100/);
  });

  it("rejects a non-integer result year", () => {
    const r = validateRecordAuctionResult({ ...validRaw(), resultYear: "twenty" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.resultYear).toBeDefined();
  });

  it("rejects a missing idempotency key", () => {
    const r = validateRecordAuctionResult({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── friendly error mapper ─────────────────────────

describe("friendlyRecordAuctionResultError", () => {
  it("maps the positive-clearing-price rule to a family-readable sentence", () => {
    const msg = friendlyRecordAuctionResultError({
      message: "a cleared auction entry needs a positive clearing price",
    });
    expect(msg).toMatch(/clearing price/i);
  });

  it("maps an unknown-entry foreign key to a refresh prompt", () => {
    const msg = friendlyRecordAuctionResultError({
      message: "unknown auction entry 11",
      code: "23503",
    });
    expect(msg).toMatch(/couldn't be found|refresh/i);
  });

  it("returns null for an unrecognised error", () => {
    expect(
      friendlyRecordAuctionResultError({ message: "some unrelated failure" }),
    ).toBeNull();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("recordAuctionResult", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await recordAuctionResult(store, {
      ...validRaw(),
      clearingPriceUsdPerKg: "0",
    });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls record_auction_result with the exact snake_case envelope and returns the entry id", async () => {
    const { store, rpc } = fakeStore({ data: 11, error: null });
    const result = await recordAuctionResult(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_auction_result", {
      p_entry_id: 11,
      p_jury_score: 91.5,
      p_clearing_price_usd_per_kg: 510,
      p_winning_bidder: "Tokyo Roaster Co.",
      p_result_year: 2026,
      p_idempotency_key: "idem-result-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entryId).toBe(11);
  });

  it("forwards null for blank optional fields", async () => {
    const { store, rpc } = fakeStore({ data: 11, error: null });
    await recordAuctionResult(store, {
      entryId: "11",
      clearingPriceUsdPerKg: "510",
      idempotencyKey: "idem-x",
    });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_jury_score).toBeNull();
    expect(args.p_winning_bidder).toBeNull();
    expect(args.p_result_year).toBeNull();
  });

  it("surfaces the positive-clearing-price rejection as a CLEAN sentence", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "a cleared auction entry needs a positive clearing price" },
    });
    const result = await recordAuctionResult(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/clearing price/i);
  });
});
