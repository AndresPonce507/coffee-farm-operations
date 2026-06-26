import { describe, expect, it, vi } from "vitest";

import {
  issueArDoc,
  validateIssueArDoc,
  type IssueArDocStore,
} from "@/lib/db/commands/issueArDoc";

/**
 * Pure-domain command test for issuing an AR doc (P3-S17 — `issue_ar_doc`). Issuing
 * an invoice COMMITS each line's kg by writing a `lot_shipments` row INSIDE the
 * SECURITY DEFINER RPC, so the EXISTING `prevent_oversell` (+ QC-hold) trigger fires
 * — the money guarantee is REUSED, not rebuilt: invoicing 31 kg of a 30 kg lot fails
 * closed and rolls back the whole doc. Drives the command against a fake
 * `.rpc('issue_ar_doc', …)` store and proves the friendly-validation seam, the exact
 * snake_case argument envelope (lines serialized to snake_case jsonb), and the
 * load-bearing fail-closed surfaces:
 *   - OVERSELL (the reused money guarantee),
 *   - the EXPORT GATE (a commercial_invoice with no contract + Incoterm),
 *   - an OFF-BOOK FX rate (the doc currency has no on-book rate),
 *   - a QC-held lot.
 * The triggers/RPC are the real enforcement (the migration's PGlite tests).
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: IssueArDocStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as IssueArDocStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  kind: "commercial_invoice",
  currency: "USD",
  lines: [
    {
      greenLotCode: "JC-701",
      description: "Geisha washed, 88.5",
      kg: "30",
      unitPriceDoc: "450",
      amountDoc: "13500",
      sourceKind: "green_sale",
    },
  ],
  buyerRef: "onyx",
  contractRef: "SC-2026-12",
  incoterm: "FOB",
  targets: ["qbo"],
  idempotencyKey: "idem-issue-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateIssueArDoc", () => {
  it("accepts a complete, well-formed commercial invoice", () => {
    const r = validateIssueArDoc(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.kind).toBe("commercial_invoice");
      expect(r.data.currency).toBe("USD");
      expect(r.data.lines).toHaveLength(1);
      expect(r.data.lines[0].amountDoc).toBe(13500);
      expect(r.data.lines[0].greenLotCode).toBe("JC-701");
      expect(r.data.targets).toEqual(["qbo"]);
      expect(r.data.idempotencyKey).toBe("idem-issue-1");
    }
  });

  it("defaults currency to USD and targets to ['qbo'] when omitted", () => {
    const { currency: _c, targets: _t, ...rest } = validRaw();
    const r = validateIssueArDoc(rest);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.currency).toBe("USD");
      expect(r.data.targets).toEqual(["qbo"]);
    }
  });

  it("rejects an unknown doc kind", () => {
    const r = validateIssueArDoc({ ...validRaw(), kind: "made_up" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.kind).toBeDefined();
  });

  it("rejects an empty / missing lines array", () => {
    const empty = validateIssueArDoc({ ...validRaw(), lines: [] });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.errors.lines).toBeDefined();

    const missing = validateIssueArDoc({ ...validRaw(), lines: undefined });
    expect(missing.ok).toBe(false);
  });

  it("rejects a line whose amount is missing / negative", () => {
    const r = validateIssueArDoc({
      ...validRaw(),
      lines: [{ description: "x", amountDoc: "-5" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.lines).toBeDefined();
  });

  it("rejects a line with a negative kg", () => {
    const r = validateIssueArDoc({
      ...validRaw(),
      lines: [{ description: "x", amountDoc: "10", kg: "-1" }],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects an unknown sync target", () => {
    const r = validateIssueArDoc({ ...validRaw(), targets: ["qbo", "sap"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.targets).toBeDefined();
  });

  it("rejects a missing idempotency key", () => {
    const r = validateIssueArDoc({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("issueArDoc", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await issueArDoc(store, { ...validRaw(), lines: [] });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls issue_ar_doc with the exact snake_case envelope (lines serialized to snake_case)", async () => {
    const { store, rpc } = fakeStore({ data: 42, error: null });
    const result = await issueArDoc(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("issue_ar_doc", {
      p_kind: "commercial_invoice",
      p_currency: "USD",
      p_lines: [
        {
          green_lot_code: "JC-701",
          description: "Geisha washed, 88.5",
          kg: 30,
          unit_price_doc: 450,
          amount_doc: 13500,
          source_kind: "green_sale",
        },
      ],
      p_buyer_ref: "onyx",
      p_contract_ref: "SC-2026-12",
      p_incoterm: "FOB",
      p_targets: ["qbo"],
      p_idempotency_key: "idem-issue-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.docId).toBe(42);
  });

  it("passes null for an omitted green_lot_code / buyer_ref / contract_ref / incoterm", async () => {
    const { store, rpc } = fakeStore({ data: 7, error: null });
    await issueArDoc(store, {
      kind: "proforma",
      lines: [{ description: "Deposit", amountDoc: "100" }],
      idempotencyKey: "idem-pf-1",
    });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_buyer_ref).toBeNull();
    expect(args.p_contract_ref).toBeNull();
    expect(args.p_incoterm).toBeNull();
    const lines = args.p_lines as Array<Record<string, unknown>>;
    expect(lines[0].green_lot_code).toBeNull();
    expect(lines[0].source_kind).toBeNull();
  });

  it("surfaces the OVERSELL guard (reused money guarantee) as a friendly availability message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        code: "23514",
        message:
          "oversell guard: committing 31 kg to green lot JC-701 would exceed its 30 kg available-to-promise",
      },
    });
    const result = await issueArDoc(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/available|enough|oversell|exceed/i);
      expect(result.message).not.toMatch(/oversell guard:|check_violation/);
    }
  });

  it("surfaces the EXPORT GATE (missing contract + Incoterm) as a friendly message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        code: "23514",
        message:
          "export gate: a commercial_invoice requires a contract reference and an Incoterm",
      },
    });
    const result = await issueArDoc(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/contract|incoterm|export/i);
      expect(result.message).not.toMatch(/export gate:|check_violation/);
    }
  });

  it("surfaces an OFF-BOOK FX rate as a friendly record-the-rate message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        code: "23503",
        message: "off-book FX: no fx_rate for EUR→USD on the books; record the rate first",
      },
    });
    const result = await issueArDoc(store, { ...validRaw(), currency: "EUR" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/exchange rate|fx|rate/i);
      expect(result.message).not.toMatch(/off-book FX:/);
    }
  });

  it("surfaces a QC-held lot as a friendly quarantine message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        code: "23514",
        message:
          "qc-hold: green lot JC-701 is under an open QC-HOLD and cannot be reserved or shipped",
      },
    });
    const result = await issueArDoc(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/hold|quarantin/i);
  });

  it("falls back to a labelled message for an unrecognised RPC failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "deadlock detected" },
    });
    const result = await issueArDoc(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });

  it("returns a labelled message when the RPC yields a null doc id", async () => {
    const { store } = fakeStore({ data: null, error: null });
    const result = await issueArDoc(store, validRaw());
    expect(result.ok).toBe(false);
  });
});
