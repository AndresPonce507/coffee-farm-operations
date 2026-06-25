import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Server Actions call `await (await getSupabase()).rpc(...)` and (for the
// inventory-moving entry) reactiveRefresh → revalidatePath. Mock both: one rpc spy
// whose result each test sets, and a no-op next/cache. next-intl/server is mocked
// globally in setup.ts so getTranslations resolves the real EN copy.
const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => Promise.resolve({ rpc: rpcMock }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  createAuctionAction,
  enterAuctionLotAction,
  recordAuctionResultAction,
  recordScoresheetAction,
} from "@/app/(app)/sales/auctions/actions";

beforeEach(() => rpcMock.mockReset());
afterEach(() => vi.clearAllMocks());

/* ───────────────────────────── create_auction ───────────────────────────── */

describe("createAuctionAction", () => {
  const valid = () => ({
    platform: "best_of_panama",
    name: "Best of Panama 2026",
    entryDeadline: "2026-08-01",
    scoringDeadline: "2026-08-15",
    idempotencyKey: "idem-a",
  });

  it("rejects a blank name WITHOUT touching the database", async () => {
    const r = await createAuctionAction({ ...valid(), name: "   " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Name the auction.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("passes the EXACT snake_case envelope to create_auction", async () => {
    rpcMock.mockResolvedValue({ data: 7, error: null });
    const r = await createAuctionAction(valid());
    expect(r).toEqual({ ok: true, auctionId: 7 });
    expect(rpcMock).toHaveBeenCalledWith("create_auction", {
      p_platform: "best_of_panama",
      p_name: "Best of Panama 2026",
      p_entry_deadline: "2026-08-01",
      p_scoring_deadline: "2026-08-15",
      p_idempotency_key: "idem-a",
    });
  });
});

/* ─────────────────────────── enter_auction_lot ──────────────────────────── */

describe("enterAuctionLotAction — the inventory-committing entry", () => {
  const valid = () => ({
    auctionId: 1,
    greenLotCode: "JC-204",
    kg: 30,
    idempotencyKey: "idem-e",
  });

  it("rejects a non-positive kg WITHOUT touching the database", async () => {
    const r = await enterAuctionLotAction({ ...valid(), kg: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Kilograms must be greater than zero.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("passes the exact envelope to enter_auction_lot and returns the entry id", async () => {
    rpcMock.mockResolvedValue({ data: 42, error: null });
    const r = await enterAuctionLotAction(valid());
    expect(r).toEqual({ ok: true, entryId: 42 });
    expect(rpcMock).toHaveBeenCalledWith("enter_auction_lot", {
      p_auction_id: 1,
      p_green_lot_code: "JC-204",
      p_kg: 30,
      p_idempotency_key: "idem-e",
    });
  });

  it("surfaces the oversell guard message verbatim (never a raw SQLSTATE leak)", async () => {
    const guard =
      "oversell guard: committing 70 kg to green lot JC-204 would exceed its 50 kg available-to-promise";
    rpcMock.mockResolvedValue({ data: null, error: { message: guard, code: "23514" } });
    const r = await enterAuctionLotAction(valid());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe(guard);
      expect(r.error).not.toMatch(/SQLSTATE|23514/);
    }
  });

  it("maps an unknown structural Postgres error to clean generic copy", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'relation "auction_entries" does not exist', code: "42P01" },
    });
    const r = await enterAuctionLotAction(valid());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("Could not save that. Check the numbers and try again.");
      expect(r.error).not.toMatch(/relation|auction_entries/);
    }
  });
});

/* ───────────────────────── record_auction_scoresheet ─────────────────────── */

describe("recordScoresheetAction", () => {
  const valid = () => ({
    entryId: 10,
    juror: "  Ana ",
    attribute: " Aroma ",
    score: 8.5,
    idempotencyKey: "idem-s",
  });

  it("rejects a score outside 0..100 WITHOUT touching the database", async () => {
    const r = await recordScoresheetAction({ ...valid(), score: 140 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Score has to be between 0 and 100.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("trims and passes the exact envelope to record_auction_scoresheet", async () => {
    rpcMock.mockResolvedValue({ data: 99, error: null });
    const r = await recordScoresheetAction(valid());
    expect(r).toEqual({ ok: true, scoresheetId: 99 });
    expect(rpcMock).toHaveBeenCalledWith("record_auction_scoresheet", {
      p_entry_id: 10,
      p_juror: "Ana",
      p_attribute: "Aroma",
      p_score: 8.5,
      p_idempotency_key: "idem-s",
    });
  });
});

/* ────────────────────────── record_auction_result ───────────────────────── */

describe("recordAuctionResultAction — the money-shaped write", () => {
  const valid = () => ({
    entryId: 10,
    juryScore: 91.5,
    clearingPriceUsdPerKg: 510,
    winningBidder: "  Tokyo Roasters ",
    resultYear: 2026,
    idempotencyKey: "idem-r",
  });

  it("rejects a non-positive clearing price WITHOUT touching the database", async () => {
    const r = await recordAuctionResultAction({ ...valid(), clearingPriceUsdPerKg: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Enter a clearing price greater than zero.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("trims the bidder and passes the exact envelope to record_auction_result", async () => {
    rpcMock.mockResolvedValue({ data: 10, error: null });
    const r = await recordAuctionResultAction(valid());
    expect(r).toEqual({ ok: true, entryId: 10 });
    expect(rpcMock).toHaveBeenCalledWith("record_auction_result", {
      p_entry_id: 10,
      p_jury_score: 91.5,
      p_clearing_price_usd_per_kg: 510,
      p_winning_bidder: "Tokyo Roasters",
      p_result_year: 2026,
      p_idempotency_key: "idem-r",
    });
  });
});
