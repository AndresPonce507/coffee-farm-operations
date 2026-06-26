import { describe, expect, it, vi } from "vitest";

import {
  enterAuctionLot,
  friendlyEnterAuctionLotError,
  validateEnterAuctionLot,
  type EnterAuctionLotStore,
} from "@/lib/db/commands/enterAuctionLot";

/**
 * Pure-domain command test for the auction-entry writer (P3-S4). Entering a lot
 * inserts a `lot_reservations` row keyed buyer='AUCTION:<name>' inside the
 * SECURITY DEFINER `enter_auction_lot` RPC — that insert fires the EXISTING
 * `prevent_oversell` + `_prevent_held_lot_commit` triggers, so the money guarantee
 * is REUSED (no parallel counter, no double-sell). This test proves the validation
 * seam (auction id, lot code, kg > 0), the exact snake_case envelope, the
 * fail-closed oversell / QC-hold / sold-auction rejections surfaced as CLEAN
 * sentences, and clean id return. Mirrors acceptQuote.test.ts.
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: EnterAuctionLotStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as EnterAuctionLotStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  auctionId: "7",
  greenLotCode: "JC-204",
  kg: "30",
  idempotencyKey: "idem-entry-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateEnterAuctionLot", () => {
  it("accepts a complete, well-formed entry", () => {
    const r = validateEnterAuctionLot(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.auctionId).toBe(7);
      expect(r.data.greenLotCode).toBe("JC-204");
      expect(r.data.kg).toBe(30);
    }
  });

  it("rejects a non-positive / non-integer auction id", () => {
    const zero = validateEnterAuctionLot({ ...validRaw(), auctionId: "0" });
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.errors.auctionId).toBeDefined();
  });

  it("rejects a missing green lot code", () => {
    const r = validateEnterAuctionLot({ ...validRaw(), greenLotCode: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.greenLotCode).toBeDefined();
  });

  it("rejects a non-positive kg (the kg > 0 CHECK)", () => {
    const r = validateEnterAuctionLot({ ...validRaw(), kg: "0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.kg).toMatch(/greater than 0/i);
  });

  it("rejects a missing idempotency key", () => {
    const r = validateEnterAuctionLot({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── friendly error mapper ─────────────────────────

describe("friendlyEnterAuctionLotError", () => {
  it("maps the prevent_oversell rejection to a family-readable sentence", () => {
    const msg = friendlyEnterAuctionLotError({
      message: "oversell guard: would exceed available-to-promise on JC-204",
    });
    expect(msg).toMatch(/available-to-promise/i);
  });

  it("maps the QC-hold commit block", () => {
    const msg = friendlyEnterAuctionLotError({
      message: "qc-hold: lot has an open QC-hold and cannot be reserved or shipped",
    });
    expect(msg).toMatch(/qc hold/i);
  });

  it("maps a sold/withdrawn auction rejection", () => {
    const msg = friendlyEnterAuctionLotError({
      message: "auction Best of Panama 2026 is sold — cannot enter a lot",
    });
    expect(msg).toMatch(/no longer accepting|sold|withdrawn|closed/i);
  });

  it("returns null for an unrecognised error", () => {
    expect(
      friendlyEnterAuctionLotError({ message: "some unrelated failure" }),
    ).toBeNull();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("enterAuctionLot", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await enterAuctionLot(store, { ...validRaw(), kg: "0" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls enter_auction_lot with the exact snake_case envelope and returns the entry id", async () => {
    const { store, rpc } = fakeStore({ data: 11, error: null });
    const result = await enterAuctionLot(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("enter_auction_lot", {
      p_auction_id: 7,
      p_green_lot_code: "JC-204",
      p_kg: 30,
      p_idempotency_key: "idem-entry-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entryId).toBe(11);
  });

  it("surfaces the oversell rejection as a CLEAN sentence", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "oversell guard: would exceed available-to-promise" },
    });
    const result = await enterAuctionLot(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/available-to-promise/i);
  });

  it("surfaces a generic labelled message for an unrecognised failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "deadlock detected" },
    });
    const result = await enterAuctionLot(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeDefined();
  });
});
