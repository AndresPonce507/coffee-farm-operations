import { describe, expect, it, vi } from "vitest";

import {
  fixContractPrice,
  friendlyFixContractPriceError,
  validateFixContractPrice,
  type FixContractPriceStore,
} from "@/lib/db/commands/fixContractPrice";

/**
 * Pure-domain command test for the differential-leg fixation writer (P3-S1). No
 * database: runs against a fake store stubbing `.rpc('fix_contract_price', …)`. The
 * RPC reads the P3-S0 `v_ice_c_latest` "C" mark, computes unit_price via the
 * convert_qty-backed lb→kg factor (never a 2.2046 literal), flips the contract to
 * 'fixed' and appends a 'price_fixed' event — all server-side. This command pins the
 * validation seam (a real line id), the exact envelope, and the friendly mapping of
 * the no-live-mark / already-fixed / cancelled-reservation rejections.
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: FixContractPriceStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as FixContractPriceStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  contractLineId: "21",
  idempotencyKey: "idem-fix-1",
});

describe("validateFixContractPrice", () => {
  it("accepts a valid contract line id", () => {
    const r = validateFixContractPrice(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.contractLineId).toBe(21);
  });

  it("rejects a missing / non-positive / non-integer line id", () => {
    expect(validateFixContractPrice({ ...validRaw(), contractLineId: "" }).ok).toBe(false);
    expect(validateFixContractPrice({ ...validRaw(), contractLineId: "0" }).ok).toBe(false);
    expect(validateFixContractPrice({ ...validRaw(), contractLineId: "2.5" }).ok).toBe(false);
  });

  it("requires an idempotency key", () => {
    const r = validateFixContractPrice({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

describe("friendlyFixContractPriceError", () => {
  it("maps the no-live-mark rejection", () => {
    expect(
      friendlyFixContractPriceError({ message: "no ice c mark for contract month 2026-12" }),
    ).toMatch(/mark/i);
  });

  it("maps the already-fixed / not-differential rejection", () => {
    expect(
      friendlyFixContractPriceError({ message: "line already fixed" }),
    ).toMatch(/fixed/i);
  });

  it("maps the cancelled-reservation rejection (no phantom kg)", () => {
    expect(
      friendlyFixContractPriceError({ message: "reservation was cancelled" }),
    ).toMatch(/cancelled|reservation/i);
  });

  it("returns null for an unrecognised error", () => {
    expect(friendlyFixContractPriceError({ message: "weird failure" })).toBeNull();
  });
});

describe("fixContractPrice", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await fixContractPrice(store, { ...validRaw(), contractLineId: "" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls fix_contract_price with the exact snake_case envelope and returns the line id", async () => {
    const { store, rpc } = fakeStore({ data: 21, error: null });
    const result = await fixContractPrice(store, validRaw());
    expect(rpc).toHaveBeenCalledWith("fix_contract_price", {
      p_contract_line_id: 21,
      p_idempotency_key: "idem-fix-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lineId).toBe(21);
  });

  it("surfaces the no-live-mark message when the RPC rejects", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "no ice c mark for contract month 2026-12 yet" },
    });
    const result = await fixContractPrice(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/mark/i);
  });
});
