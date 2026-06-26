import { beforeEach, describe, expect, it, vi } from "vitest";

// The action is the one driving port: it validates the shape the DB enforces, then
// appends through the single SECURITY DEFINER record_pos_sale RPC. Stub Supabase +
// the ripple SSOT so the test pins validation, the p_-prefixed RPC binding, and the
// friendly-error mapping (a raw SQLSTATE never leaks).
const { rpcMock, refreshMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  refreshMock: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => Promise.resolve({ rpc: rpcMock }),
}));
vi.mock("@/lib/revalidate", () => ({ reactiveRefresh: refreshMock }));

import { recordPosSaleAction } from "@/app/(app)/pos/actions";

const base = {
  terminalCode: "FARM-STORE",
  customerName: "Walk-in",
  customerEmail: null,
  deviceId: "dev-1",
  deviceSeq: 1,
  lines: [{ skuId: 10, qtyUnits: 2 }],
  currency: "USD",
  idempotencyKey: "key-1",
};

beforeEach(() => {
  rpcMock.mockReset();
  refreshMock.mockReset();
});

describe("recordPosSaleAction", () => {
  it("rejects an empty cart before any network hop", async () => {
    const r = await recordPosSaleAction({ ...base, lines: [] });
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a missing till before any network hop", async () => {
    const r = await recordPosSaleAction({ ...base, terminalCode: "  " });
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a non-positive quantity", async () => {
    const r = await recordPosSaleAction({ ...base, lines: [{ skuId: 10, qtyUnits: 0 }] });
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("binds the p_-prefixed RPC args and returns the folio, then ripples inventory", async () => {
    rpcMock.mockResolvedValue({ data: "POS-0042", error: null });
    const r = await recordPosSaleAction(base);
    expect(r).toEqual({ ok: true, saleNo: "POS-0042" });
    expect(rpcMock).toHaveBeenCalledWith("record_pos_sale", {
      p_terminal_code: "FARM-STORE",
      p_customer_email: null,
      p_customer_name: "Walk-in",
      p_device_id: "dev-1",
      p_device_seq: 1,
      p_lines: [{ sku_id: 10, qty_units: 2 }],
      p_currency: "USD",
      p_idempotency_key: "key-1",
    });
    expect(refreshMock).toHaveBeenCalledWith("inventory-update");
  });

  it("surfaces the DB guard message verbatim and never leaks a raw SQLSTATE", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "23514", message: "finished-goods oversell guard: ..." },
    });
    const r = await recordPosSaleAction(base);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("finished-goods oversell guard: ...");
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
