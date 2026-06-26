import { describe, expect, it, vi } from "vitest";

import {
  cancelSubscription,
  pauseSubscription,
  resumeSubscription,
  validateSubscriptionAction,
  type SubscriptionLifecycleStore,
} from "@/lib/db/commands/subscriptionLifecycle";

/**
 * Pure-domain command test for the three simple Reserve-Club status transitions
 * (P3-S12): `pause_subscription` / `resume_subscription` / `cancel_subscription`. Each
 * is a thin SECURITY DEFINER RPC taking only (subscription_id, idempotency_key) and
 * appending the matching sub_event (paused/resumed/cancelled), idempotent on the key.
 * They share one validator (`validateSubscriptionAction`); each command binds to its OWN
 * literal rpc name so a typo can't silently call the wrong transition. Drives each against
 * a fake store and proves the envelope + idempotent-id passthrough + clean error mapping.
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: SubscriptionLifecycleStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as SubscriptionLifecycleStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  subscriptionId: 5,
  idempotencyKey: "idem-life-1",
});

// ─────────────────────────── shared validation ─────────────────────────────

describe("validateSubscriptionAction", () => {
  it("accepts a real subscription id + key", () => {
    const r = validateSubscriptionAction(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.subscriptionId).toBe(5);
      expect(r.data.idempotencyKey).toBe("idem-life-1");
    }
  });

  it("rejects a missing / non-positive / non-integer subscription id", () => {
    expect(validateSubscriptionAction({ ...validRaw(), subscriptionId: "" }).ok).toBe(false);
    expect(validateSubscriptionAction({ ...validRaw(), subscriptionId: 0 }).ok).toBe(false);
    expect(validateSubscriptionAction({ ...validRaw(), subscriptionId: 1.5 }).ok).toBe(false);
  });

  it("rejects a missing idempotency key", () => {
    const r = validateSubscriptionAction({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── each transition ───────────────────────────────

describe("pauseSubscription", () => {
  it("calls pause_subscription with the exact envelope and returns the sub id", async () => {
    const { store, rpc } = fakeStore({ data: 5, error: null });
    const result = await pauseSubscription(store, validRaw());
    expect(rpc).toHaveBeenCalledWith("pause_subscription", {
      p_subscription_id: 5,
      p_idempotency_key: "idem-life-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.subscriptionId).toBe(5);
  });

  it("does not call the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await pauseSubscription(store, { ...validRaw(), subscriptionId: 0 });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("resumeSubscription", () => {
  it("calls resume_subscription with the exact envelope", async () => {
    const { store, rpc } = fakeStore({ data: "5", error: null });
    const result = await resumeSubscription(store, validRaw());
    expect(rpc).toHaveBeenCalledWith("resume_subscription", {
      p_subscription_id: 5,
      p_idempotency_key: "idem-life-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.subscriptionId).toBe(5); // string id coerced
  });
});

describe("cancelSubscription", () => {
  it("calls cancel_subscription with the exact envelope", async () => {
    const { store, rpc } = fakeStore({ data: 5, error: null });
    await cancelSubscription(store, validRaw());
    expect(rpc).toHaveBeenCalledWith("cancel_subscription", {
      p_subscription_id: 5,
      p_idempotency_key: "idem-life-1",
    });
  });

  it("maps an unknown subscription to a clean sentence", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "unknown subscription 99", code: "23503" },
    });
    const result = await cancelSubscription(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/subscription|couldn't be found/i);
      expect(result.message).not.toMatch(/unknown subscription 99/);
    }
  });
});
