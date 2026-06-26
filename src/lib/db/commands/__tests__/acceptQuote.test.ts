import { describe, expect, it, vi } from "vitest";

import {
  acceptQuote,
  validateAcceptQuote,
  type AcceptQuoteStore,
} from "@/lib/db/commands/acceptQuote";

/**
 * Pure-domain command test for accepting a price quote (P3-S0). Accepting a quote
 * INSERTS a `lot_reservations` row inside the SECURITY DEFINER RPC, so the EXISTING
 * `prevent_oversell` + `_prevent_held_lot_commit` triggers fire — the money
 * guarantee is REUSED, not rebuilt. Drives the command against a fake
 * `.rpc('accept_quote', …)` store and proves the friendly-validation seam, the
 * exact snake_case argument envelope, and — the load-bearing cases — that the
 * fail-closed guards surface CLEAN, family-readable errors:
 *   - OVERSELL (committing more than available-to-promise),
 *   - QC-HOLD (the lot is quarantined),
 *   - an unknown / non-quoted quote.
 * The triggers are the real enforcement (the migration's PGlite + s5/s6 tests).
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: AcceptQuoteStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as AcceptQuoteStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  quoteId: "101",
  buyer: "Onyx Coffee Lab",
  idempotencyKey: "idem-acc-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateAcceptQuote", () => {
  it("accepts a complete, well-formed acceptance", () => {
    const r = validateAcceptQuote(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.quoteId).toBe(101);
      expect(r.data.buyer).toBe("Onyx Coffee Lab");
      expect(r.data.idempotencyKey).toBe("idem-acc-1");
    }
  });

  it("also accepts the quote id under the UI's `priceQuoteId` field", () => {
    const r = validateAcceptQuote({
      priceQuoteId: "202",
      buyer: "Onyx Coffee Lab",
      idempotencyKey: "idem-acc-2",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.quoteId).toBe(202);
  });

  it("rejects a missing / non-numeric quote id", () => {
    const missing = validateAcceptQuote({ ...validRaw(), quoteId: "" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors.quoteId).toBeDefined();

    const nan = validateAcceptQuote({ ...validRaw(), quoteId: "abc" });
    expect(nan.ok).toBe(false);
  });

  it("rejects a non-positive / non-integer quote id", () => {
    const zero = validateAcceptQuote({ ...validRaw(), quoteId: "0" });
    expect(zero.ok).toBe(false);

    const frac = validateAcceptQuote({ ...validRaw(), quoteId: "1.5" });
    expect(frac.ok).toBe(false);
  });

  it("rejects a missing buyer", () => {
    const r = validateAcceptQuote({ ...validRaw(), buyer: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.buyer).toMatch(/buyer/i);
  });

  it("rejects a missing idempotency key", () => {
    const r = validateAcceptQuote({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("acceptQuote", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await acceptQuote(store, { ...validRaw(), buyer: "" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls accept_quote with the exact snake_case envelope and returns the reservation id", async () => {
    const { store, rpc } = fakeStore({ data: 555, error: null });
    const result = await acceptQuote(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("accept_quote", {
      p_quote_id: 101,
      p_buyer: "Onyx Coffee Lab",
      p_idempotency_key: "idem-acc-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.reservationId).toBe(555);
  });

  it("surfaces the OVERSELL guard (reused money guarantee) as a friendly availability message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        code: "23514",
        message:
          "oversell guard: committing 60 kg to green lot JC-820 would exceed its 50 kg available-to-promise (40 already committed)",
      },
    });
    const result = await acceptQuote(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/available|enough|oversell|exceed/i);
      expect(result.message).not.toMatch(/oversell guard:|check_violation/);
    }
  });

  it("surfaces the QC-HOLD commit block as a friendly quarantine message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        code: "23514",
        message:
          "qc-hold: green lot JC-820 is under an open QC-HOLD and cannot be reserved or shipped",
      },
    });
    const result = await acceptQuote(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/hold|quarantin/i);
      expect(result.message).not.toMatch(/qc-hold:|check_violation/);
    }
  });

  it("surfaces an unknown quote as a friendly not-found message", async () => {
    const { store } = fakeStore({
      data: null,
      error: { code: "23503", message: "unknown quote 999" },
    });
    const result = await acceptQuote(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/quote|found/i);
  });

  it("surfaces a non-quoted (already accepted/cancelled) quote as a friendly message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        code: "23514",
        message: "quote 101 cannot be accepted from status cancelled",
      },
    });
    const result = await acceptQuote(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/accept|already|cancel/i);
  });

  it("falls back to a labelled message for an unrecognised RPC failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "deadlock detected" },
    });
    const result = await acceptQuote(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });
});
