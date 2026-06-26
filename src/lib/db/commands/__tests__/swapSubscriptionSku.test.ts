import { describe, expect, it, vi } from "vitest";

import {
  swapSubscriptionSku,
  validateSwapSubscriptionSku,
  type SwapSubscriptionSkuStore,
} from "@/lib/db/commands/swapSubscriptionSku";

/**
 * Pure-domain command test for swapping a Reserve-Club line's SKU (P3-S12). Repoints a
 * subscription_line to a new SKU and appends a 'swapped' sub_event, idempotent on the
 * key, via the SECURITY DEFINER `swap_subscription_sku` RPC. Drives the command against a
 * fake store and proves the validation seam (subscription id, line id, new SKU id), the
 * exact snake_case envelope, and clean error mapping for an unknown line / unknown SKU.
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: SwapSubscriptionSkuStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as SwapSubscriptionSkuStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  subscriptionId: 5,
  lineId: 12,
  newSkuId: 8,
  idempotencyKey: "idem-swap-1",
});

describe("validateSwapSubscriptionSku", () => {
  it("accepts real subscription / line / new-sku ids", () => {
    const r = validateSwapSubscriptionSku(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.subscriptionId).toBe(5);
      expect(r.data.lineId).toBe(12);
      expect(r.data.newSkuId).toBe(8);
    }
  });

  it("rejects a missing / non-positive line id or new sku id", () => {
    expect(validateSwapSubscriptionSku({ ...validRaw(), lineId: 0 }).ok).toBe(false);
    expect(validateSwapSubscriptionSku({ ...validRaw(), newSkuId: "" }).ok).toBe(false);
  });

  it("rejects a missing idempotency key", () => {
    const r = validateSwapSubscriptionSku({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

describe("swapSubscriptionSku", () => {
  it("does not call the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await swapSubscriptionSku(store, { ...validRaw(), newSkuId: 0 });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls swap_subscription_sku with the exact snake_case envelope", async () => {
    const { store, rpc } = fakeStore({ data: 5, error: null });
    const result = await swapSubscriptionSku(store, validRaw());
    expect(rpc).toHaveBeenCalledWith("swap_subscription_sku", {
      p_subscription_id: 5,
      p_line_id: 12,
      p_new_sku_id: 8,
      p_idempotency_key: "idem-swap-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.subscriptionId).toBe(5);
  });

  it("maps an unknown subscription line to a clean sentence", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "unknown subscription_line 12", code: "23503" },
    });
    const result = await swapSubscriptionSku(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/line|couldn't be found/i);
  });

  it("maps an unknown SKU to a clean sentence", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "unknown sku 8", code: "23503" },
    });
    const result = await swapSubscriptionSku(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/coffee|couldn't be found/i);
  });
});
