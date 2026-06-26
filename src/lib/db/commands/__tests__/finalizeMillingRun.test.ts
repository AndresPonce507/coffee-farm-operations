import { describe, expect, it, vi } from "vitest";

import {
  finalizeMillingRun,
  validateFinalizeMillingRun,
  type FinalizeMillingRunStore,
} from "@/lib/db/commands/finalizeMillingRun";

/**
 * Pure-domain command test for the milling-run finalize keystone (P3-S9, ADR-002 —
 * every write flows through a SECURITY DEFINER command RPC). This file does NOT
 * touch a database: it drives the command against a *fake store* (a hand-rolled
 * stub of the one method the command calls, `.rpc('finalize_milling_run', …)`), so
 * it proves the friendly-validation seam and the exact snake_case argument envelope
 * the `finalize_milling_run(bigint, numeric, numeric, text, integer, integer,
 * integer, numeric, text)` RPC receives in the fast jsdom loop.
 *
 * The DB is the real enforcement: finalize validates the CLOSED OUTTURN MASS
 * BALANCE (an 18%-vanished run is physically rejected and the whole txn rolls
 * back), then CALLS materialize_green_lot (the Phase-1 conservation trigger rejects
 * minting more green than the parchment holds), posts a processing-batch cost_entry
 * so milling cost flows into cogs_per_lot, auto-grades the green, and appends
 * 'mill_run_finalized'. It returns the MINTED green lot code (text), idempotent on
 * the green code: a replayed finalize returns the same code with no second mint /
 * cost row. This test pins the friendly errors the family sees (mass-balance,
 * already-finalized, conservation, unknown run) — raw PG text never leaks.
 *
 * Mirrors the established command-test idiom in gradeGreenLot.test.ts.
 */

/** Build a fake FinalizeMillingRunStore whose `.rpc()` resolves to a fixed result. */
function fakeStore(result: {
  data: string | null;
  error: { message: string; code?: string } | null;
}): { store: FinalizeMillingRunStore; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as FinalizeMillingRunStore, rpc };
}

