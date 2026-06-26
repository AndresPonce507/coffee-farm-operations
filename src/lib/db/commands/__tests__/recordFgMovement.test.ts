import { describe, expect, it, vi } from "vitest";

import {
  recordFgMovement,
  validateRecordFgMovement,
  type RecordFgMovementStore,
} from "@/lib/db/commands/recordFgMovement";

/**
 * Pure-domain command test for the append-only finished-goods movement writer
 * (P3-S11; ADR-002 — every write flows through a SECURITY DEFINER RPC). No database:
 * the command runs against a *fake store* stubbing `.rpc('record_fg_movement', …)`,
 * proving (a) the friendly-validation seam (the reason enum, the `qty_units <> 0`
 * CHECK, signed quantities for reversing movements), (b) the exact snake_case
 * argument envelope, and (c) that the DATA-LAYER oversell guard (invariant 2 —
 * available can never go negative, fail-closed like prevent_oversell) surfaces as a
 * CLEAN, family-readable sentence, never raw Postgres text.
 *
 * The trigger's advisory-lock + available>=0 raise are the REAL enforcement (pinned
 * by the migration's PGlite test); this command's job is the friendly seam.
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: RecordFgMovementStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as RecordFgMovementStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  skuId: "10",
  qtyUnits: "24",
  reason: "roast-in",
  idempotencyKey: "idem-fg-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateRecordFgMovement", () => {
  it("accepts a complete, well-formed roast-in movement", () => {
    const r = validateRecordFgMovement(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.skuId).toBe(10);
      expect(r.data.qtyUnits).toBe(24);
      expect(r.data.reason).toBe("roast-in");
      expect(r.data.idempotencyKey).toBe("idem-fg-1");
    }
  });

  it("accepts a negative (reversing) qty for a sale/return", () => {
    const r = validateRecordFgMovement({ ...validRaw(), qtyUnits: "-2", reason: "sale" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.qtyUnits).toBe(-2);
      expect(r.data.reason).toBe("sale");
    }
  });

  it("accepts every fg reason enum value", () => {
    for (const reason of [
      "roast-in",
      "sale",
      "subscription-fulfill",
      "adjust",
      "return",
    ]) {
      const r = validateRecordFgMovement({ ...validRaw(), reason });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.reason).toBe(reason);
    }
  });

  it("rejects an unknown reason", () => {
    const r = validateRecordFgMovement({ ...validRaw(), reason: "spillage" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.reason).toBeDefined();
  });

  it("rejects a zero quantity (the qty_units <> 0 CHECK)", () => {
    const r = validateRecordFgMovement({ ...validRaw(), qtyUnits: "0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.qtyUnits).toBeDefined();
  });

  it("rejects a non-integer quantity", () => {
    const r = validateRecordFgMovement({ ...validRaw(), qtyUnits: "2.5" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.qtyUnits).toBeDefined();
  });

  it("rejects a missing or non-positive sku id", () => {
    const missing = validateRecordFgMovement({ ...validRaw(), skuId: "" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors.skuId).toBeDefined();

    const zero = validateRecordFgMovement({ ...validRaw(), skuId: "0" });
    expect(zero.ok).toBe(false);
  });

  it("rejects a missing idempotency key", () => {
    const r = validateRecordFgMovement({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("recordFgMovement", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await recordFgMovement(store, { ...validRaw(), qtyUnits: "0" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.qtyUnits).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls record_fg_movement with the exact snake_case envelope and returns the ledger id", async () => {
    const { store, rpc } = fakeStore({ data: 31, error: null });
    const result = await recordFgMovement(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_fg_movement", {
      p_sku_id: 10,
      p_qty_units: 24,
      p_reason: "roast-in",
      p_idempotency_key: "idem-fg-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ledgerId).toBe(31);
  });

  it("coerces a string id from PostgREST to a number", async () => {
    const { store } = fakeStore({ data: "32", error: null });
    const result = await recordFgMovement(store, validRaw());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ledgerId).toBe(32);
  });

  it("maps the finished-goods oversell guard (invariant 2) to a CLEAN sentence", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        message:
          "finished-goods oversell guard: applying -30 units to sku 10 would drive available below zero (on_hand 24, allocated 2)",
        code: "23514",
      },
    });
    const result = await recordFgMovement(store, {
      ...validRaw(),
      qtyUnits: "-30",
      reason: "sale",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/oversell|not enough|on hand/i);
      expect(result.message).not.toMatch(/guard|23514|allocated 2/);
    }
  });

  it("maps an unknown sku to a clean message", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "unknown sku 999", code: "23503" },
    });
    const result = await recordFgMovement(store, { ...validRaw(), skuId: "999" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/sku|product/i);
  });

  it("surfaces a generic clean message for an unrecognised RPC failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "internal boom" },
    });
    const result = await recordFgMovement(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBeTruthy();
      expect(result.message).not.toContain("boom");
    }
  });
});
