import { describe, expect, it, vi } from "vitest";

import {
  friendlyRecordPosSaleError,
  recordPosSale,
  validateRecordPosSale,
  type RecordPosSaleStore,
} from "@/lib/db/commands/recordPosSale";

/**
 * Pure-domain command test for the POS-sale write door (P3-S14; ADR-002 — every write
 * flows through a SECURITY DEFINER RPC). A POS sale IS an order with channel='pos': the
 * RPC DELEGATES to the shipped `create_order` for server-computed subtotal / ITBMS 7% /
 * total + the S11 fail-closed finished_goods decrement (the money guarantee REUSED,
 * never rebuilt), then mints a POS-NNNN folio. This file does NOT touch a database: it
 * drives the command against a *fake store* stubbing the one `.rpc('record_pos_sale', …)`
 * method, proving (a) the friendly-validation seam (incl. the cart lines + the optional
 * walk-in customer forwarding as null so the RPC defaults to walkin@pos.local / Walk-in),
 * (b) the exact snake_case argument envelope with `p_lines` as a `{sku_id, qty_units}[]`
 * jsonb array, and (c) that the data-layer guards (unknown/inactive terminal, the
 * finished-goods oversell guard, an offline double-sync collision) surface as CLEAN,
 * family-readable sentences — raw Postgres text never leaks. Returns the POS-NNNN folio
 * (a replay of the same key returns the SAME folio, exactly-once). Mirrors
 * recordIceCQuote.test.ts / recordCherryIntake.ts.
 */

interface RpcResult {
  data: string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: RecordPosSaleStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as RecordPosSaleStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  terminalCode: "CAFE",
  customerEmail: "",
  customerName: "",
  deviceId: "till-cafe-01",
  deviceSeq: "7",
  lines: [
    { skuId: 11, qtyUnits: 2 },
    { skuId: 12, qtyUnits: 1 },
  ],
  currency: "USD",
  idempotencyKey: "idem-pos-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateRecordPosSale", () => {
  it("accepts a complete, well-formed sale (blank walk-in customer → null)", () => {
    const r = validateRecordPosSale(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.terminalCode).toBe("CAFE");
      expect(r.data.customerEmail).toBeNull();
      expect(r.data.customerName).toBeNull();
      expect(r.data.deviceId).toBe("till-cafe-01");
      expect(r.data.deviceSeq).toBe(7);
      expect(r.data.lines).toEqual([
        { skuId: 11, qtyUnits: 2 },
        { skuId: 12, qtyUnits: 1 },
      ]);
      expect(r.data.currency).toBe("USD");
      expect(r.data.idempotencyKey).toBe("idem-pos-1");
    }
  });

  it("keeps a named customer's email/name when provided", () => {
    const r = validateRecordPosSale({
      ...validRaw(),
      customerEmail: "ana@example.com",
      customerName: "Ana",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.customerEmail).toBe("ana@example.com");
      expect(r.data.customerName).toBe("Ana");
    }
  });

