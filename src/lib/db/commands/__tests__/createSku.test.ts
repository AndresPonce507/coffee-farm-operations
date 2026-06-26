import { describe, expect, it, vi } from "vitest";

import {
  createSku,
  validateCreateSku,
  type CreateSkuStore,
} from "@/lib/db/commands/createSku";

/**
 * Pure-domain command test for the lot-linked SKU writer (P3-S11; ADR-002 — every
 * write flows through a SECURITY DEFINER RPC). No database: the command runs against
 * a *fake store* stubbing `.rpc('create_sku', …)`, proving (a) the friendly-validation
 * seam (the pack_format / bag_size enums, the price >= 0 integer CHECK, the optional
 * roast-SKU/GTIN/Stripe-price fields, the is_reserve_club boolean default), (b) the
 * exact snake_case argument envelope, and (c) that the DATA-LAYER lot-backing guard
 * (invariant 5 — a SKU can't claim a green lot it isn't backed by) surfaces as a
 * CLEAN, family-readable sentence, never raw Postgres text.
 *
 * The FK + the RPC's `SKU lot-backing guard` raise are the REAL enforcement (pinned
 * by the migration's PGlite test); this command's job is the friendly seam.
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: CreateSkuStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as CreateSkuStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  productId: "1",
  greenLotCode: "JC-701",
  roastSkuId: "5",
  packFormat: "whole-bean",
  bagSize: "250g",
  priceUsdCents: "2800",
  gtin: "0850000000019",
  stripePriceId: "price_abc",
  isReserveClub: "true",
  idempotencyKey: "idem-sku-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateCreateSku", () => {
  it("accepts a complete, well-formed SKU", () => {
    const r = validateCreateSku(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.productId).toBe(1);
      expect(r.data.greenLotCode).toBe("JC-701");
      expect(r.data.roastSkuId).toBe(5);
      expect(r.data.packFormat).toBe("whole-bean");
      expect(r.data.bagSize).toBe("250g");
      expect(r.data.priceUsdCents).toBe(2800);
      expect(r.data.gtin).toBe("0850000000019");
      expect(r.data.stripePriceId).toBe("price_abc");
      expect(r.data.isReserveClub).toBe(true);
      expect(r.data.idempotencyKey).toBe("idem-sku-1");
    }
  });

  it("defaults a blank is_reserve_club to false and blank optionals to null", () => {
    const r = validateCreateSku({
      ...validRaw(),
      roastSkuId: "",
      gtin: "",
      stripePriceId: "",
      isReserveClub: "",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.roastSkuId).toBeNull();
      expect(r.data.gtin).toBeNull();
      expect(r.data.stripePriceId).toBeNull();
      expect(r.data.isReserveClub).toBe(false);
    }
  });

  it("accepts every pack_format and bag_size enum value", () => {
    for (const pf of ["whole-bean", "ground"]) {
      const r = validateCreateSku({ ...validRaw(), packFormat: pf });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.packFormat).toBe(pf);
    }
    for (const bs of ["250g", "340g", "454g", "1kg", "12oz"]) {
      const r = validateCreateSku({ ...validRaw(), bagSize: bs });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.bagSize).toBe(bs);
    }
  });

  it("rejects an unknown pack_format / bag_size", () => {
    const pf = validateCreateSku({ ...validRaw(), packFormat: "espresso-pod" });
    expect(pf.ok).toBe(false);
    if (!pf.ok) expect(pf.errors.packFormat).toBeDefined();

    const bs = validateCreateSku({ ...validRaw(), bagSize: "5kg" });
    expect(bs.ok).toBe(false);
    if (!bs.ok) expect(bs.errors.bagSize).toBeDefined();
  });

  it("rejects a missing green lot code (the keystone link)", () => {
    const r = validateCreateSku({ ...validRaw(), greenLotCode: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.greenLotCode).toBeDefined();
  });

  it("rejects a missing or non-positive product id", () => {
    const missing = validateCreateSku({ ...validRaw(), productId: "" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors.productId).toBeDefined();

    const zero = validateCreateSku({ ...validRaw(), productId: "0" });
    expect(zero.ok).toBe(false);
  });

  it("rejects a negative or non-integer price (the price_usd_cents >= 0 integer CHECK)", () => {
    const neg = validateCreateSku({ ...validRaw(), priceUsdCents: "-1" });
    expect(neg.ok).toBe(false);
    if (!neg.ok) expect(neg.errors.priceUsdCents).toBeDefined();

    const frac = validateCreateSku({ ...validRaw(), priceUsdCents: "28.5" });
    expect(frac.ok).toBe(false);
  });

  it("allows a zero price (a free sample bag — the CHECK is >= 0)", () => {
    const r = validateCreateSku({ ...validRaw(), priceUsdCents: "0" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.priceUsdCents).toBe(0);
  });

  it("rejects a non-positive roast_sku_id when provided", () => {
    const r = validateCreateSku({ ...validRaw(), roastSkuId: "0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.roastSkuId).toBeDefined();
  });

  it("rejects a missing idempotency key", () => {
    const r = validateCreateSku({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("createSku", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await createSku(store, { ...validRaw(), greenLotCode: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.greenLotCode).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls create_sku with the exact snake_case envelope (arg order matches the RPC)", async () => {
    const { store, rpc } = fakeStore({ data: 21, error: null });
    const result = await createSku(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("create_sku", {
      p_product_id: 1,
      p_green_lot_code: "JC-701",
      p_roast_sku_id: 5,
      p_pack_format: "whole-bean",
      p_bag_size: "250g",
      p_price_usd_cents: 2800,
      p_gtin: "0850000000019",
      p_stripe_price_id: "price_abc",
      p_is_reserve_club: true,
      p_idempotency_key: "idem-sku-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.skuId).toBe(21);
  });

  it("forwards null for blank optional roast_sku/gtin/stripe and false reserve-club", async () => {
    const { store, rpc } = fakeStore({ data: 22, error: null });
    await createSku(store, {
      ...validRaw(),
      roastSkuId: "",
      gtin: "",
      stripePriceId: "",
      isReserveClub: "",
    });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_roast_sku_id).toBeNull();
    expect(args.p_gtin).toBeNull();
    expect(args.p_stripe_price_id).toBeNull();
    expect(args.p_is_reserve_club).toBe(false);
  });

  it("maps the lot-backing guard (invariant 5) to a CLEAN family-readable sentence", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        message:
          "SKU lot-backing guard: green lot JC-999 does not exist — a SKU cannot claim a lot it is not backed by",
        code: "23503",
      },
    });
    const result = await createSku(store, { ...validRaw(), greenLotCode: "JC-999" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/green lot/i);
      expect(result.message).not.toMatch(/guard|23503/);
    }
  });

  it("maps an unknown product to a clean message", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "unknown product 999", code: "23503" },
    });
    const result = await createSku(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/product/i);
  });

  it("surfaces a generic clean message for an unrecognised RPC failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "internal boom" },
    });
    const result = await createSku(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBeTruthy();
      expect(result.message).not.toContain("boom");
    }
  });
});
