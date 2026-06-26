import { describe, expect, it, vi } from "vitest";

import {
  finalizeRoastBatch,
  validateFinalizeRoastBatch,
  friendlyFinalizeRoastBatchError,
  type FinalizeRoastBatchStore,
} from "@/lib/db/commands/finalizeRoastBatch";

/**
 * Pure-domain command test for the roast FINALIZE keystone (P3-S10 — roasting;
 * ADR-002). `finalize_roast_batch` in ONE txn: mints the roasted `lots` node, routes
 * the CONSERVED 'roast' lot_edge (the Phase-1 lot_edges_conserve_mass trigger rejects
 * routing more green than exists — the mass guarantee REUSED), posts a processing-batch
 * cost_entry so roast cost flows into COGS, and appends `roast_finalized`. It RETURNS
 * the minted roasted lot code (text), idempotent on the batch (a replay returns the
 * same code, no second cost row). This file (no database) proves the validation seam
 * (roasted out > 0, optional cost ≥ 0), the exact envelope, and that the data-layer
 * rejections (mass-loss, conservation, non-open, unknown) surface as CLEAN sentences.
 * Mirrors finalizeMillingRun.test.ts.
 */

function fakeStore(result: {
  data: string | null;
  error: { message: string; code?: string } | null;
}): { store: FinalizeRoastBatchStore; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as FinalizeRoastBatchStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  batchId: "5",
  roastedKgOut: "10.1",
  roastCostUsd: "18",
  location: "Roastery · Shelf 2",
  idempotencyKey: "idem-finalize-batch-5",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateFinalizeRoastBatch", () => {
  it("accepts a complete, well-formed finalize", () => {
    const r = validateFinalizeRoastBatch(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.batchId).toBe(5);
      expect(r.data.roastedKgOut).toBe(10.1);
      expect(r.data.roastCostUsd).toBe(18);
      expect(r.data.location).toBe("Roastery · Shelf 2");
      expect(r.data.idempotencyKey).toBe("idem-finalize-batch-5");
    }
  });

  it("treats a blank roast cost as null (the RPC coalesces to 0 — no cost row)", () => {
    const r = validateFinalizeRoastBatch({ ...validRaw(), roastCostUsd: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.roastCostUsd).toBeNull();
  });

  it("treats a blank location as null (event metadata only)", () => {
    const r = validateFinalizeRoastBatch({ ...validRaw(), location: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.location).toBeNull();
  });

  it("rejects a non-positive / non-integer batch id", () => {
    expect(validateFinalizeRoastBatch({ ...validRaw(), batchId: "0" }).ok).toBe(false);
    expect(validateFinalizeRoastBatch({ ...validRaw(), batchId: "5.5" }).ok).toBe(false);
  });

  it("rejects a non-positive roasted outturn", () => {
    const r = validateFinalizeRoastBatch({ ...validRaw(), roastedKgOut: "0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.roastedKgOut).toMatch(/greater than 0/i);
  });

  it("rejects a negative roast cost when one is supplied", () => {
    const r = validateFinalizeRoastBatch({ ...validRaw(), roastCostUsd: "-1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.roastCostUsd).toBeDefined();
  });

  it("rejects a missing idempotency key", () => {
    const r = validateFinalizeRoastBatch({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── friendly-error seam ───────────────────────────

describe("friendlyFinalizeRoastBatchError", () => {
  it("maps the mass-loss rejection (roasted out > green in) to a friendly message", () => {
    const msg = friendlyFinalizeRoastBatchError({
      message:
        "roast batch 5: roasted out 13.000 kg cannot exceed green in 12.000 kg (roasting only loses mass)",
    });
    expect(msg).toMatch(/green|loses mass|more than|weight/i);
    expect(msg).not.toMatch(/finalize_roast_batch/);
  });

  it("maps the conservation trigger (over-routing green) to a friendly message", () => {
    const msg = friendlyFinalizeRoastBatchError({
      message: "mass conservation: routing 12 kg from JC-742 exceeds its available mass",
    });
    expect(msg).toMatch(/available|exceed|enough|mass|green/i);
    expect(msg).not.toMatch(/lot_edges_conserve_mass/);
  });

  it("maps an already-finalized / non-open batch to a friendly message", () => {
    const msg = friendlyFinalizeRoastBatchError({
      message: "roast batch 5 is finalized — only an open batch can be finalized",
    });
    expect(msg).toMatch(/already|finaliz|open/i);
    expect(msg).not.toMatch(/finalize_roast_batch/);
  });

  it("maps an unknown batch to a friendly message", () => {
    const msg = friendlyFinalizeRoastBatchError({
      code: "23503",
      message: "unknown roast batch 99",
    });
    expect(msg).toMatch(/batch|found/i);
    expect(msg).not.toMatch(/finalize_roast_batch/);
  });

  it("falls back to a clean generic line for anything unrecognised", () => {
    const msg = friendlyFinalizeRoastBatchError({ message: "deadlock detected" });
    expect(msg).toBeTruthy();
    expect(msg).not.toMatch(/deadlock detected/);
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("finalizeRoastBatch", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await finalizeRoastBatch(store, { ...validRaw(), roastedKgOut: "0" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.roastedKgOut).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls finalize_roast_batch once with the exact envelope and returns the MINTED roasted code", async () => {
    const { store, rpc } = fakeStore({ data: "JC-803", error: null });
    const result = await finalizeRoastBatch(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("finalize_roast_batch", {
      p_batch_id: 5,
      p_roasted_kg_out: 10.1,
      p_roast_cost_usd: 18,
      p_location: "Roastery · Shelf 2",
      p_idempotency_key: "idem-finalize-batch-5",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.roastedLotCode).toBe("JC-803");
  });

  it("forwards a blank cost / location as null in the envelope", async () => {
    const { store, rpc } = fakeStore({ data: "JC-803", error: null });
    await finalizeRoastBatch(store, { ...validRaw(), roastCostUsd: "", location: "" });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_roast_cost_usd).toBeNull();
    expect(args.p_location).toBeNull();
  });

  it("surfaces a FRIENDLY message when roasted out exceeds green in (never raw PG)", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        message:
          "roast batch 5: roasted out 13.000 kg cannot exceed green in 12.000 kg (roasting only loses mass)",
      },
    });
    const result = await finalizeRoastBatch(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/green|loses mass|more than|weight/i);
      expect(result.message).not.toMatch(/finalize_roast_batch/);
    }
  });

  it("maps an already-finalized batch to a friendly message", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "roast batch 5 is finalized — only an open batch can be finalized" },
    });
    const result = await finalizeRoastBatch(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/already|finaliz|open/i);
  });

  it("returns a clean message when the RPC yields no roasted code", async () => {
    const { store } = fakeStore({ data: null, error: null });
    const result = await finalizeRoastBatch(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBeTruthy();
      expect(result.message).not.toMatch(/finalize_roast_batch/);
    }
  });
});