  it("defaults a blank currency to USD", () => {
    const r = validateRecordPosSale({ ...validRaw(), currency: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.currency).toBe("USD");
  });

  it("rejects a missing terminal code", () => {
    const r = validateRecordPosSale({ ...validRaw(), terminalCode: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.terminalCode).toBeDefined();
  });

  it("rejects a missing device id", () => {
    const r = validateRecordPosSale({ ...validRaw(), deviceId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.deviceId).toBeDefined();
  });

  it("rejects a non-integer / negative device sequence", () => {
    const bad = validateRecordPosSale({ ...validRaw(), deviceSeq: "1.5" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.deviceSeq).toBeDefined();

    const neg = validateRecordPosSale({ ...validRaw(), deviceSeq: "-1" });
    expect(neg.ok).toBe(false);
  });

  it("rejects an empty cart (the create_order at-least-one-line CHECK)", () => {
    const r = validateRecordPosSale({ ...validRaw(), lines: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.lines).toBeDefined();
  });

  it("rejects a non-array lines payload", () => {
    const r = validateRecordPosSale({ ...validRaw(), lines: "nope" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.lines).toBeDefined();
  });

  it("rejects a line with a non-positive quantity (the qty_units > 0 CHECK)", () => {
    const r = validateRecordPosSale({
      ...validRaw(),
      lines: [{ skuId: 11, qtyUnits: 0 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.lines).toBeDefined();
  });

  it("rejects a line with a missing/invalid sku id", () => {
    const r = validateRecordPosSale({
      ...validRaw(),
      lines: [{ skuId: "abc", qtyUnits: 1 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.lines).toBeDefined();
  });

  it("rejects a missing idempotency key", () => {
    const r = validateRecordPosSale({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── friendly-error seam ───────────────────────────

describe("friendlyRecordPosSaleError", () => {
  it("maps the finished-goods oversell guard to a stock message", () => {
    const msg = friendlyRecordPosSaleError({
      message:
        "finished-goods oversell guard: applying -2 units to sku 11 would drive available below zero (on_hand 1, allocated 0)",
    });
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/stock/i);
  });

  it("maps an unknown/inactive terminal to a terminal message", () => {
    const msg = friendlyRecordPosSaleError({
      message: "unknown or inactive POS terminal CAFE",
      code: "23503",
    });
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/terminal/i);
  });

  it("maps an unknown sku to an item message", () => {
    const msg = friendlyRecordPosSaleError({
      message: "unknown sku 999",
      code: "23503",
    });
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/item|product/i);
  });

  it("maps an offline (device_id, device_seq) collision to a retry-safe message", () => {
    const msg = friendlyRecordPosSaleError({
      message:
        'duplicate key value violates unique constraint "pos_sales_device_seq_ux"',
      code: "23505",
    });
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/already|recorded/i);
  });

  it("returns null for an unrecognised error (generic fallback territory)", () => {
    expect(
      friendlyRecordPosSaleError({ message: "some unexpected failure" }),
    ).toBeNull();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("recordPosSale", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await recordPosSale(store, { ...validRaw(), lines: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.lines).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls record_pos_sale with the exact snake_case envelope and returns the folio", async () => {
    const { store, rpc } = fakeStore({ data: "POS-0003", error: null });
    const result = await recordPosSale(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_pos_sale", {
      p_terminal_code: "CAFE",
      p_customer_email: null,
      p_customer_name: null,
      p_device_id: "till-cafe-01",
      p_device_seq: 7,
      p_lines: [
        { sku_id: 11, qty_units: 2 },
        { sku_id: 12, qty_units: 1 },
      ],
      p_currency: "USD",
      p_idempotency_key: "idem-pos-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.saleNo).toBe("POS-0003");
  });

  it("forwards a named customer's email/name (not the walk-in default)", async () => {
    const { store, rpc } = fakeStore({ data: "POS-0004", error: null });
    await recordPosSale(store, {
      ...validRaw(),
      customerEmail: "ana@example.com",
      customerName: "Ana",
    });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_customer_email).toBe("ana@example.com");
    expect(args.p_customer_name).toBe("Ana");
  });

  it("maps the oversell guard rejection to a clean, family-readable stock sentence", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        message:
          "finished-goods oversell guard: applying -2 units to sku 11 would drive available below zero (on_hand 1, allocated 0)",
      },
    });
    const result = await recordPosSale(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/stock/i);
      expect(result.message).not.toMatch(/oversell guard|on_hand/i);
    }
  });

  it("maps an unknown/inactive terminal to a clean terminal sentence", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "unknown or inactive POS terminal CAFE", code: "23503" },
    });
    const result = await recordPosSale(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/terminal/i);
  });

  it("falls back to a generic labelled message for an unrecognised failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "some unexpected failure" },
    });
    const result = await recordPosSale(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });

  it("returns a labelled error when the RPC returns no folio", async () => {
    const { store } = fakeStore({ data: null, error: null });
    const result = await recordPosSale(store, validRaw());
    expect(result.ok).toBe(false);
  });
});
