import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => Promise.resolve({ rpc: rpcMock }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  createBuyerAction,
  createContractAction,
} from "@/app/(app)/sales/contracts/actions";

beforeEach(() => rpcMock.mockReset());
afterEach(() => vi.clearAllMocks());

const contractInput = () => ({
  buyerId: 7,
  incoterm: "FOB",
  incotermNamedPlace: "Balboa, PA",
  contractStandard: "GCA" as const,
  pricingBasis: "differential" as const,
  currency: "USD",
  idempotencyKey: "idem-c1",
});

describe("createContractAction — validation seam", () => {
  it("rejects a missing buyer WITHOUT touching the database", async () => {
    const result = await createContractAction({ ...contractInput(), buyerId: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Pick a buyer for this contract.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a missing incoterm WITHOUT touching the database", async () => {
    const result = await createContractAction({ ...contractInput(), incoterm: "" });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("createContractAction — command behaviour", () => {
  it("passes the EXACT snake_case p_ envelope to create_sales_contract", async () => {
    rpcMock.mockResolvedValue({ data: 42, error: null });
    const result = await createContractAction(contractInput());
    expect(result).toEqual({ ok: true, contractId: 42 });
    expect(rpcMock).toHaveBeenCalledWith("create_sales_contract", {
      p_buyer_id: 7,
      p_incoterm: "FOB",
      p_incoterm_named_place: "Balboa, PA",
      p_contract_standard: "GCA",
      p_pricing_basis: "differential",
      p_currency: "USD",
      p_idempotency_key: "idem-c1",
    });
  });

  it("maps an unknown structural Postgres error to clean generic copy", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'relation "sales_contracts" does not exist', code: "42P01" },
    });
    const result = await createContractAction(contractInput());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(
        "Could not create that contract. Check the details and try again.",
      );
      expect(result.error).not.toMatch(/relation|sales_contracts/);
    }
  });
});

describe("createBuyerAction — command behaviour", () => {
  it("rejects an empty name WITHOUT touching the database", async () => {
    const result = await createBuyerAction({
      name: "  ",
      countryCode: "JP",
      buyerType: "roaster",
      defaultIncoterm: "FOB",
      defaultCurrency: "USD",
      idempotencyKey: "idem-b1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Enter the buyer's name.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("passes the EXACT snake_case p_ envelope to create_b2b_buyer", async () => {
    rpcMock.mockResolvedValue({ data: 9, error: null });
    const result = await createBuyerAction({
      name: "  Tokyo Roasters ",
      countryCode: "jp",
      buyerType: "roaster",
      defaultIncoterm: "FOB",
      defaultCurrency: "USD",
      idempotencyKey: "idem-b2",
    });
    expect(result).toEqual({ ok: true, buyerId: 9 });
    expect(rpcMock).toHaveBeenCalledWith("create_b2b_buyer", {
      p_name: "Tokyo Roasters",
      p_country_code: "JP",
      p_buyer_type: "roaster",
      p_default_incoterm: "FOB",
      p_default_currency: "USD",
      p_idempotency_key: "idem-b2",
    });
  });
});
