import { describe, expect, it, vi } from "vitest";

import {
  gradeGreenLot,
  validateGradeGreenLot,
  type GradeGreenLotStore,
} from "@/lib/db/commands/gradeGreenLot";

/**
 * Pure-domain command test for the GreenLot grading write (S5, ADR-002 — every
 * write flows through a SECURITY DEFINER command RPC). This file does NOT touch a
 * database: it drives the command against a *fake store* (a hand-rolled stub of
 * the one method the command calls, `.rpc('materialize_green_lot', …)`), so it
 * proves the friendly-validation seam and the exact snake_case argument envelope
 * the `materialize_green_lot` RPC receives in the fast jsdom loop. The SQL
 * conservation trigger + CHECKs are the *real* enforcement; this test pins the
 * friendly errors the family sees before the round-trip and that the command
 * surfaces a clean error when the RPC raises (e.g. routing more mass than the
 * source holds).
 *
 * Mirrors the established command-test idiom in recordCherryIntake.test.ts.
 */

/** Build a fake GradeGreenLotStore whose `.rpc()` resolves to a fixed result. */
function fakeStore(
  result: { data: string | null; error: { message: string } | null },
): { store: GradeGreenLotStore; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as GradeGreenLotStore, rpc };
}

/** A complete, valid raw grade — the happy-path baseline each case tweaks. */
const validRaw = (): Record<string, unknown> => ({
  sourceCode: "JC-564",
  greenCode: "JC-564-G",
  kg: "240",
  cuppingScore: "88.5",
  location: "Warehouse A · Rack 3",
  occurredAt: "2026-06-20T14:03:00.000Z",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateGradeGreenLot", () => {
  it("accepts a complete, well-formed grade", () => {
    const r = validateGradeGreenLot(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.sourceCode).toBe("JC-564");
      expect(r.data.greenCode).toBe("JC-564-G");
      expect(r.data.kg).toBe(240);
      expect(r.data.cuppingScore).toBe(88.5);
    }
  });

  it("rejects a missing source lot with a friendly error", () => {
    const r = validateGradeGreenLot({ ...validRaw(), sourceCode: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.sourceCode).toMatch(/source/i);
  });

  it("rejects a missing green code with a friendly error", () => {
    const r = validateGradeGreenLot({ ...validRaw(), greenCode: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.greenCode).toMatch(/code/i);
  });

  it("rejects non-positive mass to route", () => {
    const r = validateGradeGreenLot({ ...validRaw(), kg: "0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.kg).toMatch(/greater than 0/i);
  });

  it("rejects a cupping score outside 0–100 (the green_lots CHECK)", () => {
    const high = validateGradeGreenLot({ ...validRaw(), cuppingScore: "101" });
    expect(high.ok).toBe(false);
    if (!high.ok) expect(high.errors.cuppingScore).toMatch(/0.*100/);

    const low = validateGradeGreenLot({ ...validRaw(), cuppingScore: "-1" });
    expect(low.ok).toBe(false);
    if (!low.ok) expect(low.errors.cuppingScore).toBeDefined();
  });

  it("rejects a non-numeric cupping score", () => {
    const r = validateGradeGreenLot({ ...validRaw(), cuppingScore: "tasty" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.cuppingScore).toBeDefined();
  });

  it("rejects a missing storage location", () => {
    const r = validateGradeGreenLot({ ...validRaw(), location: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.location).toMatch(/location/i);
  });

  it("rejects a non-ISO occurredAt timestamp", () => {
    const r = validateGradeGreenLot({ ...validRaw(), occurredAt: "yesterday" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.occurredAt).toBeDefined();
  });

  it("collects multiple field errors at once", () => {
    const r = validateGradeGreenLot({
      ...validRaw(),
      sourceCode: "",
      kg: "-3",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(["kg", "sourceCode"]);
    }
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("gradeGreenLot", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });

    const result = await gradeGreenLot(store, { ...validRaw(), sourceCode: "" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.sourceCode).toBeDefined();
    // The SQL is the real guard, but bad input must never reach it.
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls materialize_green_lot EXACTLY ONCE with the snake_case arg envelope", async () => {
    const { store, rpc } = fakeStore({ data: "JC-564-G", error: null });

    const result = await gradeGreenLot(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("materialize_green_lot", {
      p_source_code: "JC-564",
      p_green_code: "JC-564-G",
      p_kg: 240,
      p_cupping_score: 88.5,
      p_location: "Warehouse A · Rack 3",
      p_occurred_at: "2026-06-20T14:03:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.greenLotCode).toBe("JC-564-G");
  });

  it("surfaces a labelled error when the conservation trigger rejects over-routing", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        message:
          "mass conservation: routing 240 kg from JC-564 exceeds its available mass",
      },
    });

    const result = await gradeGreenLot(store, validRaw());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("materialize_green_lot");
      expect(result.message).toContain("mass conservation");
    }
  });

  it("is idempotent on the green code: a replay returns the SAME code without a second mutation arg change", async () => {
    // The SQL RPC is a no-op for an existing green code (returns the code). The
    // command's contract is to forward the same code on a retry so the DB can
    // dedupe — we prove the envelope is identical across calls.
    const { store, rpc } = fakeStore({ data: "JC-564-G", error: null });
    const raw = validRaw();

    const first = await gradeGreenLot(store, raw);
    const second = await gradeGreenLot(store, raw);

    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.greenLotCode).toBe(second.greenLotCode);
    }
    const firstArgs = rpc.mock.calls[0][1] as Record<string, unknown>;
    const secondArgs = rpc.mock.calls[1][1] as Record<string, unknown>;
    expect(firstArgs.p_green_code).toBe(secondArgs.p_green_code);
  });
});
