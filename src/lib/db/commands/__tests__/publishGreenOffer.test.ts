import { describe, expect, it, vi } from "vitest";

import {
  friendlyPublishGreenOfferError,
  publishGreenOffer,
  validatePublishGreenOffer,
  type PublishGreenOfferStore,
} from "@/lib/db/commands/publishGreenOffer";

/**
 * Pure-domain command test for the append-only green-offer publisher (P3-S1). No
 * database: the command runs against a fake store stubbing `.rpc('publish_green_offer', …)`.
 * Pins the validation seam (regime enum, optional asking_price = auction/RFQ), the
 * exact snake_case envelope, and the KEYSTONE friendly mapping — a Presidential /
 * Specialty single-origin lot can NEVER be published on the commodity index (the
 * `_green_offers_regime_chk` trigger is the real guard).
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: PublishGreenOfferStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as PublishGreenOfferStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  greenLotCode: "JC-204",
  regime: "reserve",
  askingPrice: "480",
  kg: "300",
  currency: "USD",
  idempotencyKey: "idem-offer-1",
});

describe("validatePublishGreenOffer", () => {
  it("accepts a complete priced reserve offer", () => {
    const r = validatePublishGreenOffer(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.regime).toBe("reserve");
      expect(r.data.askingPrice).toBe(480);
      expect(r.data.kg).toBe(300);
    }
  });

  it("requires a green lot code", () => {
    const r = validatePublishGreenOffer({ ...validRaw(), greenLotCode: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.greenLotCode).toBeDefined();
  });

  it("accepts both regime enum values and rejects an unknown one", () => {
    expect(validatePublishGreenOffer({ ...validRaw(), regime: "commodity" }).ok).toBe(true);
    expect(validatePublishGreenOffer({ ...validRaw(), regime: "reserve" }).ok).toBe(true);
    const bad = validatePublishGreenOffer({ ...validRaw(), regime: "futures" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.regime).toBeDefined();
  });

  it("treats a blank asking_price as auction/RFQ (null, not 0)", () => {
    const r = validatePublishGreenOffer({ ...validRaw(), askingPrice: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.askingPrice).toBeNull();
  });

  it("rejects a non-positive asking_price when provided", () => {
    const r = validatePublishGreenOffer({ ...validRaw(), askingPrice: "0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.askingPrice).toBeDefined();
  });

  it("rejects a non-positive kg when provided", () => {
    const r = validatePublishGreenOffer({ ...validRaw(), kg: "-5" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.kg).toBeDefined();
  });

  it("requires an idempotency key", () => {
    const r = validatePublishGreenOffer({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

describe("friendlyPublishGreenOfferError", () => {
  it("maps the regime-check rejection to the reserve-only sentence", () => {
    const msg = friendlyPublishGreenOfferError({
      message: "regime check: this lot is reserve-only and cannot be offered as commodity",
    });
    expect(msg).toMatch(/reserve-only/i);
  });

  it("returns null for an unrecognised error", () => {
    expect(friendlyPublishGreenOfferError({ message: "some other failure" })).toBeNull();
  });
});

describe("publishGreenOffer", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await publishGreenOffer(store, { ...validRaw(), regime: "" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls publish_green_offer with the exact snake_case envelope and returns the offer id", async () => {
    const { store, rpc } = fakeStore({ data: 12, error: null });
    const result = await publishGreenOffer(store, validRaw());
    expect(rpc).toHaveBeenCalledWith("publish_green_offer", {
      p_green_lot_code: "JC-204",
      p_regime: "reserve",
      p_asking_price: 480,
      p_kg: 300,
      p_currency: "USD",
      p_idempotency_key: "idem-offer-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.offerId).toBe(12);
  });

  it("forwards null asking_price for an auction/RFQ offer", async () => {
    const { store, rpc } = fakeStore({ data: 13, error: null });
    await publishGreenOffer(store, { ...validRaw(), askingPrice: "" });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_asking_price).toBeNull();
  });

  it("surfaces the KEYSTONE reserve-only message when the regime trigger rejects", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "regime check: reserve-only lot cannot be commodity" },
    });
    const result = await publishGreenOffer(store, { ...validRaw(), regime: "commodity" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/reserve-only/i);
  });
});
