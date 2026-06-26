import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => Promise.resolve({ rpc: rpcMock }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  addContractLineAction,
  signContractAction,
} from "@/app/(app)/sales/contracts/[no]/actions";

beforeEach(() => rpcMock.mockReset());
afterEach(() => vi.clearAllMocks());

const lineInput = () => ({
  contractId: 1,
  greenLotCode: "JC-204",
  kg: 250,
  unitPrice: null,
  differentialCents: 35,
  iceCMonth: "DEC25",
  idempotencyKey: "idem-l1",
});

describe("addContractLineAction — validation seam", () => {
  it("rejects a missing lot WITHOUT touching the database", async () => {
    const result = await addContractLineAction({ ...lineInput(), greenLotCode: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Pick a green lot.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a non-positive kg WITHOUT touching the database", async () => {
    const result = await addContractLineAction({ ...lineInput(), kg: 0 });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("addContractLineAction — command behaviour", () => {
  it("passes the EXACT snake_case p_ envelope to add_contract_line", async () => {
    rpcMock.mockResolvedValue({ data: 11, error: null });
    const result = await addContractLineAction(lineInput());
    expect(result).toEqual({ ok: true, lineId: 11 });
    expect(rpcMock).toHaveBeenCalledWith("add_contract_line", {
      p_contract_id: 1,
      p_green_lot_code: "JC-204",
      p_kg: 250,
      p_unit_price: null,
      p_differential_cents: 35,
      p_ice_c_contract_month: "DEC25",
      p_idempotency_key: "idem-l1",
    });
  });

  it("surfaces the oversell guard verbatim when the reservation would oversell", async () => {
    const guard =
      "oversell guard: committing 250 kg to green lot JC-204 would exceed its 50 kg available-to-promise";
    rpcMock.mockResolvedValue({ data: null, error: { message: guard, code: "23514" } });
    const result = await addContractLineAction(lineInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(guard);
  });

  it("maps an unknown structural Postgres error to clean generic copy", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'relation "contract_lines" does not exist', code: "42P01" },
    });
    const result = await addContractLineAction(lineInput());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(
        "Could not add that line. Check the details and try again.",
      );
      expect(result.error).not.toMatch(/relation|contract_lines/);
    }
  });
});

describe("signContractAction — the legal instrument", () => {
  it("passes the exact envelope to sign_sales_contract and returns the contract id", async () => {
    rpcMock.mockResolvedValue({ data: 1, error: null });
    const result = await signContractAction({
      contractId: 1,
      idempotencyKey: "idem-s1",
    });
    expect(result).toEqual({ ok: true, contractId: 1 });
    expect(rpcMock).toHaveBeenCalledWith("sign_sales_contract", {
      p_contract_id: 1,
      p_idempotency_key: "idem-s1",
    });
  });

  it("surfaces the no-lines guard verbatim", async () => {
    const guard = "contract JC-K-0001 cannot be signed with no lines";
    rpcMock.mockResolvedValue({ data: null, error: { message: guard, code: "23514" } });
    const result = await signContractAction({
      contractId: 1,
      idempotencyKey: "idem-s2",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(guard);
  });
});
