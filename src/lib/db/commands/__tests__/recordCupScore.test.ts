import { describe, expect, it, vi } from "vitest";

import {
  recordCupScore,
  validateCupScore,
  type CupScoreStore,
} from "@/lib/db/commands/recordCupScore";

/**
 * Pure-domain command test for the cup-score write (P2-S6 — append a per-attribute
 * cupping score via the `record_cup_score` SECURITY DEFINER RPC). No DB: the
 * command runs against a FAKE store stubbing the one `.rpc()` it uses, proving (a)
 * the friendly-validation seam, (b) the exact snake_case argument envelope the RPC
 * receives, and (c) clean error surfacing. The SQL CHECK/append-only block is the
 * real enforcement (proven in s6_qc_cupping.db.test.ts). Mirrors recordCherryIntake.
 */

interface RpcResult {
  data: number | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: CupScoreStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as CupScoreStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  sessionId: "7",
  attribute: "flavor",
  score: "8.5",
  deviceId: "srv",
  deviceSeq: "11",
  idempotencyKey: "sc-2",
});

describe("validateCupScore", () => {
  it("accepts a complete, valid raw score", () => {
    const r = validateCupScore(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.sessionId).toBe(7);
      expect(r.data.score).toBeCloseTo(8.5, 6);
      expect(r.data.attribute).toBe("flavor");
    }
  });

  it("rejects a missing attribute", () => {
    const r = validateCupScore({ ...validRaw(), attribute: "  " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.attribute).toBeTruthy();
  });

  it("rejects a non-numeric or out-of-range score (0–100)", () => {
    expect(validateCupScore({ ...validRaw(), score: "x" }).ok).toBe(false);
    expect(validateCupScore({ ...validRaw(), score: "-1" }).ok).toBe(false);
    expect(validateCupScore({ ...validRaw(), score: "101" }).ok).toBe(false);
  });

  it("rejects a missing session id", () => {
    const r = validateCupScore({ ...validRaw(), sessionId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.sessionId).toBeTruthy();
  });
});

describe("recordCupScore", () => {
  it("calls record_cup_score with the snake_case envelope on valid input", async () => {
    const { store, rpc } = fakeStore({ data: 42, error: null });
    const out = await recordCupScore(store, validRaw());
    expect(out.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("record_cup_score", {
      p_session_id: 7,
      p_attribute: "flavor",
      p_score: 8.5,
      p_device_id: "srv",
      p_device_seq: 11,
      p_idempotency_key: "sc-2",
    });
  });

  it("never reaches the RPC on bad input (friendly errors)", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const out = await recordCupScore(store, { ...validRaw(), score: "999" });
    expect(out.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces a labelled message on an RPC error", async () => {
    const { store } = fakeStore({ data: null, error: { message: "boom", code: "XX000" } });
    const out = await recordCupScore(store, validRaw());
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toMatch(/record_cup_score/i);
  });
});
