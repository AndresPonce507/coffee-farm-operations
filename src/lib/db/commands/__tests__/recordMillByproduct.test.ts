import { describe, expect, it, vi } from "vitest";

import {
  friendlyRecordMillByproductError,
  recordMillByproduct,
  validateRecordMillByproduct,
  type RecordMillByproductStore,
} from "@/lib/db/commands/recordMillByproduct";

/**
 * Pure-domain command test for the dry-milling byproduct writer (P3-S8). Each
 * byproduct stream (husk/chaff/screen-rejects/defects) is minted as its OWN
 * sellable `lots` node + a conserved `kind='byproduct'` lot_edge, so the SHIPPED
 * `lot_edges_conserve_mass()` trigger guards it for free (the mass guarantee is
 * REUSED, never re-implemented — §1.4). The single write door is the SECURITY
 * DEFINER `record_mill_byproduct`, which RETURNS the minted byproduct lot code.
 *
 * Drives the command against a fake `.rpc('record_mill_byproduct', …)` store (no
 * database) and proves the friendly-validation seam (the byproduct_kind enum, the
 * kg > 0 CHECK), the exact snake_case envelope, and that the data-layer guards
 * (mass conservation, a closed run, an unknown run) surface CLEAN, family-readable
 * sentences. The migration's PGlite tests (s8_mill_passes.db.test.ts) pin the real
 * enforcement. Mirrors recordMillPass.test.ts / quoteCommodityPrice.test.ts.
 */

interface RpcResult {
  data: string | number | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: RecordMillByproductStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as RecordMillByproductStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  runId: "7",
  kind: "husk",
  kg: "50",
  idempotencyKey: "idem-byp-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateRecordMillByproduct", () => {
  it("accepts a complete, well-formed byproduct", () => {
    const r = validateRecordMillByproduct(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.runId).toBe(7);
      expect(r.data.kind).toBe("husk");
      expect(r.data.kg).toBe(50);
      expect(r.data.idempotencyKey).toBe("idem-byp-1");
    }
  });

  it("accepts every byproduct_kind enum value", () => {
    for (const k of ["husk", "chaff", "screen_rejects", "defects"]) {
      const r = validateRecordMillByproduct({ ...validRaw(), kind: k });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.kind).toBe(k);
    }
  });

  it("rejects an unknown byproduct kind (not in the enum)", () => {
    const r = validateRecordMillByproduct({ ...validRaw(), kind: "cascara" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.kind).toBeDefined();
  });

  it("rejects a non-positive kg (the kg > 0 CHECK)", () => {
    const zero = validateRecordMillByproduct({ ...validRaw(), kg: "0" });
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.errors.kg).toMatch(/greater than 0/i);

    const neg = validateRecordMillByproduct({ ...validRaw(), kg: "-1" });
    expect(neg.ok).toBe(false);
  });

  it("rejects a non-numeric kg", () => {
    const r = validateRecordMillByproduct({ ...validRaw(), kg: "lots" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.kg).toBeDefined();
  });

  it("rejects a non-positive run id", () => {
    const r = validateRecordMillByproduct({ ...validRaw(), runId: "0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.runId).toBeDefined();
  });

  it("rejects a missing idempotency key", () => {
    const r = validateRecordMillByproduct({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── friendly-error mapping ────────────────────────

describe("friendlyRecordMillByproductError", () => {
  it("maps the reused mass-conservation guard to a clean sentence", () => {
    const m = friendlyRecordMillByproductError({
      code: "23514",
      message:
        "mass conservation violated: routing 9000 kg out of lot JC-410 would exceed its 1000 kg (already routed 950)",
    });
    expect(m).toBeTruthy();
    expect(m).toMatch(/parchment|enough|mass|weight/i);
    expect(m).not.toMatch(/mass conservation violated/);
  });

  it("maps a closed run to a 'no longer open' sentence", () => {
    const m = friendlyRecordMillByproductError({
      message:
        "milling run 7 is finalized — byproducts can only be recorded while open",
    });
    expect(m).toBeTruthy();
    expect(m).toMatch(/open|closed|finalized/i);
  });

  it("maps an unknown run to a 'couldn't be found' sentence", () => {
    const m = friendlyRecordMillByproductError({
      code: "foreign_key_violation",
      message: "unknown milling run 999",
    });
    expect(m).toBeTruthy();
    expect(m).toMatch(/found|run/i);
  });

  it("returns null for an unrecognised error", () => {
    expect(
      friendlyRecordMillByproductError({ message: "deadlock detected" }),
    ).toBeNull();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("recordMillByproduct", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await recordMillByproduct(store, { ...validRaw(), kind: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.kind).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls record_mill_byproduct with the exact snake_case envelope and returns the minted lot code", async () => {
    const { store, rpc } = fakeStore({ data: "JC-742", error: null });
    const result = await recordMillByproduct(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_mill_byproduct", {
      p_run_id: 7,
      p_kind: "husk",
      p_kg: 50,
      p_idempotency_key: "idem-byp-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.byproductLotCode).toBe("JC-742");
  });

  it("surfaces the mass-conservation guard as a friendly message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        code: "23514",
        message:
          "mass conservation violated: routing 9000 kg out of lot JC-410 would exceed its 1000 kg (already routed 950)",
      },
    });
    const result = await recordMillByproduct(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/parchment|enough|mass|weight/i);
      expect(result.message).not.toMatch(/mass conservation violated/);
    }
  });

  it("surfaces a closed run as a friendly message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        message:
          "milling run 7 is finalized — byproducts can only be recorded while open",
      },
    });
    const result = await recordMillByproduct(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/open|closed|finalized/i);
  });

  it("falls back to a labelled message for an unrecognised RPC failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "deadlock detected" },
    });
    const result = await recordMillByproduct(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });

  it("surfaces a labelled error when the RPC returns no lot code", async () => {
    const { store } = fakeStore({ data: null, error: null });
    const result = await recordMillByproduct(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });
});
