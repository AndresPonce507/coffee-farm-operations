import { describe, expect, it, vi } from "vitest";

import {
  advanceProcessingStage,
  validateAdvanceProcessingStage,
  type AdvanceProcessingStageStore,
} from "@/lib/db/commands/advanceProcessingStage";

/**
 * Pure-domain command test for the PROCESS-ADVANCE write (the pipeline slice,
 * ADR-002 — every write flows through a SECURITY DEFINER command RPC). This file
 * does NOT touch a database: it drives the command against a *fake store* (a
 * hand-rolled stub of the one method the command calls,
 * `.rpc('advance_processing_stage', …)`), so it proves the friendly-validation
 * seam and the exact snake_case argument envelope the
 * `advance_processing_stage` RPC receives in the fast jsdom loop.
 *
 * The hardened RPC (migration 20260621110000) is the *real* enforcement: it
 * validates the target is a real `batch_stage`, forbids a backward move, and
 * forbids a mass GAIN. This test pins the friendly errors the family sees before
 * the round-trip and that the command surfaces a CLEAN error when the RPC raises
 * one of those CHECK violations (never a raw Postgres exception).
 *
 * Mirrors the established command-test idiom in gradeGreenLot.test.ts.
 */

/** Build a fake AdvanceProcessingStageStore whose `.rpc()` resolves to a fixed result. */
function fakeStore(result: {
  data: string | null;
  error: { message: string; code?: string } | null;
}): { store: AdvanceProcessingStageStore; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as AdvanceProcessingStageStore, rpc };
}

