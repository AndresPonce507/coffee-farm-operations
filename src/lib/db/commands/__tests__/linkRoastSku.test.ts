import { describe, expect, it, vi } from "vitest";

import {
  linkRoastSku,
  validateLinkRoastSku,
  friendlyLinkRoastSkuError,
  type LinkRoastSkuStore,
} from "@/lib/db/commands/linkRoastSku";

/**
 * Pure-domain command test for closing roast→product (P3-S10 — roasting; ADR-002).
 * `link_roast_sku` requires a FINALIZED batch and points a SKU at the batch's roasted
 * lot — the per-bag QR's load-bearing link the Storefront/Provenance areas read; THIS
 * slice owns it. This file (no database) proves the validation seam (a real batch id,
 * a sku code, bag size > 0, optional price/GTIN), the exact snake_case envelope, and
 * that the not-finalized / duplicate-sku / unknown-batch rejections surface as CLEAN
 * sentences. Mirrors recordGreenGrade.test.ts.
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: LinkRoastSkuStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as LinkRoastSkuStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  batchId: "5",
  skuCode: "JANSON-GEISHA-250",
  bagSizeG: "250",
  priceUsdCents: "2400",
  gtin: "07401234567890",
  idempotencyKey: "idem-sku-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateLinkRoastSku", () => {
  it("accepts a complete, well-formed SKU link", () => {
    const r = validateLinkRoastSku(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.batchId).toBe(5);
      expect(r.data.skuCode).toBe("JANSON-GEISHA-250");
      expect(r.data.bagSizeG).toBe(250);
      expect(r.data.priceUsdCents).toBe(2400);
      expect(r.data.gtin).toBe("07401234567890");
      expect(r.data.idempotencyKey).toBe("idem-sku-1");
    }
  });

  it("treats a blank price as null", () => {
    const r = validateLinkRoastSku({ ...validRaw(), priceUsdCents: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.priceUsdCents).toBeNull();
  });

  it("treats a blank GTIN as null", () => {
    const r = validateLinkRoastSku({ ...validRaw(), gtin: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.gtin).toBeNull();
  });

  it("rejects a non-positive / non-integer batch id", () => {
    expect(validateLinkRoastSku({ ...validRaw(), batchId: "0" }).ok).toBe(false);
    expect(validateLinkRoastSku({ ...validRaw(), batchId: "5.5" }).ok).toBe(false);
  });

  it("rejects a missing sku code", () => {
    const r = validateLinkRoastSku({ ...validRaw(), skuCode: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.skuCode).toBeDefined();
  });

  it("rejects a non-positive / non-integer bag size (the bag_size_g > 0 CHECK)", () => {
    const zero = validateLinkRoastSku({ ...validRaw(), bagSizeG: "0" });
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.errors.bagSizeG).toMatch(/greater than 0/i);
    expect(validateLinkRoastSku({ ...validRaw(), bagSizeG: "250.5" }).ok).toBe(false);
  });

  it("rejects a negative price when one is supplied", () => {
    const r = validateLinkRoastSku({ ...validRaw(), priceUsdCents: "-1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.priceUsdCents).toBeDefined();
  });

  it("rejects a non-integer price (cents are whole numbers)", () => {
    const r = validateLinkRoastSku({ ...validRaw(), priceUsdCents: "24.5" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.priceUsdCents).toBeDefined();
  });

  it("rejects a missing idempotency key", () => {
    const r = validateLinkRoastSku({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── friendly-error seam ───────────────────────────

describe("friendlyLinkRoastSkuError", () => {
  it("maps the not-finalized rejection to a friendly message", () => {
    const msg = friendlyLinkRoastSkuError({
      code: "23514",
      message: "roast batch 5 is not finalized — finalize it before linking a SKU",
    });
    expect(msg).toMatch(/finaliz/i);
    expect(msg).not.toMatch(/23514|link_roast_sku/);
  });

  it("maps a duplicate sku code to a friendly message", () => {
    const msg = friendlyLinkRoastSkuError({
      code: "23505",
      message:
        'duplicate key value violates unique constraint "roast_skus_tenant_sku_ux"',
    });
    expect(msg).toMatch(/already in use|different code|sku/i);
    expect(msg).not.toMatch(/roast_skus_tenant_sku_ux|23505/);
  });

  it("maps an unknown batch to a friendly message", () => {
    const msg = friendlyLinkRoastSkuError({
      code: "23503",
      message: "unknown roast batch 99",
    });
    expect(msg).toMatch(/batch|found/i);
  });

  it("falls back to a clean generic line for anything unrecognised", () => {
    const msg = friendlyLinkRoastSkuError({ message: "deadlock detected" });
    expect(msg).toBeTruthy();
    expect(msg).not.toMatch(/deadlock detected/);
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("linkRoastSku", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await linkRoastSku(store, { ...validRaw(), skuCode: "" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls link_roast_sku once with the exact snake_case envelope and returns the sku id", async () => {
    const { store, rpc } = fakeStore({ data: 11, error: null });
    const result = await linkRoastSku(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("link_roast_sku", {
      p_batch_id: 5,
      p_sku_code: "JANSON-GEISHA-250",
      p_bag_size_g: 250,
      p_price_usd_cents: 2400,
      p_gtin: "07401234567890",
      p_idempotency_key: "idem-sku-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.skuId).toBe(11);
  });

  it("forwards a blank price / GTIN as null in the envelope", async () => {
    const { store, rpc } = fakeStore({ data: 11, error: null });
    await linkRoastSku(store, { ...validRaw(), priceUsdCents: "", gtin: "" });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_price_usd_cents).toBeNull();
    expect(args.p_gtin).toBeNull();
  });

  it("coerces a string id from PostgREST to a number", async () => {
    const { store } = fakeStore({ data: "12", error: null });
    const result = await linkRoastSku(store, validRaw());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.skuId).toBe(12);
  });

  it("surfaces the not-finalized rejection as a friendly message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        code: "23514",
        message: "roast batch 5 is not finalized — finalize it before linking a SKU",
      },
    });
    const result = await linkRoastSku(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/finaliz/i);
      expect(result.message).not.toMatch(/link_roast_sku/);
    }
  });

  it("returns a clean message when the RPC yields no id", async () => {
    const { store } = fakeStore({ data: null, error: null });
    const result = await linkRoastSku(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });
});
