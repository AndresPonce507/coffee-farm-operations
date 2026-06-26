import { describe, expect, it, vi } from "vitest";

import {
  DUNNING_STAGES,
  recordDunningEvent,
  validateRecordDunningEvent,
  type RecordDunningEventStore,
} from "@/lib/db/commands/recordDunningEvent";

/**
 * Pure-domain command test for the dunning ledger writer (P3-S12). Appends a 'dunning'
 * sub_event; a 'final' stage marks the subscription past_due. Idempotent on the key, via
 * the SECURITY DEFINER `record_dunning_event` RPC. The DB does NOT enum-lock the stage
 * (only 'final' is special-cased), so the validator just requires a non-empty stage —
 * DUNNING_STAGES is a UI convenience list, not a hard gate. Drives the command against a
 * fake store and proves the validation seam, the exact snake_case envelope, and clean
 * error mapping.
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: RecordDunningEventStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as RecordDunningEventStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  subscriptionId: 5,
  stage: "reminder",
  idempotencyKey: "idem-dun-1",
});

describe("validateRecordDunningEvent", () => {
  it("accepts a real subscription id + stage", () => {
    const r = validateRecordDunningEvent(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.subscriptionId).toBe(5);
      expect(r.data.stage).toBe("reminder");
    }
  });

  it("accepts the 'final' stage (the past_due trigger) and any other non-empty stage", () => {
    expect(validateRecordDunningEvent({ ...validRaw(), stage: "final" }).ok).toBe(true);
    expect(validateRecordDunningEvent({ ...validRaw(), stage: "custom-stage" }).ok).toBe(true);
    expect(DUNNING_STAGES).toContain("final");
  });

  it("rejects a missing stage", () => {
    const r = validateRecordDunningEvent({ ...validRaw(), stage: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.stage).toBeDefined();
  });

  it("rejects a missing subscription id / idempotency key", () => {
    expect(validateRecordDunningEvent({ ...validRaw(), subscriptionId: 0 }).ok).toBe(false);
    expect(validateRecordDunningEvent({ ...validRaw(), idempotencyKey: "" }).ok).toBe(false);
  });
});

describe("recordDunningEvent", () => {
  it("does not call the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await recordDunningEvent(store, { ...validRaw(), stage: "" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls record_dunning_event with the exact snake_case envelope", async () => {
    const { store, rpc } = fakeStore({ data: 60, error: null });
    const result = await recordDunningEvent(store, validRaw());
    expect(rpc).toHaveBeenCalledWith("record_dunning_event", {
      p_subscription_id: 5,
      p_stage: "reminder",
      p_idempotency_key: "idem-dun-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.eventId).toBe(60);
  });

  it("maps an unknown subscription to a clean sentence and coerces a string id", async () => {
    const unknown = await recordDunningEvent(
      fakeStore({ data: null, error: { message: "unknown subscription 9", code: "23503" } }).store,
      validRaw(),
    );
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.message).toMatch(/subscription|couldn't be found/i);

    const coerced = await recordDunningEvent(fakeStore({ data: "61", error: null }).store, validRaw());
    expect(coerced.ok).toBe(true);
    if (coerced.ok) expect(coerced.eventId).toBe(61);
  });
});
