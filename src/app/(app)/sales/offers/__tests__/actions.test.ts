import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Server Action calls `await (await getSupabase()).rpc(...)`. Mock a single rpc
// spy whose result each test sets. next-intl/server is mocked globally in setup.ts so
// validation messages resolve to the real EN copy the UI shows.
const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => Promise.resolve({ rpc: rpcMock }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { publishOfferAction } from "@/app/(app)/sales/offers/actions";

beforeEach(() => rpcMock.mockReset());
afterEach(() => vi.clearAllMocks());

const validInput = () => ({
  greenLotCode: "JC-204",
  regime: "reserve" as const,
  askingPrice: 480,
  kg: 250,
  currency: "USD",
  idempotencyKey: "idem-1",
});

describe("publishOfferAction — validation seam", () => {
  it("rejects a missing lot WITHOUT touching the database", async () => {
    const result = await publishOfferAction({ ...validInput(), greenLotCode: "  " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Pick a green lot to offer.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a non-positive asking price WITHOUT touching the database", async () => {
    const result = await publishOfferAction({ ...validInput(), askingPrice: 0 });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("publishOfferAction — command behaviour", () => {
  it("passes the EXACT snake_case p_ envelope to publish_green_offer", async () => {
    rpcMock.mockResolvedValue({ data: 9, error: null });
    const result = await publishOfferAction(validInput());
    expect(result).toEqual({ ok: true, offerId: 9 });
    expect(rpcMock).toHaveBeenCalledWith("publish_green_offer", {
      p_green_lot_code: "JC-204",
      p_regime: "reserve",
      p_asking_price: 480,
      p_kg: 250,
      p_currency: "USD",
      p_idempotency_key: "idem-1",
    });
  });

  it("forwards a null asking price (auction / RFQ) and a null kg (offer all)", async () => {
    rpcMock.mockResolvedValue({ data: 10, error: null });
    await publishOfferAction({
      ...validInput(),
      askingPrice: null,
      kg: null,
    });
    expect(rpcMock).toHaveBeenCalledWith("publish_green_offer", {
      p_green_lot_code: "JC-204",
      p_regime: "reserve",
      p_asking_price: null,
      p_kg: null,
      p_currency: "USD",
      p_idempotency_key: "idem-1",
    });
  });

  it("surfaces the author-written regime-isolation guard verbatim (no raw SQLSTATE leak)", async () => {
    const guard =
      "regime isolation: green lot JC-204 is Presidential-grade single-origin — it cannot be offered on the commodity index (reserve-only)";
    rpcMock.mockResolvedValue({ data: null, error: { message: guard, code: "23514" } });
    const result = await publishOfferAction({ ...validInput(), regime: "commodity" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(guard);
      expect(result.error).not.toMatch(/SQLSTATE|23514/);
    }
  });

  it("maps an unknown structural Postgres error to clean generic copy", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'relation "green_offers" does not exist', code: "42P01" },
    });
    const result = await publishOfferAction(validInput());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(
        "Could not publish that offer. Check the details and try again.",
      );
      expect(result.error).not.toMatch(/relation|green_offers/);
    }
  });
});
