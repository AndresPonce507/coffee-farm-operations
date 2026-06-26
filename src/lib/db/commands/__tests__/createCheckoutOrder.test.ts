import { describe, expect, it, vi } from "vitest";

import {
  createCheckoutOrder,
  validateCreateCheckoutOrder,
  type CreateCheckoutOrderStore,
} from "@/lib/db/commands/createCheckoutOrder";

/**
 * Pure-domain command test for the Stripe hosted-Checkout order entry (P3-S12).
 * `create_checkout_order` delegates to `create_order` (web channel, same server-side
 * total compute + finished-goods allocation) then stamps the Stripe checkout session
 * id — so this command takes NO channel and NO client total. Drives the command against
 * a fake `.rpc('create_checkout_order', …)` store and proves the validation seam, the
 * exact snake_case envelope (p_lines as [{sku_id, qty_units}], p_stripe_checkout_session),
 * and clean error mapping. PCI scope stays in Stripe's hosted page; we only persist ids.
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: CreateCheckoutOrderStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as CreateCheckoutOrderStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  customerEmail: "ana@example.com",
  customerName: "Ana",
  currency: "USD",
  lines: [{ skuId: 3, qtyUnits: 2 }],
  stripeCheckoutSession: "cs_test_123",
  idempotencyKey: "idem-checkout-1",
});

describe("validateCreateCheckoutOrder", () => {
  it("accepts a complete, well-formed checkout", () => {
    const r = validateCreateCheckoutOrder(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.stripeCheckoutSession).toBe("cs_test_123");
      expect(r.data.lines).toEqual([{ skuId: 3, qtyUnits: 2 }]);
    }
  });

  it("rejects a missing stripe checkout session", () => {
    const r = validateCreateCheckoutOrder({ ...validRaw(), stripeCheckoutSession: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.stripeCheckoutSession).toBeDefined();
  });

  it("rejects a malformed email and an empty cart (reused order validation)", () => {
    expect(validateCreateCheckoutOrder({ ...validRaw(), customerEmail: "nope" }).ok).toBe(false);
    expect(validateCreateCheckoutOrder({ ...validRaw(), lines: [] }).ok).toBe(false);
  });

  it("rejects a missing idempotency key", () => {
    const r = validateCreateCheckoutOrder({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

describe("createCheckoutOrder", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await createCheckoutOrder(store, { ...validRaw(), lines: [] });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls create_checkout_order with the exact snake_case envelope", async () => {
    const { store, rpc } = fakeStore({ data: 50, error: null });
    const result = await createCheckoutOrder(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("create_checkout_order", {
      p_customer_email: "ana@example.com",
      p_customer_name: "Ana",
      p_currency: "USD",
      p_lines: [{ sku_id: 3, qty_units: 2 }],
      p_stripe_checkout_session: "cs_test_123",
      p_idempotency_key: "idem-checkout-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.orderId).toBe(50);
  });

  it("maps a finished-goods oversell to a clean sentence", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "insufficient finished goods available" },
    });
    const result = await createCheckoutOrder(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/out of stock|enough/i);
  });

  it("coerces a string id from PostgREST to a number", async () => {
    const { store } = fakeStore({ data: "51", error: null });
    const result = await createCheckoutOrder(store, validRaw());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.orderId).toBe(51);
  });
});
