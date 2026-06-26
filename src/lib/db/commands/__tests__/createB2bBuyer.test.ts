import { describe, expect, it, vi } from "vitest";

import {
  createB2bBuyer,
  validateCreateB2bBuyer,
  type CreateB2bBuyerStore,
} from "@/lib/db/commands/createB2bBuyer";

/**
 * Pure-domain command test for the B2B buyer-master writer (P3-S1; ADR-002 — every
 * write flows through the SECURITY DEFINER `create_b2b_buyer` RPC). No database: the
 * command runs against a fake store stubbing `.rpc('create_b2b_buyer', …)`, proving
 * (a) the friendly-validation seam, (b) the exact snake_case argument envelope (incl.
 * the currency default + optional fields forwarding null), (c) a clean labelled error
 * on failure. The tenant clamp + buyer_type CHECK are the real enforcement (PGlite).
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: CreateB2bBuyerStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as CreateB2bBuyerStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  name: "Maruyama Coffee",
  countryCode: "JP",
  buyerType: "roaster",
  defaultIncoterm: "FOB",
  defaultCurrency: "USD",
  idempotencyKey: "idem-buyer-1",
});

describe("validateCreateB2bBuyer", () => {
  it("accepts a complete buyer", () => {
    const r = validateCreateB2bBuyer(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.name).toBe("Maruyama Coffee");
      expect(r.data.buyerType).toBe("roaster");
      expect(r.data.defaultCurrency).toBe("USD");
    }
  });

  it("requires a name", () => {
    const r = validateCreateB2bBuyer({ ...validRaw(), name: "  " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.name).toBeDefined();
  });

  it("defaults a blank currency to USD", () => {
    const r = validateCreateB2bBuyer({ ...validRaw(), defaultCurrency: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.defaultCurrency).toBe("USD");
  });

  it("forwards null for blank optional fields", () => {
    const r = validateCreateB2bBuyer({
      name: "Agent X",
      countryCode: "",
      buyerType: "",
      defaultIncoterm: "",
      idempotencyKey: "idem-2",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.countryCode).toBeNull();
      expect(r.data.buyerType).toBeNull();
      expect(r.data.defaultIncoterm).toBeNull();
    }
  });

  it("accepts every buyer_type enum value", () => {
    for (const t of ["roaster", "importer", "agent"]) {
      const r = validateCreateB2bBuyer({ ...validRaw(), buyerType: t });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.buyerType).toBe(t);
    }
  });

  it("rejects an unknown buyer_type", () => {
    const r = validateCreateB2bBuyer({ ...validRaw(), buyerType: "distributor" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.buyerType).toBeDefined();
  });

  it("requires an idempotency key", () => {
    const r = validateCreateB2bBuyer({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

describe("createB2bBuyer", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await createB2bBuyer(store, { ...validRaw(), name: "" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls create_b2b_buyer with the exact snake_case envelope and returns the buyer id", async () => {
    const { store, rpc } = fakeStore({ data: 3, error: null });
    const result = await createB2bBuyer(store, validRaw());
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("create_b2b_buyer", {
      p_name: "Maruyama Coffee",
      p_country_code: "JP",
      p_buyer_type: "roaster",
      p_default_incoterm: "FOB",
      p_default_currency: "USD",
      p_idempotency_key: "idem-buyer-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.buyerId).toBe(3);
  });

  it("forwards null for blank optional args", async () => {
    const { store, rpc } = fakeStore({ data: 4, error: null });
    await createB2bBuyer(store, {
      name: "Agent X",
      countryCode: "",
      buyerType: "",
      defaultIncoterm: "",
      idempotencyKey: "idem-2",
    });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_country_code).toBeNull();
    expect(args.p_buyer_type).toBeNull();
    expect(args.p_default_incoterm).toBeNull();
    expect(args.p_default_currency).toBe("USD");
  });

  it("coerces a string id from PostgREST to a number", async () => {
    const { store } = fakeStore({ data: "9", error: null });
    const result = await createB2bBuyer(store, validRaw());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.buyerId).toBe(9);
  });

  it("surfaces a labelled error (never raw PG) when the RPC fails", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "duplicate key value violates unique constraint", code: "23505" },
    });
    const result = await createB2bBuyer(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });
});
