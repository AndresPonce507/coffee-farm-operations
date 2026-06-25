import { describe, expect, it, vi } from "vitest";

import {
  buildExportShipment,
  friendlyBuildExportShipmentError,
  validateBuildExportShipment,
  type BuildExportShipmentStore,
} from "@/lib/db/commands/buildExportShipment";

/**
 * Pure-domain command test for the export-shipment minter (P3-S3 — the headline
 * export-doc-pack slice; ADR-002 — every write flows through a SECURITY DEFINER
 * RPC). This file does NOT touch a database: it drives the command against a *fake
 * store* stubbing the one method it calls, `.rpc('build_export_shipment', …)`, and
 * proves (a) the friendly-validation seam (a contract is required; an optional
 * port/bag-weight forward null so the RPC defaults 'Balboa, PA' / 30 kg; a supplied
 * bag weight must be > 0), (b) the exact snake_case argument envelope, and (c) that
 * a DB failure surfaces a clean labelled message, never raw Postgres. The shipment_no
 * minting + tenant clamp are the RPC's job (proven by the migration's PGlite tests).
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: BuildExportShipmentStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as BuildExportShipmentStore, rpc };
}

/** A complete, valid raw build request — the happy-path baseline each case tweaks. */
const validRaw = (): Record<string, unknown> => ({
  contractId: "3",
  portOfLoading: "Balboa, PA",
  bagWeightKg: "30",
  idempotencyKey: "idem-ship-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateBuildExportShipment", () => {
  it("accepts a complete, well-formed build request", () => {
    const r = validateBuildExportShipment(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.contractId).toBe(3);
      expect(r.data.portOfLoading).toBe("Balboa, PA");
      expect(r.data.bagWeightKg).toBe(30);
      expect(r.data.idempotencyKey).toBe("idem-ship-1");
    }
  });

  it("forwards a null port_of_loading when blank (RPC defaults 'Balboa, PA')", () => {
    const r = validateBuildExportShipment({ ...validRaw(), portOfLoading: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.portOfLoading).toBeNull();
  });

  it("forwards a null bag_weight when blank (RPC defaults 30 kg)", () => {
    const r = validateBuildExportShipment({ ...validRaw(), bagWeightKg: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.bagWeightKg).toBeNull();
  });

  it("rejects a missing / non-positive contract id", () => {
    const missing = validateBuildExportShipment({ ...validRaw(), contractId: "" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors.contractId).toBeDefined();

    const zero = validateBuildExportShipment({ ...validRaw(), contractId: "0" });
    expect(zero.ok).toBe(false);
  });

  it("rejects a supplied non-positive bag weight (the bag_weight_kg > 0 CHECK)", () => {
    const zero = validateBuildExportShipment({ ...validRaw(), bagWeightKg: "0" });
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.errors.bagWeightKg).toMatch(/greater than 0/i);

    const neg = validateBuildExportShipment({ ...validRaw(), bagWeightKg: "-5" });
    expect(neg.ok).toBe(false);
  });

  it("rejects a missing idempotency key", () => {
    const r = validateBuildExportShipment({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── friendly errors ───────────────────────────────

describe("friendlyBuildExportShipmentError", () => {
  it("maps an unknown contract / foreign-key violation to plain English", () => {
    expect(
      friendlyBuildExportShipmentError({
        message: "unknown contract 99 for tenant",
        code: "23503",
      }),
    ).toMatch(/contract/i);
  });

  it("returns null for an unrecognised error (caller falls back to generic)", () => {
    expect(
      friendlyBuildExportShipmentError({ message: "some other failure" }),
    ).toBeNull();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("buildExportShipment", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await buildExportShipment(store, {
      ...validRaw(),
      contractId: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.contractId).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls build_export_shipment with the exact snake_case envelope and returns the shipment id", async () => {
    const { store, rpc } = fakeStore({ data: 10, error: null });
    const result = await buildExportShipment(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("build_export_shipment", {
      p_contract_id: 3,
      p_port_of_loading: "Balboa, PA",
      p_bag_weight_kg: 30,
      p_idempotency_key: "idem-ship-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.shipmentId).toBe(10);
  });

  it("forwards null port/bag-weight when blank (RPC applies its defaults)", async () => {
    const { store, rpc } = fakeStore({ data: 11, error: null });
    await buildExportShipment(store, {
      ...validRaw(),
      portOfLoading: "",
      bagWeightKg: "",
    });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_port_of_loading).toBeNull();
    expect(args.p_bag_weight_kg).toBeNull();
  });

  it("coerces a string id from PostgREST to a number", async () => {
    const { store } = fakeStore({ data: "12", error: null });
    const result = await buildExportShipment(store, validRaw());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.shipmentId).toBe(12);
  });

  it("surfaces a clean labelled error for an unknown contract (never raw PG)", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "unknown contract 99 for tenant", code: "23503" },
    });
    const result = await buildExportShipment(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/contract/i);
      expect(result.message).not.toMatch(/tenant/);
    }
  });

  it("surfaces a generic labelled message for an unrecognised failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "deadlock detected" },
    });
    const result = await buildExportShipment(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });
});
