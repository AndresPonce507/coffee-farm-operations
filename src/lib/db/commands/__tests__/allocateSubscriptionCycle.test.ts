import { describe, expect, it, vi } from "vitest";

import {
  allocateSubscriptionCycle,
  friendlyAllocateSubscriptionError,
  validateAllocateSubscriptionCycle,
  type AllocateSubscriptionCycleStore,
} from "@/lib/db/commands/allocateSubscriptionCycle";

/**
 * Pure-domain command test for THE money-guarantee touch point of P3-S12:
 * `allocate_subscription_cycle`. The RPC inserts a `lot_reservations` row so the EXISTING
 * `prevent_oversell` trigger fires — a $30k/kg Geisha micro-lot can NEVER be promised to
 * more subscribers than kg exist. An over-allocation rolls the whole txn back. This file
 * drives the command against a fake `.rpc('allocate_subscription_cycle', …)` store and
 * proves (a) the validation seam (kg > 0, a green lot, a cycle), (b) the exact snake_case
 * envelope, and (c) that the fail-closed oversell rejection surfaces a CLEAN, family-
 * readable sentence — never raw Postgres. The trigger is the real enforcement (the
 * migration's PGlite oversell test pins it); this command is the friendly seam over it.
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: AllocateSubscriptionCycleStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as AllocateSubscriptionCycleStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  subscriptionId: 5,
  greenLotCode: "JC-701",
  kg: "1.5",
  cycleLabel: "2026-07",
  idempotencyKey: "idem-alloc-1",
});

describe("validateAllocateSubscriptionCycle", () => {
  it("accepts a complete, well-formed allocation", () => {
    const r = validateAllocateSubscriptionCycle(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.subscriptionId).toBe(5);
      expect(r.data.greenLotCode).toBe("JC-701");
      expect(r.data.kg).toBe(1.5);
      expect(r.data.cycleLabel).toBe("2026-07");
    }
  });

  it("rejects a non-positive kg (the kg > 0 CHECK)", () => {
    const zero = validateAllocateSubscriptionCycle({ ...validRaw(), kg: "0" });
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.errors.kg).toMatch(/greater than 0/i);
    expect(validateAllocateSubscriptionCycle({ ...validRaw(), kg: "-1" }).ok).toBe(false);
  });

  it("rejects a missing green lot / cycle label / subscription id", () => {
    expect(validateAllocateSubscriptionCycle({ ...validRaw(), greenLotCode: "" }).ok).toBe(false);
    expect(validateAllocateSubscriptionCycle({ ...validRaw(), cycleLabel: "" }).ok).toBe(false);
    expect(validateAllocateSubscriptionCycle({ ...validRaw(), subscriptionId: 0 }).ok).toBe(false);
  });

  it("rejects a missing idempotency key", () => {
    const r = validateAllocateSubscriptionCycle({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

describe("friendlyAllocateSubscriptionError", () => {
  it("maps the reused prevent_oversell rejection to a reserve-club sentence", () => {
    const msg = friendlyAllocateSubscriptionError({
      message: "oversell guard: would exceed available-to-promise for green_lot JC-701",
    });
    expect(msg).toMatch(/available-to-promise|enough/i);
    expect(msg).not.toMatch(/oversell guard/);
  });

  it("returns null for an unrecognised error (caller uses a generic fallback)", () => {
    expect(friendlyAllocateSubscriptionError({ message: "some weird failure" })).toBeNull();
  });
});

describe("allocateSubscriptionCycle", () => {
  it("does not call the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await allocateSubscriptionCycle(store, { ...validRaw(), kg: "0" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls allocate_subscription_cycle with the exact snake_case envelope", async () => {
    const { store, rpc } = fakeStore({ data: 30, error: null });
    const result = await allocateSubscriptionCycle(store, validRaw());
    expect(rpc).toHaveBeenCalledWith("allocate_subscription_cycle", {
      p_subscription_id: 5,
      p_green_lot_code: "JC-701",
      p_kg: 1.5,
      p_cycle_label: "2026-07",
      p_idempotency_key: "idem-alloc-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.allocationId).toBe(30);
  });

  it("surfaces the oversell rejection as a CLEAN sentence (never raw PG)", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "oversell: would exceed available-to-promise" },
    });
    const result = await allocateSubscriptionCycle(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/available-to-promise|enough/i);
      expect(result.message).not.toMatch(/oversell/);
    }
  });

  it("maps an unknown subscription and coerces a string id", async () => {
    const unknown = await allocateSubscriptionCycle(
      fakeStore({ data: null, error: { message: "unknown subscription 9", code: "23503" } }).store,
      validRaw(),
    );
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.message).toMatch(/subscription|couldn't be found/i);

    const coerced = await allocateSubscriptionCycle(fakeStore({ data: "31", error: null }).store, validRaw());
    expect(coerced.ok).toBe(true);
    if (coerced.ok) expect(coerced.allocationId).toBe(31);
  });
});
