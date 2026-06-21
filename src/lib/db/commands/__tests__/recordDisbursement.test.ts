import { describe, expect, it, vi } from "vitest";

import {
  DISBURSEMENT_METHODS,
  recordDisbursement,
  recordDisbursementRpcArgs,
  validateRecordDisbursement,
  type RecordDisbursementStore,
} from "@/lib/db/commands/recordDisbursement";

/**
 * Pure-domain command test for the record-disbursement write (P2-S7 — THE
 * PEOPLE-TRUNK CAPSTONE, ADR-002: every write flows through a SECURITY DEFINER command
 * RPC). RECORD-ONLY — no real payment API (DESIGN §4.3, dormant). This file does NOT
 * touch a database: it drives the command against a *fake store* (a stub of the one
 * method the command calls, `.rpc('record_disbursement', …)`) so it proves the
 * friendly-validation seam (incl. the cash-signed-needs-signature rule) + the exact
 * snake_case envelope in the fast loop. The SQL CHECK/raise (amount >= 0, the
 * line-must-be-approved gate, exactly-once) is the *real* enforcement.
 */

/** Build a fake RecordDisbursementStore whose `.rpc()` resolves to a fixed result. */
function fakeStore(result: {
  data: number | null;
  error: { message: string } | null;
}): { store: RecordDisbursementStore; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as RecordDisbursementStore, rpc };
}

/** A complete, valid raw disbursement — the happy-path baseline each case tweaks. */
const validRaw = (): Record<string, unknown> => ({
  payPeriodId: "pp-2026-06-w3",
  workerId: "w-lucia",
  amountUsd: "84.50",
  method: "yappy",
  ref: "yappy-tx-99812",
  idempotencyKey: "disb-2026-06-21-w-lucia-001",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateRecordDisbursement", () => {
  it("accepts a complete, well-formed disbursement (coercing the amount)", () => {
    const r = validateRecordDisbursement(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.payPeriodId).toBe("pp-2026-06-w3");
      expect(r.data.workerId).toBe("w-lucia");
      expect(r.data.amountUsd).toBe(84.5);
      expect(r.data.method).toBe("yappy");
      expect(r.data.ref).toBe("yappy-tx-99812");
      expect(r.data.signatureRef).toBeNull();
      expect(r.data.idempotencyKey).toBe("disb-2026-06-21-w-lucia-001");
    }
  });

  it("exposes the recognised methods as a tuple", () => {
    expect(DISBURSEMENT_METHODS).toEqual(["yappy", "nequi", "ach", "cash-signed"]);
  });

  it("errors when the pay period or worker is blank", () => {
    const a = validateRecordDisbursement({ ...validRaw(), payPeriodId: " " });
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.errors.payPeriodId).toBeTruthy();
    const b = validateRecordDisbursement({ ...validRaw(), workerId: "" });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.errors.workerId).toBeTruthy();
  });

  it("rejects a negative or non-numeric amount", () => {
    const neg = validateRecordDisbursement({ ...validRaw(), amountUsd: "-5" });
    expect(neg.ok).toBe(false);
    if (!neg.ok) expect(neg.errors.amountUsd).toBeTruthy();
    const nan = validateRecordDisbursement({ ...validRaw(), amountUsd: "lots" });
    expect(nan.ok).toBe(false);
  });

  it("requires a recognised method", () => {
    const r = validateRecordDisbursement({ ...validRaw(), method: "bitcoin" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.method).toBeTruthy();
  });

  it("treats a missing ref as null (it is optional)", () => {
    const raw = validRaw();
    delete raw.ref;
    const r = validateRecordDisbursement(raw);
    expect(r.ok && r.data.ref).toBeNull();
  });

  it("requires a signature reference for a cash-signed payment", () => {
    const r = validateRecordDisbursement({
      ...validRaw(),
      method: "cash-signed",
      // no signatureRef
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.signatureRef).toMatch(/signature/i);
  });

  it("accepts a cash-signed payment that carries a signature reference", () => {
    const r = validateRecordDisbursement({
      ...validRaw(),
      method: "cash-signed",
      signatureRef: "sig-blob-7711",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.method).toBe("cash-signed");
      expect(r.data.signatureRef).toBe("sig-blob-7711");
    }
  });

  it("errors when the idempotency key is blank", () => {
    const r = validateRecordDisbursement({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeTruthy();
  });
});

// ─────────────────────────── envelope + command ────────────────────────────

describe("recordDisbursementRpcArgs", () => {
  it("maps the validated input to the exact snake_case RPC envelope", () => {
    const v = validateRecordDisbursement(validRaw());
    if (!v.ok) throw new Error("fixture should validate");
    expect(recordDisbursementRpcArgs(v.data)).toEqual({
      p_pay_period_id: "pp-2026-06-w3",
      p_worker_id: "w-lucia",
      p_amount_usd: 84.5,
      p_method: "yappy",
      p_ref: "yappy-tx-99812",
      p_signature_ref: null,
      p_idempotency_key: "disb-2026-06-21-w-lucia-001",
    });
  });
});

describe("recordDisbursement", () => {
  it("calls record_disbursement once and returns the disbursement id", async () => {
    const { store, rpc } = fakeStore({ data: 5012, error: null });
    const res = await recordDisbursement(store, validRaw());
    expect(res).toEqual({ ok: true, disbursementId: 5012 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "record_disbursement",
      expect.objectContaining({ p_worker_id: "w-lucia", p_amount_usd: 84.5 }),
    );
  });

  it("never reaches the RPC on invalid input (cash-signed without a signature)", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const res = await recordDisbursement(store, {
      ...validRaw(),
      method: "cash-signed",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors?.signatureRef).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces an RPC error labelled (e.g. the line-not-approved gate)", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "pay line for worker w-lucia in period pp-2026-06-w3 is not approved (status calculated)" },
    });
    const res = await recordDisbursement(store, validRaw());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/is not approved/);
  });

  it("the same idempotency key flows through unchanged (exactly-once anchor)", async () => {
    const { store, rpc } = fakeStore({ data: 5012, error: null });
    await recordDisbursement(store, validRaw());
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_idempotency_key).toBe("disb-2026-06-21-w-lucia-001");
  });
});
