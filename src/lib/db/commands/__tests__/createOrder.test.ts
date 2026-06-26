import { describe, expect, it, vi } from "vitest";

import {
  createOrder,
  validateCreateOrder,
  type CreateOrderStore,
} from "@/lib/db/commands/createOrder";

/**
 * Pure-domain command test for the DTC order writer (P3-S12 — DTC orders + Stripe
 * Checkout; §1 rail 1 — every write flows through a SECURITY DEFINER RPC). This file
 * does NOT touch a database: it drives the command against a *fake store* stubbing the
 * one method it calls, `.rpc('create_order', …)`, and proves (a) the friendly-validation
 * seam, (b) the exact snake_case argument envelope (incl. p_lines as a [{sku_id,
 * qty_units}] array — the shape the RPC's jsonb loop reads), and (c) that a DB failure
 * (unknown SKU, finished-goods oversell from record_fg_movement) surfaces a clean
 * labelled message, never raw Postgres. The SERVER-SIDE total compute + the fail-closed
 * finished-goods guard are the *real* enforcement (proven by the migration's PGlite tests).
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: CreateOrderStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as CreateOrderStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  customerEmail: "ana@example.com",
  customerName: "Ana",
  channel: "web",
  currency: "USD",
  lines: [
    { skuId: 3, qtyUnits: 2 },
    { skuId: 4, qtyUnits: 1 },
  ],
  idempotencyKey: "idem-order-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateCreateOrder", () => {
  it("accepts a complete, well-formed order", () => {
    const r = validateCreateOrder(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.customerEmail).toBe("ana@example.com");
      expect(r.data.customerName).toBe("Ana");
      expect(r.data.channel).toBe("web");
      expect(r.data.currency).toBe("USD");
      expect(r.data.lines).toEqual([
        { skuId: 3, qtyUnits: 2 },
        { skuId: 4, qtyUnits: 1 },
      ]);
    }
  });

  it("defaults a blank currency to USD and a blank name to null", () => {
    const r = validateCreateOrder({ ...validRaw(), currency: "", customerName: "" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.currency).toBe("USD");
      expect(r.data.customerName).toBeNull();
    }
  });

  it("accepts each order_channel enum value", () => {
    for (const c of ["web", "pos", "wholesale"]) {
      const r = validateCreateOrder({ ...validRaw(), channel: c });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.channel).toBe(c);
    }
  });

  it("rejects an unknown channel", () => {
    const r = validateCreateOrder({ ...validRaw(), channel: "phone" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.channel).toBeDefined();
  });

  it("rejects a missing / malformed email", () => {
    const missing = validateCreateOrder({ ...validRaw(), customerEmail: "" });
    expect(missing.ok).toBe(false);
    const bad = validateCreateOrder({ ...validRaw(), customerEmail: "nope" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.customerEmail).toBeDefined();
  });

  it("rejects an order with no lines", () => {
    const r = validateCreateOrder({ ...validRaw(), lines: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.lines).toBeDefined();
  });

  it("rejects a line with a non-positive qty (the qty_units > 0 CHECK)", () => {
    const r = validateCreateOrder({
      ...validRaw(),
      lines: [{ skuId: 3, qtyUnits: 0 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.lines).toMatch(/quantity|greater than 0/i);
  });

  it("rejects a line with a missing / invalid sku id", () => {
    const r = validateCreateOrder({
      ...validRaw(),
      lines: [{ skuId: "x", qtyUnits: 1 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.lines).toBeDefined();
  });

  it("rejects a missing idempotency key", () => {
    const r = validateCreateOrder({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("createOrder", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await createOrder(store, { ...validRaw(), lines: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.lines).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls create_order with the exact snake_case envelope (p_lines as sku_id/qty_units)", async () => {
    const { store, rpc } = fakeStore({ data: 42, error: null });
    const result = await createOrder(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("create_order", {
      p_customer_email: "ana@example.com",
      p_customer_name: "Ana",
      p_channel: "web",
      p_currency: "USD",
      p_lines: [
        { sku_id: 3, qty_units: 2 },
        { sku_id: 4, qty_units: 1 },
      ],
      p_idempotency_key: "idem-order-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.orderId).toBe(42);
  });

  it("forwards a null p_customer_name when the name is blank", async () => {
    const { store, rpc } = fakeStore({ data: 43, error: null });
    await createOrder(store, { ...validRaw(), customerName: "" });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_customer_name).toBeNull();
  });

  it("maps a finished-goods oversell rejection to a clean sentence (the S11 guard)", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "record_fg_movement: insufficient finished goods available" },
    });
    const result = await createOrder(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/out of stock|enough/i);
      expect(result.message).not.toMatch(/record_fg_movement/);
    }
  });

  it("maps an unknown SKU to a clean sentence", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "unknown sku 999", code: "23503" },
    });
    const result = await createOrder(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/item|couldn't be found/i);
  });

  it("coerces a string id from PostgREST to a number", async () => {
    const { store } = fakeStore({ data: "44", error: null });
    const result = await createOrder(store, validRaw());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.orderId).toBe(44);
  });

  it("falls back to a generic labelled message on an unrecognised error", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "some weird pg failure" },
    });
    const result = await createOrder(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBeTruthy();
      expect(result.message).not.toMatch(/weird pg failure/);
    }
  });
});