/** A complete, valid raw finalize — the happy-path baseline each case tweaks. */
const validRaw = (): Record<string, unknown> => ({
  runId: "12",
  greenKgOut: "410",
  cuppingScore: "88.5",
  location: "Warehouse A · Rack 3",
  cat1Defects: "0",
  cat2Defects: "3",
  screenSize: "17",
  processingCostUsd: "120",
  idempotencyKey: "finalize-run-12-001",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateFinalizeMillingRun", () => {
  it("accepts a complete, well-formed finalize", () => {
    const r = validateFinalizeMillingRun(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.runId).toBe(12);
      expect(r.data.greenKgOut).toBe(410);
      expect(r.data.cuppingScore).toBe(88.5);
      expect(r.data.location).toBe("Warehouse A · Rack 3");
      expect(r.data.cat1Defects).toBe(0);
      expect(r.data.cat2Defects).toBe(3);
      expect(r.data.screenSize).toBe(17);
      expect(r.data.processingCostUsd).toBe(120);
      expect(r.data.idempotencyKey).toBe("finalize-run-12-001");
    }
  });

  it("treats a blank processing cost as null (the RPC coalesces to 0 — no cost row)", () => {
    const r = validateFinalizeMillingRun({ ...validRaw(), processingCostUsd: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.processingCostUsd).toBeNull();
  });

  it("treats a blank screen size as null", () => {
    const r = validateFinalizeMillingRun({ ...validRaw(), screenSize: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.screenSize).toBeNull();
  });

  it("rejects a non-positive run id", () => {
    const r = validateFinalizeMillingRun({ ...validRaw(), runId: "0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.runId).toBeDefined();
  });

  it("rejects a non-integer run id (the bigint identity)", () => {
    const r = validateFinalizeMillingRun({ ...validRaw(), runId: "12.5" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.runId).toBeDefined();
  });

  it("rejects a non-positive green outturn", () => {
    const r = validateFinalizeMillingRun({ ...validRaw(), greenKgOut: "0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.greenKgOut).toMatch(/greater than 0/i);
  });

  it("rejects a cupping score outside 0–100 (the green_lots CHECK)", () => {
    const high = validateFinalizeMillingRun({ ...validRaw(), cuppingScore: "101" });
    expect(high.ok).toBe(false);
    if (!high.ok) expect(high.errors.cuppingScore).toMatch(/0.*100/);
  });

  it("rejects a missing storage location", () => {
    const r = validateFinalizeMillingRun({ ...validRaw(), location: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.location).toMatch(/location/i);
  });

  it("rejects a negative cat-1 defect count", () => {
    const r = validateFinalizeMillingRun({ ...validRaw(), cat1Defects: "-1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.cat1Defects).toBeDefined();
  });

  it("rejects a non-integer defect count", () => {
    const r = validateFinalizeMillingRun({ ...validRaw(), cat2Defects: "2.5" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.cat2Defects).toBeDefined();
  });

  it("rejects a negative processing cost when one is supplied", () => {
    const r = validateFinalizeMillingRun({ ...validRaw(), processingCostUsd: "-1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.processingCostUsd).toBeDefined();
  });

  it("rejects a missing idempotency key", () => {
    const r = validateFinalizeMillingRun({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("finalizeMillingRun", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });

    const result = await finalizeMillingRun(store, { ...validRaw(), greenKgOut: "0" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.greenKgOut).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls finalize_milling_run once with the exact snake_case envelope and returns the MINTED green code", async () => {
    const { store, rpc } = fakeStore({ data: "JC-742", error: null });

    const result = await finalizeMillingRun(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("finalize_milling_run", {
      p_run_id: 12,
      p_green_kg_out: 410,
      p_cupping_score: 88.5,
      p_location: "Warehouse A · Rack 3",
      p_cat1_defects: 0,
      p_cat2_defects: 3,
      p_screen_size: 17,
      p_processing_cost_usd: 120,
      p_idempotency_key: "finalize-run-12-001",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.greenLotCode).toBe("JC-742");
  });

  it("forwards a blank processing cost as null so the RPC posts NO cost row", async () => {
    const { store, rpc } = fakeStore({ data: "JC-742", error: null });

    await finalizeMillingRun(store, { ...validRaw(), processingCostUsd: "" });

    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_processing_cost_usd).toBeNull();
  });

  it("surfaces a FRIENDLY message when the closed mass balance is rejected (never raw PG)", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        message:
          "mill mass-balance unbalanced: run 12 outturn 410.000 kg leaves unaccounted loss beyond the per-variety ceiling",
      },
    });

    const result = await finalizeMillingRun(store, validRaw());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/balance|account|outturn|weigh/i);
      expect(result.message).not.toMatch(/finalize_milling_run|per-variety ceiling/);
    }
  });

  it("maps an already-finalized / non-open run to a friendly message", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "milling run 12 is finalized — only an open run can be finalized" },
    });

    const result = await finalizeMillingRun(store, validRaw());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/already|finaliz|open/i);
      expect(result.message).not.toMatch(/finalize_milling_run/);
    }
  });

  it("maps the conservation trigger (over-routing green) to a friendly message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        message:
          "mass conservation: routing 410 kg from JC-301 exceeds its available mass",
      },
    });

    const result = await finalizeMillingRun(store, validRaw());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/available|exceed|enough|mass|parchment/i);
      expect(result.message).not.toMatch(/finalize_milling_run|materialize_green_lot/);
    }
  });

  it("maps an unknown milling run to a friendly message", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "unknown milling run 99", code: "23503" },
    });

    const result = await finalizeMillingRun(store, validRaw());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/run|found/i);
      expect(result.message).not.toMatch(/finalize_milling_run/);
    }
  });

  it("returns a clean message when the RPC yields no green code", async () => {
    const { store } = fakeStore({ data: null, error: null });

    const result = await finalizeMillingRun(store, validRaw());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBeTruthy();
      expect(result.message).not.toMatch(/finalize_milling_run/);
    }
  });
});
