import { describe, expect, it, vi } from "vitest";

import {
  recordAuctionComp,
  validateRecordAuctionComp,
  type RecordAuctionCompStore,
} from "@/lib/db/commands/recordAuctionComp";

/**
 * Pure-domain command test for the append-only reserve auction-comp writer (P3-S0).
 * Drives the command against a fake `.rpc('record_auction_comp', …)` store and
 * proves the friendly-validation seam, the exact snake_case argument envelope
 * (incl. optional label/variety/process/score/year forwarded as null when blank),
 * and clean error surfacing. The append-only immutability + tenant clamp are the
 * real enforcement (the migration's PGlite tests). Mirrors advanceProcessingStage.test.ts.
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: RecordAuctionCompStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as RecordAuctionCompStore, rpc };
}

/** The $30,204/kg 2025 BoP washed-Geisha anchor — the canonical comp shape. */
const validRaw = (): Record<string, unknown> => ({
  auctionName: "Best of Panama",
  lotLabel: "Washed Geisha (champion lot)",
  variety: "Geisha",
  process: "Washed",
  cupScore: "94",
  priceUsdPerKg: "30204",
  resultYear: "2025",
  idempotencyKey: "idem-comp-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateRecordAuctionComp", () => {
  it("accepts a complete, well-formed comp", () => {
    const r = validateRecordAuctionComp(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.auctionName).toBe("Best of Panama");
      expect(r.data.cupScore).toBe(94);
      expect(r.data.priceUsdPerKg).toBe(30204);
      expect(r.data.resultYear).toBe(2025);
    }
  });

  it("accepts a comp with only the required fields (optionals blank → null)", () => {
    const r = validateRecordAuctionComp({
      auctionName: "Cup of Excellence",
      priceUsdPerKg: "120",
      idempotencyKey: "idem-x",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.lotLabel).toBeNull();
      expect(r.data.variety).toBeNull();
      expect(r.data.process).toBeNull();
      expect(r.data.cupScore).toBeNull();
      expect(r.data.resultYear).toBeNull();
    }
  });

  it("rejects a missing auction name", () => {
    const r = validateRecordAuctionComp({ ...validRaw(), auctionName: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.auctionName).toBeDefined();
  });

  it("rejects a non-positive price (the price_usd_per_kg > 0 CHECK)", () => {
    const r = validateRecordAuctionComp({ ...validRaw(), priceUsdPerKg: "0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.priceUsdPerKg).toMatch(/greater than 0/i);
  });

  it("rejects a cup score outside 0–100 (the cup_score CHECK)", () => {
    const high = validateRecordAuctionComp({ ...validRaw(), cupScore: "101" });
    expect(high.ok).toBe(false);
    if (!high.ok) expect(high.errors.cupScore).toMatch(/0.*100/);
  });

  it("rejects a non-integer result year", () => {
    const r = validateRecordAuctionComp({ ...validRaw(), resultYear: "twenty" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.resultYear).toBeDefined();
  });

  it("rejects a missing idempotency key", () => {
    const r = validateRecordAuctionComp({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("recordAuctionComp", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await recordAuctionComp(store, {
      ...validRaw(),
      auctionName: "",
    });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls record_auction_comp with the exact snake_case envelope and returns the comp id", async () => {
    const { store, rpc } = fakeStore({ data: 42, error: null });
    const result = await recordAuctionComp(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_auction_comp", {
      p_auction_name: "Best of Panama",
      p_lot_label: "Washed Geisha (champion lot)",
      p_variety: "Geisha",
      p_process: "Washed",
      p_cup_score: 94,
      p_price_usd_per_kg: 30204,
      p_result_year: 2025,
      p_idempotency_key: "idem-comp-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.compId).toBe(42);
  });

  it("forwards null for blank optional fields", async () => {
    const { store, rpc } = fakeStore({ data: 1, error: null });
    await recordAuctionComp(store, {
      auctionName: "Cup of Excellence",
      priceUsdPerKg: "120",
      idempotencyKey: "idem-x",
    });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_lot_label).toBeNull();
    expect(args.p_variety).toBeNull();
    expect(args.p_process).toBeNull();
    expect(args.p_cup_score).toBeNull();
    expect(args.p_result_year).toBeNull();
  });

  it("surfaces a labelled error when the RPC fails", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "permission denied for table auction_comps" },
    });
    const result = await recordAuctionComp(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("permission denied");
  });
});
