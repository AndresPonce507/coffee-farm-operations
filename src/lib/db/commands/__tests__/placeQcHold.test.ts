import { describe, expect, it, vi } from "vitest";

import {
  placeQcHold,
  releaseQcHold,
  validatePlaceQcHold,
  type QcHoldStore,
} from "@/lib/db/commands/placeQcHold";

/**
 * Pure-domain command test for the QC-HOLD writes (P2-S6 — the cup-protection
 * teeth). `place_qc_hold` quarantines a green lot (a held lot cannot be reserved or
 * shipped, enforced by the _prevent_held_lot_commit DB trigger); `release_qc_hold`
 * re-opens commerce. No DB: a FAKE store stubs the `.rpc()` the commands use. The
 * trigger fail-closed behavior is proven in s6_qc_cupping.db.test.ts.
 */

interface RpcResult {
  data: number | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: QcHoldStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as QcHoldStore, rpc };
}

const validHold = (): Record<string, unknown> => ({
  greenLotCode: "JC-9001",
  reason: "off-flavor — re-cup",
  deviceId: "srv",
  deviceSeq: "2",
  idempotencyKey: "hold-1",
});

describe("validatePlaceQcHold", () => {
  it("accepts a complete hold request", () => {
    const r = validatePlaceQcHold(validHold());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.greenLotCode).toBe("JC-9001");
      expect(r.data.reason).toBe("off-flavor — re-cup");
    }
  });

  it("rejects a hold with no reason (a hold must say why)", () => {
    const r = validatePlaceQcHold({ ...validHold(), reason: "   " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.reason).toBeTruthy();
  });

  it("rejects a hold with no green lot", () => {
    const r = validatePlaceQcHold({ ...validHold(), greenLotCode: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.greenLotCode).toBeTruthy();
  });
});

describe("placeQcHold", () => {
  it("calls place_qc_hold with the snake_case envelope (occurredAt stamped)", async () => {
    const { store, rpc } = fakeStore({ data: 5, error: null });
    const out = await placeQcHold(store, { ...validHold(), occurredAt: "2026-06-21T10:00:00.000Z" });
    expect(out.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("place_qc_hold", {
      p_green_lot_code: "JC-9001",
      p_reason: "off-flavor — re-cup",
      p_occurred_at: "2026-06-21T10:00:00.000Z",
      p_device_id: "srv",
      p_device_seq: 2,
      p_idempotency_key: "hold-1",
    });
  });

  it("never reaches the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const out = await placeQcHold(store, { ...validHold(), reason: "" });
    expect(out.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces a labelled message on an RPC error", async () => {
    const { store } = fakeStore({ data: null, error: { message: "nope" } });
    const out = await placeQcHold(store, { ...validHold(), occurredAt: "2026-06-21T10:00:00.000Z" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toMatch(/place_qc_hold/i);
  });
});

describe("releaseQcHold", () => {
  it("calls release_qc_hold with the lot + envelope", async () => {
    const { store, rpc } = fakeStore({ data: 1, error: null });
    const out = await releaseQcHold(store, {
      greenLotCode: "JC-9001",
      occurredAt: "2026-06-21T11:00:00.000Z",
      deviceId: "srv",
      deviceSeq: "3",
      idempotencyKey: "rel-1",
    });
    expect(out.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("release_qc_hold", {
      p_green_lot_code: "JC-9001",
      p_occurred_at: "2026-06-21T11:00:00.000Z",
      p_device_id: "srv",
      p_device_seq: 3,
      p_idempotency_key: "rel-1",
    });
  });

  it("rejects a release with no green lot", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const out = await releaseQcHold(store, { greenLotCode: "" });
    expect(out.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