/** A complete, valid raw advance — the happy-path baseline each case tweaks. */
const validRaw = (): Record<string, unknown> => ({
  lotCode: "JC-561",
  toStage: "drying",
  currentKg: "420",
  occurredAt: "2026-06-20T14:03:00.000Z",
  deviceId: "server",
  deviceSeq: 0,
  idempotencyKey: "fixed-key-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateAdvanceProcessingStage", () => {
  it("accepts a complete, well-formed advance", () => {
    const r = validateAdvanceProcessingStage(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.lotCode).toBe("JC-561");
      expect(r.data.toStage).toBe("drying");
      expect(r.data.currentKg).toBe(420);
    }
  });

  it("rejects a missing lot code with a friendly error", () => {
    const r = validateAdvanceProcessingStage({ ...validRaw(), lotCode: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.lotCode).toMatch(/lot/i);
  });

  it("rejects a target stage that is not a real batch_stage", () => {
    const r = validateAdvanceProcessingStage({ ...validRaw(), toStage: "roasted" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.toStage).toMatch(/stage/i);
  });

  it("rejects a missing target stage", () => {
    const r = validateAdvanceProcessingStage({ ...validRaw(), toStage: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.toStage).toBeDefined();
  });

  it("rejects a non-positive current weight", () => {
    const zero = validateAdvanceProcessingStage({ ...validRaw(), currentKg: "0" });
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.errors.currentKg).toMatch(/greater than 0/i);

    const neg = validateAdvanceProcessingStage({ ...validRaw(), currentKg: "-5" });
    expect(neg.ok).toBe(false);
    if (!neg.ok) expect(neg.errors.currentKg).toBeDefined();
  });

  it("rejects a non-numeric current weight", () => {
    const r = validateAdvanceProcessingStage({ ...validRaw(), currentKg: "heavy" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.currentKg).toBeDefined();
  });

  it("rejects a non-ISO occurredAt timestamp", () => {
    const r = validateAdvanceProcessingStage({ ...validRaw(), occurredAt: "soon" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.occurredAt).toBeDefined();
  });

  it("collects multiple field errors at once", () => {
    const r = validateAdvanceProcessingStage({
      ...validRaw(),
      lotCode: "",
      currentKg: "-3",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(["currentKg", "lotCode"]);
    }
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("advanceProcessingStage", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });

    const result = await advanceProcessingStage(store, {
      ...validRaw(),
      lotCode: "",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.lotCode).toBeDefined();
    // The SQL is the real guard, but bad input must never reach it.
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls advance_processing_stage EXACTLY ONCE with the snake_case arg envelope", async () => {
    const { store, rpc } = fakeStore({ data: "JC-561", error: null });

    const result = await advanceProcessingStage(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("advance_processing_stage", {
      p_lot_code: "JC-561",
      p_to_stage: "drying",
      p_current_kg: 420,
      p_occurred_at: "2026-06-20T14:03:00.000Z",
      p_device_id: "server",
      p_device_seq: 0,
      p_idempotency_key: "fixed-key-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lotCode).toBe("JC-561");
  });

  it("surfaces a labelled error when the RPC rejects a BACKWARD move", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        message: "lot JC-561 cannot move backward (drying -> fermentation)",
        code: "23514",
      },
    });

    const result = await advanceProcessingStage(store, {
      ...validRaw(),
      toStage: "fermentation",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/backward/i);
    }
  });

  it("surfaces a labelled error when the RPC rejects a mass GAIN", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        message: "lot JC-561 current_kg cannot increase (420 -> 9999)",
        code: "23514",
      },
    });

    const result = await advanceProcessingStage(store, {
      ...validRaw(),
      currentKg: "9999",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/increase|gain|cannot/i);
    }
  });

  it("maps an unknown-lot foreign_key_violation to a FRIENDLY message (never raw PG)", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        message:
          'insert or update on table "lot_event" violates foreign key constraint "lot_event_lot_code_fkey"',
        code: "23503",
      },
    });

    const result = await advanceProcessingStage(store, {
      ...validRaw(),
      lotCode: "JC-999",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Family-readable — mentions the unknown lot, not the raw FK text.
      expect(result.message).toMatch(/lot|exist|found/i);
      expect(result.message).not.toMatch(/foreign key constraint/i);
    }
  });

  it("maps a (device_id, device_seq) unique_violation to a FRIENDLY retry message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        message:
          'duplicate key value violates unique constraint "lot_event_device_id_device_seq_key"',
        code: "23505",
      },
    });

    const result = await advanceProcessingStage(store, validRaw());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/again|retry|try/i);
      expect(result.message).not.toMatch(/duplicate key value/i);
    }
  });

  it("maps the reposo (rest-stability) gate to a FRIENDLY message that echoes the reason (never the raw `reposo gate:` prefix)", async () => {
    // The drying->milled reposo gate raises a labelled check_violation whose
    // trailing parens carry the human reason from reposo_status (e.g.
    // "resting 2/5 days"). friendlyRpcError must surface that reason cleanly —
    // not the `reposo gate:` engine prefix nor the `advance_processing_stage:`
    // command label.
    const { store } = fakeStore({
      data: null,
      error: {
        message: "reposo gate: lot JC-561 not rest-stable (resting 2/5 days)",
        code: "23514",
      },
    });

    const result = await advanceProcessingStage(store, {
      ...validRaw(),
      toStage: "milled",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Family-readable: names the lot, echoes the reason tail, and tells them
      // it must finish resting/reposo first.
      expect(result.message).toContain("JC-561");
      expect(result.message).toContain("resting 2/5 days");
      expect(result.message).toMatch(/rest|reposo/i);
      // The raw labelled engine string must NOT leak through.
      expect(result.message).not.toMatch(/reposo gate:/i);
      expect(result.message).not.toMatch(/advance_processing_stage:/i);
      expect(result.message).not.toMatch(/not rest-stable \(/i);
    }
  });

  it("maps the reposo gate (moisture reason) to a FRIENDLY message even when the band text has no inner parens", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        message:
          "reposo gate: lot JC-561 not rest-stable (moisture 8.5% not yet stable in 10–12% band)",
        code: "23514",
      },
    });

    const result = await advanceProcessingStage(store, {
      ...validRaw(),
      toStage: "milled",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("JC-561");
      expect(result.message).toContain("moisture 8.5% not yet stable");
      expect(result.message).not.toMatch(/reposo gate:/i);
      expect(result.message).not.toMatch(/advance_processing_stage:/i);
    }
  });

  it("surfaces a labelled error for any OTHER (unmapped) RPC failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "connection reset by peer", code: "08006" },
    });

    const result = await advanceProcessingStage(store, validRaw());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("advance_processing_stage");
    }
  });

  it("is idempotent on the idempotency key: a replay forwards the SAME key", async () => {
    // The SQL RPC dedupes on idempotency_key (a no-op replay returns the lot
    // code). The command's contract is to forward the same key + envelope on a
    // retry so the DB can dedupe — we prove the envelope is identical.
    const { store, rpc } = fakeStore({ data: "JC-561", error: null });
    const raw = validRaw();

    const first = await advanceProcessingStage(store, raw);
    const second = await advanceProcessingStage(store, raw);

    expect(first.ok && second.ok).toBe(true);
    const firstArgs = rpc.mock.calls[0][1] as Record<string, unknown>;
    const secondArgs = rpc.mock.calls[1][1] as Record<string, unknown>;
    expect(firstArgs.p_idempotency_key).toBe(secondArgs.p_idempotency_key);
  });
});
