import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Server Actions call `await (await getSupabase()).rpc(...)` then maybe
// reactiveRefresh → revalidatePath. Mock both: one rpc spy whose result each test
// sets, and a no-op revalidatePath. next-intl/server is mocked globally in setup.ts,
// so getTranslations resolves the real EN copy.
const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => Promise.resolve({ rpc: rpcMock }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  issueArDocAction,
  retrySyncAction,
  setAccountMapAction,
  settleArPaymentAction,
  voidArDocAction,
} from "@/app/(app)/finance/actions";

beforeEach(() => rpcMock.mockReset());
afterEach(() => vi.clearAllMocks());

const issueInput = () => ({
  kind: "commercial_invoice",
  currency: "USD",
  lines: [
    {
      greenLotCode: "JC-901",
      description: "Geisha washed",
      kg: 30,
      unitPriceDoc: 480,
      amountDoc: 14400,
      sourceKind: "green_sale",
    },
  ],
  buyerRef: "Tokyo Roasters",
  contractRef: "CT-1",
  incoterm: "FOB",
  targets: ["qbo"],
  idempotencyKey: "idem-issue-1",
});

describe("issueArDocAction — the AR mint (money guarantee reused)", () => {
  it("passes the EXACT snake_case envelope with snake_case line objects to issue_ar_doc", async () => {
    rpcMock.mockResolvedValue({ data: 42, error: null });
    const result = await issueArDocAction(issueInput());
    expect(result).toEqual({ ok: true, docId: 42 });
    expect(rpcMock).toHaveBeenCalledWith("issue_ar_doc", {
      p_kind: "commercial_invoice",
      p_currency: "USD",
      p_lines: [
        {
          green_lot_code: "JC-901",
          description: "Geisha washed",
          kg: 30,
          unit_price_doc: 480,
          amount_doc: 14400,
          source_kind: "green_sale",
        },
      ],
      p_buyer_ref: "Tokyo Roasters",
      p_contract_ref: "CT-1",
      p_incoterm: "FOB",
      p_targets: ["qbo"],
      p_idempotency_key: "idem-issue-1",
    });
  });

  it("blocks a commercial invoice with no contract/Incoterm WITHOUT touching the database (the export gate)", async () => {
    const result = await issueArDocAction({
      ...issueInput(),
      contractRef: null,
      incoterm: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(
        "A commercial invoice needs a contract reference and an Incoterm.",
      );
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("surfaces the oversell guard message verbatim (never a raw SQLSTATE leak)", async () => {
    const guard =
      "oversell guard: invoicing 31 kg of green lot JC-901 would exceed its 30 kg available-to-promise";
    rpcMock.mockResolvedValue({ data: null, error: { message: guard, code: "23514" } });
    const result = await issueArDocAction(issueInput());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(guard);
      expect(result.error).not.toMatch(/SQLSTATE|23514/);
    }
  });

  it("maps an unknown structural Postgres error to clean generic copy", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'relation "ar_doc" does not exist', code: "42P01" },
    });
    const result = await issueArDocAction(issueInput());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(
        "Could not save that. Check the numbers and try again.",
      );
      expect(result.error).not.toMatch(/relation|ar_doc/);
    }
  });
});

describe("settleArPaymentAction — the money-shaped, human-confirmed write", () => {
  it("rejects a non-positive amount WITHOUT touching the database", async () => {
    const result = await settleArPaymentAction({
      arDocId: 7,
      method: "wire",
      amountDoc: 0,
      currency: "USD",
      idempotencyKey: "gw-1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Amount must be greater than zero.");
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("passes the exact envelope (p_enqueue_sync true) and returns the payment id", async () => {
    rpcMock.mockResolvedValue({ data: 555, error: null });
    const result = await settleArPaymentAction({
      arDocId: 7,
      method: "wire",
      amountDoc: 14400,
      currency: "USD",
      idempotencyKey: "gw-evt-1",
    });
    expect(result).toEqual({ ok: true, paymentId: 555 });
    expect(rpcMock).toHaveBeenCalledWith("settle_ar_payment", {
      p_ar_doc_id: 7,
      p_method: "wire",
      p_amount_doc: 14400,
      p_currency: "USD",
      p_idempotency_key: "gw-evt-1",
      p_enqueue_sync: true,
    });
  });

  it("surfaces the overpayment guard message verbatim", async () => {
    const guard = "overpayment: paid 14400 + 1000 would exceed doc total 14400";
    rpcMock.mockResolvedValue({ data: null, error: { message: guard, code: "23514" } });
    const result = await settleArPaymentAction({
      arDocId: 7,
      method: "wire",
      amountDoc: 1000,
      currency: "USD",
      idempotencyKey: "gw-2",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(guard);
  });
});

describe("voidArDocAction — reversing, never deleting", () => {
  it("rejects an empty reason WITHOUT touching the database", async () => {
    const result = await voidArDocAction({
      arDocId: 7,
      reason: "   ",
      idempotencyKey: "v-1",
    });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("passes the exact envelope to void_ar_doc", async () => {
    rpcMock.mockResolvedValue({ data: 7, error: null });
    const result = await voidArDocAction({
      arDocId: 7,
      reason: "duplicate",
      idempotencyKey: "v-2",
    });
    expect(result).toEqual({ ok: true, docId: 7 });
    expect(rpcMock).toHaveBeenCalledWith("void_ar_doc", {
      p_ar_doc_id: 7,
      p_reason: "duplicate",
      p_idempotency_key: "v-2",
    });
  });

  it("surfaces the void-with-payments guard message verbatim", async () => {
    const guard = "ar_doc 7 has payments — issue a credit note, do not void";
    rpcMock.mockResolvedValue({ data: null, error: { message: guard, code: "23514" } });
    const result = await voidArDocAction({
      arDocId: 7,
      reason: "x",
      idempotencyKey: "v-3",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(guard);
  });
});

describe("setAccountMapAction — mapping our ledger onto the buyer's chart", () => {
  it("passes the exact envelope to set_account_map", async () => {
    rpcMock.mockResolvedValue({ data: 3, error: null });
    const result = await setAccountMapAction({
      target: "qbo",
      entryKind: "revenue",
      matchKey: "green_sale",
      accountCode: "4000",
      accountName: "Coffee sales",
    });
    expect(result).toEqual({ ok: true, id: 3 });
    expect(rpcMock).toHaveBeenCalledWith("set_account_map", {
      p_target: "qbo",
      p_entry_kind: "revenue",
      p_match_key: "green_sale",
      p_account_code: "4000",
      p_account_name: "Coffee sales",
    });
  });
});

describe("retrySyncAction — the $0 mock worker drain", () => {
  it("claims then stamps each row with a fake external id (a CUFE for dgi_pac)", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "claim_sync_batch") {
        return Promise.resolve({
          data: [
            { id: 5, target: "dgi_pac", entity_kind: "ar_doc", entity_ref: "JC-CI-0001" },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: 5, error: null });
    });
    const result = await retrySyncAction({ target: "dgi_pac" });
    expect(result).toEqual({ ok: true, processed: 1 });
    expect(rpcMock).toHaveBeenCalledWith("claim_sync_batch", {
      p_target: "dgi_pac",
      p_limit: 25,
    });
    expect(rpcMock).toHaveBeenCalledWith("mark_sync_result", {
      p_outbox_id: 5,
      p_success: true,
      p_external_id: "CUFE-MOCK-5",
      p_error: null,
    });
  });

  it("rejects a missing target WITHOUT touching the database", async () => {
    const result = await retrySyncAction({ target: "" });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
