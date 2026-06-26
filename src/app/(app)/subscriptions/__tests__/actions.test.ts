import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Server Actions call `await (await getSupabase()).rpc(...)` then (for the money-
// shaped allocate) reactiveRefresh, which calls next/cache revalidatePath. Mock both:
// one rpc spy whose result each test sets, and a no-op revalidatePath. next-intl/server
// is mocked globally in setup.ts so validation messages come back as the real EN copy.
const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => Promise.resolve({ rpc: rpcMock }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  allocateSubscriptionCycleAction,
  pauseSubscriptionAction,
  recordDunningAction,
  skipSubscriptionCycleAction,
} from "@/app/(app)/subscriptions/actions";

beforeEach(() => rpcMock.mockReset());
afterEach(() => vi.clearAllMocks());

const allocInput = () => ({
  subscriptionId: 10,
  greenLotCode: "JC-901",
  kg: 3,
  cycleLabel: "2026-Q1",
  idempotencyKey: "idem-a1",
});

describe("allocateSubscriptionCycleAction — the money-shaped, oversell-guarded write", () => {
  it("rejects non-positive kg WITHOUT touching the database", async () => {
    const result = await allocateSubscriptionCycleAction({ ...allocInput(), kg: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Kilograms must be greater than zero.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a blank green lot WITHOUT touching the database", async () => {
    const result = await allocateSubscriptionCycleAction({ ...allocInput(), greenLotCode: "  " });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a blank cycle label WITHOUT touching the database", async () => {
    const result = await allocateSubscriptionCycleAction({ ...allocInput(), cycleLabel: "" });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("passes the EXACT snake_case p_ envelope to allocate_subscription_cycle on the happy path", async () => {
    rpcMock.mockResolvedValue({ data: 42, error: null });
    const result = await allocateSubscriptionCycleAction(allocInput());
    expect(result).toEqual({ ok: true, allocationId: 42 });
    expect(rpcMock).toHaveBeenCalledWith("allocate_subscription_cycle", {
      p_subscription_id: 10,
      p_green_lot_code: "JC-901",
      p_kg: 3,
      p_cycle_label: "2026-Q1",
      p_idempotency_key: "idem-a1",
    });
  });

  it("surfaces the author-written oversell guard message verbatim (never a raw SQLSTATE leak)", async () => {
    const guard =
      "oversell guard: committing 3 kg to green lot JC-901 would exceed its 2 kg available-to-promise";
    rpcMock.mockResolvedValue({ data: null, error: { message: guard, code: "23514" } });
    const result = await allocateSubscriptionCycleAction(allocInput());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(guard);
      expect(result.error).not.toMatch(/SQLSTATE|23514/);
    }
  });
});

describe("subscription lifecycle actions — exact RPC envelopes", () => {
  it("pause passes the exact envelope to pause_subscription", async () => {
    rpcMock.mockResolvedValue({ data: 10, error: null });
    const result = await pauseSubscriptionAction({ subscriptionId: 10, idempotencyKey: "idem-p" });
    expect(result).toEqual({ ok: true, subscriptionId: 10 });
    expect(rpcMock).toHaveBeenCalledWith("pause_subscription", {
      p_subscription_id: 10,
      p_idempotency_key: "idem-p",
    });
  });

  it("skip passes the cycle label through to skip_subscription_cycle", async () => {
    rpcMock.mockResolvedValue({ data: 10, error: null });
    const result = await skipSubscriptionCycleAction({
      subscriptionId: 10,
      cycleLabel: "2026-Q2",
      idempotencyKey: "idem-s",
    });
    expect(result).toEqual({ ok: true, subscriptionId: 10 });
    expect(rpcMock).toHaveBeenCalledWith("skip_subscription_cycle", {
      p_subscription_id: 10,
      p_cycle_label: "2026-Q2",
      p_idempotency_key: "idem-s",
    });
  });

  it("dunning passes the stage through to record_dunning_event", async () => {
    rpcMock.mockResolvedValue({ data: 99, error: null });
    const result = await recordDunningAction({
      subscriptionId: 11,
      stage: "final",
      idempotencyKey: "idem-d",
    });
    expect(result).toEqual({ ok: true, eventId: 99 });
    expect(rpcMock).toHaveBeenCalledWith("record_dunning_event", {
      p_subscription_id: 11,
      p_stage: "final",
      p_idempotency_key: "idem-d",
    });
  });
});
