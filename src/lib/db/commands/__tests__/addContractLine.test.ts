import { describe, expect, it, vi } from "vitest";

import {
  addContractLine,
  friendlyAddContractLineError,
  validateAddContractLine,
  type AddContractLineStore,
} from "@/lib/db/commands/addContractLine";

/**
 * Pure-domain command test for the contract-line writer (P3-S1). No database: runs
 * against a fake store stubbing `.rpc('add_contract_line', …)`. The load-bearing step
 * (inside the RPC) inserts a `lot_reservations` row FIRST so the EXISTING `prevent_oversell`
 * trigger fires — the money guarantee is REUSED, not rebuilt. This command pins the
 * validation seam (kg > 0; unit_price optional; differential_cents may be negative),
 * the exact envelope, and the friendly mapping of the oversell / basis-check / draft-only
 * rejections to clean sentences.
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: AddContractLineStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as AddContractLineStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  contractId: "7",
  greenLotCode: "JC-550",
  kg: "2000",
  unitPrice: "",
  differentialCents: "35",
  iceCContractMonth: "2026-12",
  idempotencyKey: "idem-line-1",
});

describe("validateAddContractLine", () => {
  it("accepts a differential line (no unit_price, with differential + month)", () => {
    const r = validateAddContractLine(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.contractId).toBe(7);
      expect(r.data.kg).toBe(2000);
      expect(r.data.unitPrice).toBeNull();
      expect(r.data.differentialCents).toBe(35);
      expect(r.data.iceCContractMonth).toBe("2026-12");
    }
  });

  it("accepts a fixed line (unit_price set, no differential)", () => {
    const r = validateAddContractLine({
      contractId: "7",
      greenLotCode: "JC-204",
      kg: "250",
      unitPrice: "480",
      differentialCents: "",
      iceCContractMonth: "",
      idempotencyKey: "idem-line-2",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.unitPrice).toBe(480);
      expect(r.data.differentialCents).toBeNull();
      expect(r.data.iceCContractMonth).toBeNull();
    }
  });

  it("requires a contract id and a green lot", () => {
    expect(validateAddContractLine({ ...validRaw(), contractId: "" }).ok).toBe(false);
    expect(validateAddContractLine({ ...validRaw(), greenLotCode: "" }).ok).toBe(false);
  });

  it("requires kg > 0 (the NOT NULL check>0)", () => {
    expect(validateAddContractLine({ ...validRaw(), kg: "" }).ok).toBe(false);
    expect(validateAddContractLine({ ...validRaw(), kg: "0" }).ok).toBe(false);
    expect(validateAddContractLine({ ...validRaw(), kg: "-1" }).ok).toBe(false);
  });

  it("rejects a non-positive unit_price when provided", () => {
    const r = validateAddContractLine({ ...validRaw(), unitPrice: "0", differentialCents: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.unitPrice).toBeDefined();
  });

  it("allows a negative differential_cents (a discount to the index)", () => {
    const r = validateAddContractLine({ ...validRaw(), differentialCents: "-15" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.differentialCents).toBe(-15);
  });

  it("requires an idempotency key", () => {
    const r = validateAddContractLine({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

describe("friendlyAddContractLineError", () => {
  it("maps the oversell rejection", () => {
    expect(
      friendlyAddContractLineError({ message: "oversell guard: would exceed available-to-promise" }),
    ).toMatch(/available-to-promise/i);
  });

  it("maps the basis-check (reserve lot on a differential contract)", () => {
    expect(
      friendlyAddContractLineError({ message: "contract pricing basis check: reserve lot cannot be differential" }),
    ).toMatch(/reserve/i);
  });

  it("maps the draft-only status guard", () => {
    expect(
      friendlyAddContractLineError({ message: "contract is not in draft status" }),
    ).toMatch(/draft/i);
  });

  it("returns null for an unrecognised error", () => {
    expect(friendlyAddContractLineError({ message: "weird failure" })).toBeNull();
  });
});

describe("addContractLine", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await addContractLine(store, { ...validRaw(), kg: "0" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls add_contract_line with the exact snake_case envelope and returns the line id", async () => {
    const { store, rpc } = fakeStore({ data: 21, error: null });
    const result = await addContractLine(store, validRaw());
    expect(rpc).toHaveBeenCalledWith("add_contract_line", {
      p_contract_id: 7,
      p_green_lot_code: "JC-550",
      p_kg: 2000,
      p_unit_price: null,
      p_differential_cents: 35,
      p_ice_c_contract_month: "2026-12",
      p_idempotency_key: "idem-line-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lineId).toBe(21);
  });

  it("surfaces the oversell message when prevent_oversell rejects the reservation", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "oversell guard: would exceed available-to-promise on JC-204" },
    });
    const result = await addContractLine(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/available-to-promise/i);
  });
});
