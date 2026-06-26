import { describe, expect, it, vi } from "vitest";

import {
  skipSubscriptionCycle,
  validateSkipSubscriptionCycle,
  type SkipSubscriptionCycleStore,
} from "@/lib/db/commands/skipSubscriptionCycle";

/**
 * Pure-domain command test for skipping a Reserve-Club cycle (P3-S12). Appends a
 * 'skipped' sub_event for the named cycle with NO status change, idempotent on the key,
 * via the SECURITY DEFINER `skip_subscription_cycle` RPC. Drives the command against a
 * fake store and proves the validation seam (a real subscription id + a cycle label),
 * the exact snake_case envelope, and clean error mapping.
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: SkipSubscriptionCycleStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as SkipSubscriptionCycleStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  subscriptionId: 5,
  cycleLabel: "2026-07",
  idempotencyKey: "idem-skip-1",
});

describe("validateSkipSubscriptionCycle", () => {
  it("accepts a real subscription id + cycle label", () => {
    const r = validateSkipSubscriptionCycle(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.subscriptionId).toBe(5);
      expect(r.data.cycleLabel).toBe("2026-07");
    }
  });

  it("rejects a missing cycle label", () => {
    const r = validateSkipSubscriptionCycle({ ...validRaw(), cycleLabel: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.cycleLabel).toBeDefined();
  });

  it("rejects a missing subscription id / idempotency key", () => {
    expect(validateSkipSubscriptionCycle({ ...validRaw(), subscriptionId: 0 }).ok).toBe(false);
    expect(validateSkipSubscriptionCycle({ ...validRaw(), idempotencyKey: "" }).ok).toBe(false);
  });
});

describe("skipSubscriptionCycle", () => {
  it("does not call the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await skipSubscriptionCycle(store, { ...validRaw(), cycleLabel: "" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls skip_subscription_cycle with the exact snake_case envelope", async () => {
    const { store, rpc } = fakeStore({ data: 5, error: null });
    const result = await skipSubscriptionCycle(store, validRaw());
    expect(rpc).toHaveBeenCalledWith("skip_subscription_cycle", {
      p_subscription_id: 5,
      p_cycle_label: "2026-07",
      p_idempotency_key: "idem-skip-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.subscriptionId).toBe(5);
  });

  it("maps an unknown subscription to a clean sentence", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "unknown subscription 99", code: "23503" },
    });
    const result = await skipSubscriptionCycle(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/subscription|couldn't be found/i);
  });
});
