import { describe, expect, it, vi } from "vitest";

import {
  settleArPayment,
  validateSettleArPayment,
  type SettleArPaymentStore,
} from "@/lib/db/commands/settleArPayment";

/**
 * Pure-domain command test for settling an AR payment (P3-S17 — `settle_ar_payment`).
 * The S16 cap + recompute triggers do the heavy lifting (overpayment guard,
 * DETERMINISTIC status); on full settlement the RPC books the realized two-rate FX.
 * This is a MONEY-SHAPED write — confirm-gated in the UI, never auto (§1.7). Drives
 * the command against a fake `.rpc('settle_ar_payment', …)` store and proves the
 * validation seam, the exact snake_case envelope (including `p_enqueue_sync`), and the
 * fail-closed surfaces:
 *   - OVERPAYMENT (the S16 cap — a scarce invoice can't be double-collected),
 *   - paying a VOID doc,
 *   - an OFF-BOOK FX rate,
 *   - an unknown doc.
 * The exactly-once idempotency_key is the gateway event id (Stripe/Yappy webhook).
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: SettleArPaymentStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as SettleArPaymentStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  arDocId: "42",
  method: "wire",
  amountDoc: "13500",
  currency: "USD",
  idempotencyKey: "stripe-evt-abc",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateSettleArPayment", () => {
  it("accepts a complete, well-formed settlement", () => {
    const r = validateSettleArPayment(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.arDocId).toBe(42);
      expect(r.data.method).toBe("wire");
      expect(r.data.amountDoc).toBe(13500);
      expect(r.data.currency).toBe("USD");
      expect(r.data.enqueueSync).toBe(true); // defaults on
      expect(r.data.idempotencyKey).toBe("stripe-evt-abc");
    }
  });

  it("defaults currency to USD when omitted and honours an explicit enqueueSync=false", () => {
    const { currency: _c, ...rest } = validRaw();
    const r = validateSettleArPayment({ ...rest, enqueueSync: false });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.currency).toBe("USD");
      expect(r.data.enqueueSync).toBe(false);
    }
  });

  it("rejects a missing / non-positive ar_doc id", () => {
    const missing = validateSettleArPayment({ ...validRaw(), arDocId: "" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors.arDocId).toBeDefined();

    const zero = validateSettleArPayment({ ...validRaw(), arDocId: "0" });
    expect(zero.ok).toBe(false);
  });

  it("rejects an unknown payment method", () => {
    const r = validateSettleArPayment({ ...validRaw(), method: "crypto" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.method).toBeDefined();
  });

  it("rejects a non-positive amount (the DB CHECK is amount_doc > 0)", () => {
    const zero = validateSettleArPayment({ ...validRaw(), amountDoc: "0" });
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.errors.amountDoc).toBeDefined();

    const neg = validateSettleArPayment({ ...validRaw(), amountDoc: "-100" });
    expect(neg.ok).toBe(false);
  });

  it("rejects a missing idempotency key", () => {
    const r = validateSettleArPayment({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("settleArPayment", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await settleArPayment(store, { ...validRaw(), amountDoc: "0" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls settle_ar_payment with the exact snake_case envelope and returns the payment id", async () => {
    const { store, rpc } = fakeStore({ data: 99, error: null });
    const result = await settleArPayment(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("settle_ar_payment", {
      p_ar_doc_id: 42,
      p_method: "wire",
      p_amount_doc: 13500,
      p_currency: "USD",
      p_idempotency_key: "stripe-evt-abc",
      p_enqueue_sync: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.paymentId).toBe(99);
  });

  it("passes p_enqueue_sync=false when settling an externally-recorded payment", async () => {
    const { store, rpc } = fakeStore({ data: 100, error: null });
    await settleArPayment(store, { ...validRaw(), enqueueSync: false });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_enqueue_sync).toBe(false);
  });

  it("surfaces the OVERPAYMENT cap as a friendly balance message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        code: "23514",
        message: "overpayment: paid 13500 + 1000 would exceed doc total 13500",
      },
    });
    const result = await settleArPayment(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/balance|outstanding|overpay|more than/i);
      expect(result.message).not.toMatch(/overpayment:|check_violation/);
    }
  });

  it("surfaces a payment against a VOID doc as a friendly message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        code: "23514",
        message: "ar_doc 42 is void — it cannot accept a payment",
      },
    });
    const result = await settleArPayment(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/void|cancel/i);
  });

  it("surfaces an OFF-BOOK FX rate as a friendly record-the-rate message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        code: "23503",
        message: "off-book FX: no fx_rate for EUR→USD on the books; record the rate first",
      },
    });
    const result = await settleArPayment(store, { ...validRaw(), currency: "EUR" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/exchange rate|fx|rate/i);
      expect(result.message).not.toMatch(/off-book FX:/);
    }
  });

  it("surfaces an unknown ar_doc as a friendly not-found message", async () => {
    const { store } = fakeStore({
      data: null,
      error: { code: "23503", message: "unknown ar_doc 999" },
    });
    const result = await settleArPayment(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/invoice|found/i);
  });

  it("falls back to a labelled message for an unrecognised RPC failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "deadlock detected" },
    });
    const result = await settleArPayment(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });
});
