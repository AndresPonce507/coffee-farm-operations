import { describe, expect, it, vi } from "vitest";

import {
  recordAuctionScoresheet,
  validateRecordAuctionScoresheet,
  type RecordAuctionScoresheetStore,
} from "@/lib/db/commands/recordAuctionScoresheet";

/**
 * Pure-domain command test for the append-only jury-mark writer (P3-S4). Each mark
 * is a row in the append-only `auction_scoresheets` ledger (immutability triggers
 * reject UPDATE/DELETE); `record_auction_scoresheet` is the single write door,
 * tenant-clamped + idempotent, and it bumps the auction 'entered'→'scored' once
 * capture begins. Proves the validation seam (entry id, juror, attribute, score
 * 0–100), the exact snake_case envelope, and clean error surfacing. Mirrors
 * recordAuctionComp.test.ts.
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: RecordAuctionScoresheetStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as RecordAuctionScoresheetStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  entryId: "11",
  juror: "Juror A",
  attribute: "Aroma",
  score: "9.25",
  idempotencyKey: "idem-mark-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateRecordAuctionScoresheet", () => {
  it("accepts a complete, well-formed mark", () => {
    const r = validateRecordAuctionScoresheet(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.entryId).toBe(11);
      expect(r.data.juror).toBe("Juror A");
      expect(r.data.attribute).toBe("Aroma");
      expect(r.data.score).toBe(9.25);
    }
  });

  it("rejects a non-positive / non-integer entry id", () => {
    const r = validateRecordAuctionScoresheet({ ...validRaw(), entryId: "0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.entryId).toBeDefined();
  });

  it("rejects a missing juror", () => {
    const r = validateRecordAuctionScoresheet({ ...validRaw(), juror: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.juror).toBeDefined();
  });

  it("rejects a missing attribute", () => {
    const r = validateRecordAuctionScoresheet({ ...validRaw(), attribute: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.attribute).toBeDefined();
  });

  it("rejects a score outside 0–100 (the score CHECK)", () => {
    const high = validateRecordAuctionScoresheet({ ...validRaw(), score: "101" });
    expect(high.ok).toBe(false);
    if (!high.ok) expect(high.errors.score).toMatch(/0.*100/);

    const missing = validateRecordAuctionScoresheet({ ...validRaw(), score: "" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors.score).toBeDefined();
  });

  it("rejects a missing idempotency key", () => {
    const r = validateRecordAuctionScoresheet({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("recordAuctionScoresheet", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await recordAuctionScoresheet(store, { ...validRaw(), score: "101" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls record_auction_scoresheet with the exact snake_case envelope and returns the mark id", async () => {
    const { store, rpc } = fakeStore({ data: 3, error: null });
    const result = await recordAuctionScoresheet(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_auction_scoresheet", {
      p_entry_id: 11,
      p_juror: "Juror A",
      p_attribute: "Aroma",
      p_score: 9.25,
      p_idempotency_key: "idem-mark-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.scoresheetId).toBe(3);
  });

  it("surfaces a labelled error when the RPC fails", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "unknown auction entry 11 for tenant", code: "23503" },
    });
    const result = await recordAuctionScoresheet(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeDefined();
  });
});
