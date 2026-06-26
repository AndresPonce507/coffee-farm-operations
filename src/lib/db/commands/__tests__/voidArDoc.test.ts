import { describe, expect, it, vi } from "vitest";

import {
  validateVoidArDoc,
  voidArDoc,
  type VoidArDocStore,
} from "@/lib/db/commands/voidArDoc";

/**
 * Pure-domain command test for voiding an AR doc (P3-S17 — `void_ar_doc`). Voiding
 * REVERSES the doc's revenue with negative rows (never a delete — the append-only
 * correction path) and enqueues a void sync per target. A doc that already has
 * payments CANNOT be voided (issue a credit note instead) — the RPC fails closed.
 * Drives the command against a fake `.rpc('void_ar_doc', …)` store and proves the
 * validation seam, the exact snake_case envelope, and the fail-closed surfaces:
 *   - a doc WITH PAYMENTS (must use a credit note),
 *   - an unknown doc.
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: VoidArDocStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as VoidArDocStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  arDocId: "42",
  reason: "Duplicate of JC-CI-0007",
  idempotencyKey: "idem-void-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateVoidArDoc", () => {
  it("accepts a complete, well-formed void", () => {
    const r = validateVoidArDoc(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.arDocId).toBe(42);
      expect(r.data.reason).toBe("Duplicate of JC-CI-0007");
      expect(r.data.idempotencyKey).toBe("idem-void-1");
    }
  });

  it("allows an omitted reason (null)", () => {
    const { reason: _r, ...rest } = validRaw();
    const r = validateVoidArDoc(rest);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.reason).toBeNull();
  });

  it("rejects a missing / non-positive ar_doc id", () => {
    const missing = validateVoidArDoc({ ...validRaw(), arDocId: "" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors.arDocId).toBeDefined();

    const frac = validateVoidArDoc({ ...validRaw(), arDocId: "1.5" });
    expect(frac.ok).toBe(false);
  });

  it("rejects a missing idempotency key", () => {
    const r = validateVoidArDoc({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("voidArDoc", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await voidArDoc(store, { ...validRaw(), arDocId: "" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls void_ar_doc with the exact snake_case envelope and returns the doc id", async () => {
    const { store, rpc } = fakeStore({ data: 42, error: null });
    const result = await voidArDoc(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("void_ar_doc", {
      p_ar_doc_id: 42,
      p_reason: "Duplicate of JC-CI-0007",
      p_idempotency_key: "idem-void-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.docId).toBe(42);
  });

  it("passes p_reason null when the reason is omitted", async () => {
    const { store, rpc } = fakeStore({ data: 7, error: null });
    const { reason: _r, ...rest } = validRaw();
    await voidArDoc(store, rest);
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_reason).toBeNull();
  });

  it("surfaces a doc WITH PAYMENTS as a friendly credit-note message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        code: "23514",
        message: "ar_doc 42 has payments — issue a credit note, do not void",
      },
    });
    const result = await voidArDoc(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/credit note|payment/i);
      expect(result.message).not.toMatch(/check_violation/);
    }
  });

  it("surfaces an unknown ar_doc as a friendly not-found message", async () => {
    const { store } = fakeStore({
      data: null,
      error: { code: "23503", message: "unknown ar_doc 999" },
    });
    const result = await voidArDoc(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/invoice|found/i);
  });

  it("falls back to a labelled message for an unrecognised RPC failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "deadlock detected" },
    });
    const result = await voidArDoc(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });
});
