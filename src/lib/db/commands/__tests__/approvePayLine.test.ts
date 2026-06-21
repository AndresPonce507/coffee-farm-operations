import { describe, expect, it, vi } from "vitest";

import {
  approvePayLine,
  approvePayLineRpcArgs,
  validateApprovePayLine,
  type ApprovePayLineStore,
} from "@/lib/db/commands/approvePayLine";

/**
 * Pure-domain command test for the approve-pay-line write (P2-S7 — THE PEOPLE-TRUNK
 * CAPSTONE, ADR-002: every write flows through a SECURITY DEFINER command RPC). This
 * file does NOT touch a database: it drives the command against a *fake store* (a stub
 * of the one method the command calls, `.rpc('approve_pay_line', …)`) so it proves the
 * friendly-validation seam + the exact snake_case envelope in the fast loop. The SQL
 * raise (unknown line / wrong status, policed by the append-only block trigger) is the
 * *real* enforcement; this pins the friendly error the owner sees before the round-trip.
 */

/** Build a fake ApprovePayLineStore whose `.rpc()` resolves to a fixed result. */
function fakeStore(result: {
  data: number | null;
  error: { message: string } | null;
}): { store: ApprovePayLineStore; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as ApprovePayLineStore, rpc };
}

/** A complete, valid raw approve-pay-line — the happy-path baseline each case tweaks. */
const validRaw = (): Record<string, unknown> => ({ payLineId: "42" });

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateApprovePayLine", () => {
  it("accepts a positive integer pay line id (coercing the string)", () => {
    const r = validateApprovePayLine(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.payLineId).toBe(42);
  });

  it("rejects a missing, zero, negative, or non-integer id", () => {
    for (const bad of ["", "0", "-3", "4.5", "abc"]) {
      const r = validateApprovePayLine({ payLineId: bad });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.payLineId).toBeTruthy();
    }
  });
});

// ─────────────────────────── envelope + command ────────────────────────────

describe("approvePayLineRpcArgs", () => {
  it("maps the validated input to the exact snake_case RPC envelope", () => {
    const v = validateApprovePayLine(validRaw());
    if (!v.ok) throw new Error("fixture should validate");
    expect(approvePayLineRpcArgs(v.data)).toEqual({ p_pay_line_id: 42 });
  });
});

describe("approvePayLine", () => {
  it("calls approve_pay_line once and returns the approved line id", async () => {
    const { store, rpc } = fakeStore({ data: 42, error: null });
    const res = await approvePayLine(store, validRaw());
    expect(res).toEqual({ ok: true, payLineId: 42 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("approve_pay_line", { p_pay_line_id: 42 });
  });

  it("never reaches the RPC on invalid input (friendly errors only)", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const res = await approvePayLine(store, { payLineId: "-1" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors?.payLineId).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces an RPC error labelled (e.g. wrong status)", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "pay_line 42 cannot be approved from status reversed" },
    });
    const res = await approvePayLine(store, validRaw());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/cannot be approved from status/);
  });
});
