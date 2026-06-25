import { describe, expect, it, vi } from "vitest";

import {
  createSalesContract,
  validateCreateSalesContract,
  type CreateSalesContractStore,
} from "@/lib/db/commands/createSalesContract";

/**
 * Pure-domain command test for the sales-contract minter (P3-S1). No database: runs
 * against a fake store stubbing `.rpc('create_sales_contract', …)`. Pins the
 * validation seam (Incoterms-2020 enum, pricing_basis enum, contract_standard enum,
 * currency default), the exact snake_case envelope, and a clean labelled error. The
 * gap-free JC-K-NNNN minter under the advisory lock is the RPC's job (PGlite proves it).
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: CreateSalesContractStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as CreateSalesContractStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  buyerId: "3",
  incoterm: "FOB",
  incotermNamedPlace: "Balboa, PA",
  contractStandard: "GCA",
  pricingBasis: "differential",
  currency: "USD",
  idempotencyKey: "idem-contract-1",
});

describe("validateCreateSalesContract", () => {
  it("accepts a complete GCA / FOB / differential contract", () => {
    const r = validateCreateSalesContract(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.buyerId).toBe(3);
      expect(r.data.incoterm).toBe("FOB");
      expect(r.data.pricingBasis).toBe("differential");
      expect(r.data.contractStandard).toBe("GCA");
    }
  });

  it("requires a valid buyer id", () => {
    expect(validateCreateSalesContract({ ...validRaw(), buyerId: "" }).ok).toBe(false);
    expect(validateCreateSalesContract({ ...validRaw(), buyerId: "0" }).ok).toBe(false);
    expect(validateCreateSalesContract({ ...validRaw(), buyerId: "2.5" }).ok).toBe(false);
  });

  it("accepts every Incoterms-2020 value and rejects an invalid one", () => {
    for (const t of ["EXW", "FCA", "CPT", "CIP", "DAP", "DPU", "DDP", "FAS", "FOB", "CFR", "CIF"]) {
      expect(validateCreateSalesContract({ ...validRaw(), incoterm: t }).ok).toBe(true);
    }
    const bad = validateCreateSalesContract({ ...validRaw(), incoterm: "XYZ" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.incoterm).toBeDefined();
  });

  it("accepts every pricing_basis value and rejects an invalid one", () => {
    for (const t of ["fixed", "differential", "auction"]) {
      expect(validateCreateSalesContract({ ...validRaw(), pricingBasis: t }).ok).toBe(true);
    }
    const bad = validateCreateSalesContract({ ...validRaw(), pricingBasis: "spot" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.pricingBasis).toBeDefined();
  });

  it("accepts the contract_standard enum, forwards null when blank, rejects an invalid one", () => {
    for (const t of ["GCA", "ECF", "custom"]) {
      expect(validateCreateSalesContract({ ...validRaw(), contractStandard: t }).ok).toBe(true);
    }
    const blank = validateCreateSalesContract({ ...validRaw(), contractStandard: "" });
    expect(blank.ok).toBe(true);
    if (blank.ok) expect(blank.data.contractStandard).toBeNull();
    expect(validateCreateSalesContract({ ...validRaw(), contractStandard: "FLO" }).ok).toBe(false);
  });

  it("forwards null for a blank named place and defaults the currency to USD", () => {
    const r = validateCreateSalesContract({
      ...validRaw(),
      incotermNamedPlace: "",
      currency: "",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.incotermNamedPlace).toBeNull();
      expect(r.data.currency).toBe("USD");
    }
  });

  it("requires an idempotency key", () => {
    const r = validateCreateSalesContract({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

describe("createSalesContract", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await createSalesContract(store, { ...validRaw(), incoterm: "ZZZ" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls create_sales_contract with the exact snake_case envelope and returns the contract id", async () => {
    const { store, rpc } = fakeStore({ data: 7, error: null });
    const result = await createSalesContract(store, validRaw());
    expect(rpc).toHaveBeenCalledWith("create_sales_contract", {
      p_buyer_id: 3,
      p_incoterm: "FOB",
      p_incoterm_named_place: "Balboa, PA",
      p_contract_standard: "GCA",
      p_pricing_basis: "differential",
      p_currency: "USD",
      p_idempotency_key: "idem-contract-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.contractId).toBe(7);
  });

  it("surfaces a labelled error (never raw PG) when the buyer FK is unknown", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "insert or update on table violates foreign key constraint", code: "23503" },
    });
    const result = await createSalesContract(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });
});
