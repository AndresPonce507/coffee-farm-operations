import { describe, expect, it, vi } from "vitest";

import {
  createSubscription,
  validateCreateSubscription,
  SUB_CADENCES,
  type CreateSubscriptionStore,
} from "@/lib/db/commands/createSubscription";

/**
 * Pure-domain command test for the Reserve-Club subscription writer (P3-S12). Mints a
 * subscription + one line + a 'created' sub_event inside the SECURITY DEFINER
 * `create_subscription` RPC (idempotent on a tenant-qualified key). Drives the command
 * against a fake `.rpc('create_subscription', …)` store and proves the validation seam
 * (the sub_cadence enum, qty_units > 0, a real SKU), the exact snake_case envelope (incl.
 * a null p_stripe_subscription_id at $0 before Stripe Billing), and clean error mapping.
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: CreateSubscriptionStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as CreateSubscriptionStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  customerEmail: "luis@example.com",
  customerName: "Luis",
  skuId: 3,
  cadence: "monthly",
  qtyUnits: 1,
  stripeSubscriptionId: "sub_abc",
  idempotencyKey: "idem-sub-1",
});

describe("validateCreateSubscription", () => {
  it("accepts a complete, well-formed subscription", () => {
    const r = validateCreateSubscription(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.skuId).toBe(3);
      expect(r.data.cadence).toBe("monthly");
      expect(r.data.qtyUnits).toBe(1);
      expect(r.data.stripeSubscriptionId).toBe("sub_abc");
    }
  });

  it("accepts each sub_cadence enum value", () => {
    for (const c of SUB_CADENCES) {
      const r = validateCreateSubscription({ ...validRaw(), cadence: c });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.cadence).toBe(c);
    }
    expect(SUB_CADENCES).toEqual(["monthly", "bi-monthly", "quarterly"]);
  });

  it("rejects an unknown cadence", () => {
    const r = validateCreateSubscription({ ...validRaw(), cadence: "weekly" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.cadence).toBeDefined();
  });

  it("treats a blank stripe subscription id as null (the $0 pre-Billing path)", () => {
    const r = validateCreateSubscription({ ...validRaw(), stripeSubscriptionId: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.stripeSubscriptionId).toBeNull();
  });

  it("rejects a non-positive qty (the qty_units > 0 CHECK)", () => {
    const r = validateCreateSubscription({ ...validRaw(), qtyUnits: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.qtyUnits).toMatch(/greater than 0/i);
  });

  it("rejects a missing / invalid sku id", () => {
    expect(validateCreateSubscription({ ...validRaw(), skuId: "" }).ok).toBe(false);
    expect(validateCreateSubscription({ ...validRaw(), skuId: 0 }).ok).toBe(false);
  });

  it("rejects a malformed email and a missing idempotency key", () => {
    expect(validateCreateSubscription({ ...validRaw(), customerEmail: "nope" }).ok).toBe(false);
    expect(validateCreateSubscription({ ...validRaw(), idempotencyKey: "" }).ok).toBe(false);
  });
});

describe("createSubscription", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await createSubscription(store, { ...validRaw(), cadence: "weekly" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls create_subscription with the exact snake_case envelope", async () => {
    const { store, rpc } = fakeStore({ data: 9, error: null });
    const result = await createSubscription(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("create_subscription", {
      p_customer_email: "luis@example.com",
      p_customer_name: "Luis",
      p_sku_id: 3,
      p_cadence: "monthly",
      p_qty_units: 1,
      p_stripe_subscription_id: "sub_abc",
      p_idempotency_key: "idem-sub-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.subscriptionId).toBe(9);
  });

  it("forwards a null p_stripe_subscription_id when blank", async () => {
    const { store, rpc } = fakeStore({ data: 10, error: null });
    await createSubscription(store, { ...validRaw(), stripeSubscriptionId: "" });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_stripe_subscription_id).toBeNull();
  });

  it("maps an unknown SKU to a clean sentence", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "unknown sku 7", code: "23503" },
    });
    const result = await createSubscription(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/coffee|couldn't be found/i);
  });

  it("coerces a string id and falls back on an unrecognised error", async () => {
    const coerced = await createSubscription(fakeStore({ data: "11", error: null }).store, validRaw());
    expect(coerced.ok).toBe(true);
    if (coerced.ok) expect(coerced.subscriptionId).toBe(11);

    const weird = await createSubscription(
      fakeStore({ data: null, error: { message: "boom" } }).store,
      validRaw(),
    );
    expect(weird.ok).toBe(false);
    if (!weird.ok) expect(weird.message).not.toMatch(/boom/);
  });
});
