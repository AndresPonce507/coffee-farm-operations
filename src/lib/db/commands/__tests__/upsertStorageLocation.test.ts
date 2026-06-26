import { describe, expect, it, vi } from "vitest";

import {
  upsertStorageLocation,
  validateUpsertStorageLocation,
  type UpsertStorageLocationStore,
} from "@/lib/db/commands/upsertStorageLocation";

/**
 * Pure-domain command test for the ONLY `storage_locations` writer (P3-S20 — the
 * controlled-environment config; ADR-002 — every write flows through a SECURITY
 * DEFINER RPC). Drives the command against a fake `.rpc('upsert_storage_location', …)`
 * store and proves: (a) the friendly-validation seam (code/name/idempotency required;
 * the band-ordering + aw ∈ (0,1] CHECKs mirrored), (b) the exact snake_case argument
 * envelope (blank numerics pass as null so the RPC keeps the safe defaults), and
 * (c) a DB failure surfaces a clean labelled message. The tenant clamp + the
 * idempotent upsert are the real enforcement (the migration's PGlite tests).
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: UpsertStorageLocationStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as UpsertStorageLocationStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  code: "BODEGA-A",
  name: "Bodega A",
  tempMinC: "15",
  tempMaxC: "25",
  rhMinPct: "50",
  rhMaxPct: "65",
  awMax: "0.65",
  idempotencyKey: "idem-loc-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateUpsertStorageLocation", () => {
  it("accepts a complete, well-formed location", () => {
    const r = validateUpsertStorageLocation(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.code).toBe("BODEGA-A");
      expect(r.data.name).toBe("Bodega A");
      expect(r.data.tempMinC).toBe(15);
      expect(r.data.awMax).toBe(0.65);
      expect(r.data.idempotencyKey).toBe("idem-loc-1");
    }
  });

  it("treats blank bands as 'not provided' (null → the RPC keeps the defaults)", () => {
    const r = validateUpsertStorageLocation({
      code: "BODEGA-A",
      name: "Bodega A",
      tempMinC: "",
      tempMaxC: "",
      rhMinPct: "",
      rhMaxPct: "",
      awMax: "",
      idempotencyKey: "idem-loc-1",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.tempMinC).toBeNull();
      expect(r.data.tempMaxC).toBeNull();
      expect(r.data.rhMinPct).toBeNull();
      expect(r.data.rhMaxPct).toBeNull();
      expect(r.data.awMax).toBeNull();
    }
  });

  it("rejects a missing code", () => {
    const r = validateUpsertStorageLocation({ ...validRaw(), code: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.code).toBeDefined();
  });

  it("rejects a missing name", () => {
    const r = validateUpsertStorageLocation({ ...validRaw(), name: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.name).toBeDefined();
  });

  it("rejects an inverted temp band (mirrors the band CHECK)", () => {
    const r = validateUpsertStorageLocation({
      ...validRaw(),
      tempMinC: "30",
      tempMaxC: "20",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.tempMaxC ?? r.errors.tempMinC).toBeDefined();
  });

  it("rejects an inverted RH band", () => {
    const r = validateUpsertStorageLocation({
      ...validRaw(),
      rhMinPct: "70",
      rhMaxPct: "60",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects an aw_max outside (0, 1] (mirrors the aw CHECK)", () => {
    const tooHigh = validateUpsertStorageLocation({ ...validRaw(), awMax: "1.5" });
    expect(tooHigh.ok).toBe(false);

    const zero = validateUpsertStorageLocation({ ...validRaw(), awMax: "0" });
    expect(zero.ok).toBe(false);
  });

  it("rejects a missing idempotency key", () => {
    const r = validateUpsertStorageLocation({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("upsertStorageLocation", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await upsertStorageLocation(store, { ...validRaw(), code: "" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls upsert_storage_location with the exact snake_case envelope and returns the id", async () => {
    const { store, rpc } = fakeStore({ data: 3, error: null });
    const result = await upsertStorageLocation(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("upsert_storage_location", {
      p_code: "BODEGA-A",
      p_name: "Bodega A",
      p_temp_min_c: 15,
      p_temp_max_c: 25,
      p_rh_min_pct: 50,
      p_rh_max_pct: 65,
      p_aw_max: 0.65,
      p_idempotency_key: "idem-loc-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.locationId).toBe(3);
  });

  it("forwards null bands when blank (the RPC keeps the safe defaults)", async () => {
    const { store, rpc } = fakeStore({ data: 4, error: null });
    await upsertStorageLocation(store, {
      code: "BODEGA-A",
      name: "Bodega A",
      idempotencyKey: "idem-loc-1",
    });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_temp_min_c).toBeNull();
    expect(args.p_aw_max).toBeNull();
  });

  it("coerces a string id from PostgREST to a number", async () => {
    const { store } = fakeStore({ data: "5", error: null });
    const result = await upsertStorageLocation(store, validRaw());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.locationId).toBe(5);
  });

  it("surfaces a labelled error when the RPC fails", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "permission denied for table storage_locations" },
    });
    const result = await upsertStorageLocation(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });
});
