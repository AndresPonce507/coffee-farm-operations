import { describe, expect, it, vi } from "vitest";

import {
  friendlySignSalesContractError,
  signSalesContract,
  validateSignSalesContract,
  type SignSalesContractStore,
} from "@/lib/db/commands/signSalesContract";

/**
 * Pure-domain command test for the contract-signing writer (P3-S1, keystone re-created
 * in P3-S2 with the same `(bigint, text)` signature). No database: runs against a fake
 * store stubbing `.rpc('sign_sales_contract', …)`. Pins the validation seam (a real
 * contract id), the exact envelope, and the friendly mapping of the gates the RPC
 * enforces: >=1 line, draft-only, and the reserve-contract approved-sample prereq
 * (the P3-S2 gate — mapped forward so the message is ready the moment S2 lands).
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: SignSalesContractStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as SignSalesContractStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  contractId: "7",
  idempotencyKey: "idem-sign-1",
});

describe("validateSignSalesContract", () => {
  it("accepts a valid contract id", () => {
    const r = validateSignSalesContract(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.contractId).toBe(7);
  });

  it("rejects a missing / non-positive / non-integer contract id", () => {
    expect(validateSignSalesContract({ ...validRaw(), contractId: "" }).ok).toBe(false);
    expect(validateSignSalesContract({ ...validRaw(), contractId: "0" }).ok).toBe(false);
    expect(validateSignSalesContract({ ...validRaw(), contractId: "1.5" }).ok).toBe(false);
  });

  it("accepts the contract id under the `contractNo`-style numeric alias too", () => {
    // The pricing UI may pass the id as a number directly.
    const r = validateSignSalesContract({ contractId: 9, idempotencyKey: "k" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.contractId).toBe(9);
  });

  it("requires an idempotency key", () => {
    const r = validateSignSalesContract({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

describe("friendlySignSalesContractError", () => {
  it("maps the >=1-line gate", () => {
    expect(
      friendlySignSalesContractError({ message: "contract requires at least one line before signing" }),
    ).toMatch(/line/i);
  });

  it("maps the draft-only / already-signed gate", () => {
    expect(
      friendlySignSalesContractError({ message: "contract is not in draft status" }),
    ).toMatch(/sign/i);
  });

  it("maps the reserve approved-sample prereq (P3-S2 gate)", () => {
    expect(
      friendlySignSalesContractError({ message: "reserve contract requires an approved pre-shipment sample" }),
    ).toMatch(/sample/i);
  });

  it("returns null for an unrecognised error", () => {
    expect(friendlySignSalesContractError({ message: "weird failure" })).toBeNull();
  });
});

describe("signSalesContract", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await signSalesContract(store, { ...validRaw(), contractId: "" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls sign_sales_contract with the exact snake_case envelope and returns the contract id", async () => {
    const { store, rpc } = fakeStore({ data: 7, error: null });
    const result = await signSalesContract(store, validRaw());
    expect(rpc).toHaveBeenCalledWith("sign_sales_contract", {
      p_contract_id: 7,
      p_idempotency_key: "idem-sign-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.contractId).toBe(7);
  });

  it("surfaces the no-lines message when the gate rejects", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "contract requires at least one line before signing" },
    });
    const result = await signSalesContract(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/line/i);
  });
});
