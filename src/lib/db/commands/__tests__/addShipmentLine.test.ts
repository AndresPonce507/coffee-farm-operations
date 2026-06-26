import { describe, expect, it, vi } from "vitest";

import {
  addShipmentLine,
  friendlyAddShipmentLineError,
  validateAddShipmentLine,
  type AddShipmentLineStore,
} from "@/lib/db/commands/addShipmentLine";

/**
 * Pure-domain command test for the export shipment-line loader (P3-S3; ADR-002 —
 * every write flows through a SECURITY DEFINER RPC). Loading a line ALSO inserts a
 * `lot_shipments` claim (net_kg = bags × bag_weight) so the EXISTING prevent_oversell
 * trigger guards physical over-shipment — no parallel counter. This file does NOT
 * touch a database: it drives the command against a *fake store* stubbing
 * `.rpc('add_shipment_line', …)`, and proves (a) bags must be a WHOLE number > 0 (the
 * integer column + `bags > 0` CHECK), (b) the exact snake_case envelope, and (c) that
 * the data-layer guards (oversell, qc-hold, status-not-building, wrong-contract line)
 * surface as CLEAN, family-readable sentences, never raw Postgres. The claim insert +
 * tenant clamp are the RPC's job (proven by the migration's PGlite tests).
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: AddShipmentLineStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as AddShipmentLineStore, rpc };
}

/** A complete, valid raw load request — the happy-path baseline each case tweaks. */
const validRaw = (): Record<string, unknown> => ({
  shipmentId: "10",
  contractLineId: "7",
  bags: "8",
  idempotencyKey: "idem-line-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateAddShipmentLine", () => {
  it("accepts a complete, well-formed load request", () => {
    const r = validateAddShipmentLine(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.shipmentId).toBe(10);
      expect(r.data.contractLineId).toBe(7);
      expect(r.data.bags).toBe(8);
      expect(r.data.idempotencyKey).toBe("idem-line-1");
    }
  });

  it("rejects a missing / non-positive shipment id", () => {
    const missing = validateAddShipmentLine({ ...validRaw(), shipmentId: "" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors.shipmentId).toBeDefined();

    const zero = validateAddShipmentLine({ ...validRaw(), shipmentId: "0" });
    expect(zero.ok).toBe(false);
  });

  it("rejects a missing / non-positive contract line id", () => {
    const r = validateAddShipmentLine({ ...validRaw(), contractLineId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.contractLineId).toBeDefined();
  });

  it("rejects a non-positive bag count (the bags > 0 CHECK)", () => {
    const zero = validateAddShipmentLine({ ...validRaw(), bags: "0" });
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.errors.bags).toMatch(/greater than 0|whole number/i);

    const neg = validateAddShipmentLine({ ...validRaw(), bags: "-3" });
    expect(neg.ok).toBe(false);
  });

  it("rejects a fractional bag count (bags is an integer column)", () => {
    const r = validateAddShipmentLine({ ...validRaw(), bags: "8.5" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.bags).toMatch(/whole number/i);
  });

  it("rejects a missing idempotency key", () => {
    const r = validateAddShipmentLine({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── friendly errors ───────────────────────────────

describe("friendlyAddShipmentLineError", () => {
  it("maps the prevent_oversell guard to a plain over-shipment sentence", () => {
    const msg = friendlyAddShipmentLineError({
      message:
        "oversell guard: committing 240 kg to green lot JC-204 would exceed its 200 kg available-to-promise (60 already committed)",
      code: "23514",
    });
    expect(msg).toMatch(/enough|available|reduce/i);
    expect(msg).not.toMatch(/oversell guard/i);
  });

  it("maps an open QC-hold to a hold sentence", () => {
    const msg = friendlyAddShipmentLineError({
      message:
        "qc-hold: green lot JC-204 is under an open QC-HOLD and cannot be reserved or shipped",
      code: "23514",
    });
    expect(msg).toMatch(/hold/i);
  });

  it("maps a non-building shipment status to a plain locked sentence", () => {
    const msg = friendlyAddShipmentLineError({
      message:
        "shipment JC-S-0001 is docs_issued — cannot load more lines (must be building)",
      code: "23514",
    });
    expect(msg).toMatch(/already|can('|no)t|building/i);
  });

  it("maps a wrong-contract line to a plain sentence", () => {
    const msg = friendlyAddShipmentLineError({
      message:
        "contract line 7 does not belong to shipment JC-S-0001's contract — cannot load a lot it did not reserve",
      code: "23514",
    });
    expect(msg).toMatch(/line|contract|shipment/i);
  });

  it("returns null for an unrecognised error (caller falls back to generic)", () => {
    expect(
      friendlyAddShipmentLineError({ message: "some other failure" }),
    ).toBeNull();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("addShipmentLine", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await addShipmentLine(store, { ...validRaw(), bags: "0" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.bags).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls add_shipment_line with the exact snake_case envelope and returns the line id", async () => {
    const { store, rpc } = fakeStore({ data: 21, error: null });
    const result = await addShipmentLine(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("add_shipment_line", {
      p_shipment_id: 10,
      p_contract_line_id: 7,
      p_bags: 8,
      p_idempotency_key: "idem-line-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lineId).toBe(21);
  });

  it("coerces a string id from PostgREST to a number", async () => {
    const { store } = fakeStore({ data: "22", error: null });
    const result = await addShipmentLine(store, validRaw());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lineId).toBe(22);
  });

  it("surfaces a clean over-shipment sentence (never raw PG) when prevent_oversell fires", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        message:
          "oversell guard: committing 240 kg to green lot JC-204 would exceed its 200 kg available-to-promise",
        code: "23514",
      },
    });
    const result = await addShipmentLine(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/enough|available|reduce/i);
      expect(result.message).not.toMatch(/oversell guard/i);
    }
  });

  it("surfaces a generic labelled message for an unrecognised failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "deadlock detected" },
    });
    const result = await addShipmentLine(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });
});
