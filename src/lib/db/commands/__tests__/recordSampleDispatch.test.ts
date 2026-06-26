import { describe, expect, it, vi } from "vitest";

import {
  friendlyRecordSampleDispatchError,
  recordSampleDispatch,
  validateRecordSampleDispatch,
  type RecordSampleDispatchStore,
} from "@/lib/db/commands/recordSampleDispatch";

/**
 * Pure-domain command test for the money-shaped sample-dispatch writer (P3-S18).
 * A B2B sample is real green LEAVING inventory, so `record_sample_dispatch` inserts
 * a `sample_dispatches` row inside the SECURITY DEFINER RPC — firing the EXTENDED
 * `prevent_oversell` (now a THREE-claim guard: reservations + shipments + samples)
 * and `_prevent_held_lot_commit`. The money guarantee is REUSED, not rebuilt: a free
 * sample can never silently consume inventory a paid buyer reserved. Drives the
 * command against a fake `.rpc('record_sample_dispatch', …)` store and proves the
 * validation seam, the exact snake_case envelope, and — the load-bearing cases —
 * that the fail-closed guards surface CLEAN, family-readable errors (oversell,
 * QC-hold). The triggers are the real enforcement (the migration's PGlite tests).
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: RecordSampleDispatchStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as RecordSampleDispatchStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  greenLotCode: "JC-701",
  contactId: "7",
  grams: "250",
  courier: "DHL",
  trackingNo: "DH-99",
  idempotencyKey: "idem-sample-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateRecordSampleDispatch", () => {
  it("accepts a complete, well-formed dispatch", () => {
    const r = validateRecordSampleDispatch(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.greenLotCode).toBe("JC-701");
      expect(r.data.contactId).toBe(7);
      expect(r.data.grams).toBe(250);
      expect(r.data.courier).toBe("DHL");
      expect(r.data.trackingNo).toBe("DH-99");
      expect(r.data.idempotencyKey).toBe("idem-sample-1");
    }
  });

  it("defaults blank courier/tracking to null", () => {
    const r = validateRecordSampleDispatch({
      ...validRaw(),
      courier: "",
      trackingNo: "",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.courier).toBeNull();
      expect(r.data.trackingNo).toBeNull();
    }
  });

  it("rejects a missing green lot code", () => {
    const r = validateRecordSampleDispatch({ ...validRaw(), greenLotCode: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.greenLotCode).toBeDefined();
  });

  it("rejects a missing / non-positive contact id", () => {
    const r = validateRecordSampleDispatch({ ...validRaw(), contactId: "0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.contactId).toBeDefined();
  });

  it("rejects non-positive grams (the grams > 0 CHECK)", () => {
    const zero = validateRecordSampleDispatch({ ...validRaw(), grams: "0" });
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.errors.grams).toMatch(/greater than 0/i);

    const neg = validateRecordSampleDispatch({ ...validRaw(), grams: "-5" });
    expect(neg.ok).toBe(false);
  });

  it("rejects non-numeric grams", () => {
    const r = validateRecordSampleDispatch({ ...validRaw(), grams: "a few" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.grams).toBeDefined();
  });

  it("rejects a missing idempotency key", () => {
    const r = validateRecordSampleDispatch({
      ...validRaw(),
      idempotencyKey: "",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── friendly error mapping ────────────────────────

describe("friendlyRecordSampleDispatchError", () => {
  it("maps an oversell rejection to a clean sentence", () => {
    const msg = friendlyRecordSampleDispatchError({
      message:
        "oversell guard: committing 250 kg to green lot JC-701 would exceed its available-to-promise",
    });
    expect(msg).toMatch(/available-to-promise/i);
    expect(msg).not.toMatch(/oversell guard:/);
  });

  it("maps a QC-hold rejection to a clean sentence", () => {
    const msg = friendlyRecordSampleDispatchError({
      message: "qc-hold: lot JC-701 has an open qc-hold and can't be committed",
    });
    expect(msg).toMatch(/hold/i);
    expect(msg).not.toMatch(/qc-hold:/);
  });

  it("maps an unknown contact/lot to a clean sentence", () => {
    const contact = friendlyRecordSampleDispatchError({
      message: "unknown contact 7 for tenant",
      code: "23503",
    });
    expect(contact).toBeTruthy();
    const lot = friendlyRecordSampleDispatchError({
      message: "unknown green lot JC-701 for tenant",
    });
    expect(lot).toBeTruthy();
  });

  it("returns null for an unrecognised error (caller falls back to generic)", () => {
    expect(
      friendlyRecordSampleDispatchError({ message: "some other failure" }),
    ).toBeNull();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("recordSampleDispatch", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await recordSampleDispatch(store, {
      ...validRaw(),
      grams: "0",
    });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls record_sample_dispatch with the exact snake_case envelope and returns the sample id", async () => {
    const { store, rpc } = fakeStore({ data: 5, error: null });
    const result = await recordSampleDispatch(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_sample_dispatch", {
      p_green_lot_code: "JC-701",
      p_contact_id: 7,
      p_grams: 250,
      p_courier: "DHL",
      p_tracking_no: "DH-99",
      p_idempotency_key: "idem-sample-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sampleId).toBe(5);
  });

  it("forwards null courier/tracking when blank", async () => {
    const { store, rpc } = fakeStore({ data: 6, error: null });
    await recordSampleDispatch(store, {
      ...validRaw(),
      courier: "",
      trackingNo: "",
    });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_courier).toBeNull();
    expect(args.p_tracking_no).toBeNull();
  });

  it("coerces a string id from PostgREST to a number", async () => {
    const { store } = fakeStore({ data: "9", error: null });
    const result = await recordSampleDispatch(store, validRaw());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sampleId).toBe(9);
  });

  it("surfaces a CLEAN oversell sentence (never raw PG) when the guard fires", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        message:
          "oversell guard: committing 250 kg to green lot JC-701 would exceed its available-to-promise",
      },
    });
    const result = await recordSampleDispatch(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/available-to-promise/i);
      expect(result.message).not.toMatch(/oversell guard:/);
    }
  });

  it("surfaces a generic labelled message for an unrecognised failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "connection reset" },
    });
    const result = await recordSampleDispatch(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });
});
