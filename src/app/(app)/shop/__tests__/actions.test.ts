import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Server Actions call `await (await getSupabase()).rpc(...)`. Mock a single rpc
// spy whose result each test sets. next-intl/server is mocked globally in setup.ts, so
// getTranslations("shop") resolves the real EN copy — validation messages come back as
// the actual English strings the UI shows.
const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => Promise.resolve({ rpc: rpcMock }),
}));

import {
  createProductAction,
  createSkuAction,
  recordFgMovementAction,
} from "@/app/(app)/shop/actions";

beforeEach(() => rpcMock.mockReset());
afterEach(() => vi.clearAllMocks());

const productInput = () => ({
  slug: "bop-geisha",
  name: "Best of Panama Geisha",
  variety: "Geisha",
  process: "Washed",
  tastingNotes: "Jasmine, bergamot, peach",
  idempotencyKey: "idem-p1",
});

const skuInput = () => ({
  productId: 10,
  greenLotCode: "JC-901",
  roastSkuId: null,
  packFormat: "whole-bean",
  bagSize: "250g",
  priceUsdCents: 4800,
  gtin: "0123456789012",
  stripePriceId: null,
  isReserveClub: true,
  idempotencyKey: "idem-s1",
});

describe("createProductAction — validation seam", () => {
  it("rejects an empty slug WITHOUT touching the database", async () => {
    const r = await createProductAction({ ...productInput(), slug: "  " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Enter a slug for the product.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects an empty name WITHOUT touching the database", async () => {
    const r = await createProductAction({ ...productInput(), name: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Enter a name for the product.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("passes the EXACT snake_case p_ envelope to create_product on the happy path", async () => {
    rpcMock.mockResolvedValue({ data: 10, error: null });
    const r = await createProductAction(productInput());
    expect(r).toEqual({ ok: true, productId: 10 });
    expect(rpcMock).toHaveBeenCalledWith("create_product", {
      p_slug: "bop-geisha",
      p_name: "Best of Panama Geisha",
      p_variety: "Geisha",
      p_process: "Washed",
      p_tasting_notes: "Jasmine, bergamot, peach",
      p_idempotency_key: "idem-p1",
    });
  });
});

describe("createSkuAction — the lot-backing write", () => {
  it("rejects an unknown pack format WITHOUT touching the database", async () => {
    const r = await createSkuAction({ ...skuInput(), packFormat: "barrel" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Pick a pack format.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a negative price WITHOUT touching the database", async () => {
    const r = await createSkuAction({ ...skuInput(), priceUsdCents: -1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Enter a price of zero or more.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("passes the EXACT envelope to create_sku on the happy path", async () => {
    rpcMock.mockResolvedValue({ data: 77, error: null });
    const r = await createSkuAction(skuInput());
    expect(r).toEqual({ ok: true, skuId: 77 });
    expect(rpcMock).toHaveBeenCalledWith("create_sku", {
      p_product_id: 10,
      p_green_lot_code: "JC-901",
      p_roast_sku_id: null,
      p_pack_format: "whole-bean",
      p_bag_size: "250g",
      p_price_usd_cents: 4800,
      p_gtin: "0123456789012",
      p_stripe_price_id: null,
      p_is_reserve_club: true,
      p_idempotency_key: "idem-s1",
    });
  });

  it("surfaces the author-written lot-backing guard message verbatim (never a raw SQLSTATE leak)", async () => {
    const guard =
      "SKU lot-backing guard: green lot JC-999 does not exist — a SKU cannot claim a lot it is not backed by";
    rpcMock.mockResolvedValue({ data: null, error: { message: guard, code: "23503" } });
    const r = await createSkuAction({ ...skuInput(), greenLotCode: "JC-999" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe(guard);
      expect(r.error).not.toMatch(/SQLSTATE|23503/);
    }
  });
});

describe("recordFgMovementAction — the fail-closed inventory mover", () => {
  it("rejects a zero-unit movement WITHOUT touching the database", async () => {
    const r = await recordFgMovementAction({
      skuId: 1,
      qtyUnits: 0,
      reason: "sale",
      idempotencyKey: "idem-m1",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Enter a non-zero number of units.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown reason WITHOUT touching the database", async () => {
    const r = await recordFgMovementAction({
      skuId: 1,
      qtyUnits: 5,
      reason: "shrinkage",
      idempotencyKey: "idem-m1",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Pick a movement reason.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("passes the EXACT envelope to record_fg_movement on the happy path", async () => {
    rpcMock.mockResolvedValue({ data: 501, error: null });
    const r = await recordFgMovementAction({
      skuId: 2,
      qtyUnits: -3,
      reason: "sale",
      idempotencyKey: "idem-m2",
    });
    expect(r).toEqual({ ok: true, ledgerId: 501 });
    expect(rpcMock).toHaveBeenCalledWith("record_fg_movement", {
      p_sku_id: 2,
      p_qty_units: -3,
      p_reason: "sale",
      p_idempotency_key: "idem-m2",
    });
  });

  it("surfaces the finished-goods oversell guard message verbatim", async () => {
    const guard =
      "finished-goods oversell guard: applying -200 units to sku 2 would drive available below zero (on_hand 120, allocated 0)";
    rpcMock.mockResolvedValue({ data: null, error: { message: guard, code: "23514" } });
    const r = await recordFgMovementAction({
      skuId: 2,
      qtyUnits: -200,
      reason: "sale",
      idempotencyKey: "idem-m3",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(guard);
  });
});
