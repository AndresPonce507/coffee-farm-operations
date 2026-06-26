import { describe, expect, it, vi } from "vitest";

import {
  recordGreenGrade,
  validateRecordGreenGrade,
  type RecordGreenGradeStore,
} from "@/lib/db/commands/recordGreenGrade";

/**
 * Pure-domain command test for the SCA green-grade append (P3-S9, ADR-002 — every
 * write flows through a SECURITY DEFINER command RPC). This file does NOT touch a
 * database: it drives the command against a *fake store* (a hand-rolled stub of the
 * one method the command calls, `.rpc('record_green_grade', …)`), so it proves the
 * friendly-validation seam and the exact snake_case argument envelope the
 * `record_green_grade(text, integer, integer, integer, text)` RPC receives in the
 * fast jsdom loop. The DB is the real enforcement: `mill_grade.sca_prep` is a
 * GENERATED column (the grade can NEVER drift from its defect counts), the table is
 * append-only (a re-grade is a NEW row), and the RPC tenant-clamps + dedupes on the
 * idempotency key. This test pins the friendly errors the family sees before the
 * round-trip + that a raised RPC error surfaces clean (never raw PG text).
 *
 * Mirrors the established command-test idiom in gradeGreenLot.test.ts.
 */

/** Build a fake RecordGreenGradeStore whose `.rpc()` resolves to a fixed result. */
function fakeStore(result: {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}): { store: RecordGreenGradeStore; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as RecordGreenGradeStore, rpc };
}

/** A complete, valid raw grade — the happy-path baseline each case tweaks. */
const validRaw = (): Record<string, unknown> => ({
  greenLotCode: "JC-701",
  cat1Defects: "0",
  cat2Defects: "3",
  screenSize: "17",
  idempotencyKey: "grade-2026-06-20-001",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateRecordGreenGrade", () => {
  it("accepts a complete, well-formed grade", () => {
    const r = validateRecordGreenGrade(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.greenLotCode).toBe("JC-701");
      expect(r.data.cat1Defects).toBe(0);
      expect(r.data.cat2Defects).toBe(3);
      expect(r.data.screenSize).toBe(17);
      expect(r.data.idempotencyKey).toBe("grade-2026-06-20-001");
    }
  });

  it("treats a blank screen size as undeclared (null — the RPC's nullable arg)", () => {
    const r = validateRecordGreenGrade({ ...validRaw(), screenSize: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.screenSize).toBeNull();
  });

  it("rejects a missing green lot with a friendly error", () => {
    const r = validateRecordGreenGrade({ ...validRaw(), greenLotCode: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.greenLotCode).toMatch(/lot/i);
  });

  it("rejects a negative cat-1 defect count (the cat1_defects >= 0 CHECK)", () => {
    const r = validateRecordGreenGrade({ ...validRaw(), cat1Defects: "-1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.cat1Defects).toBeDefined();
  });

  it("rejects a non-integer defect count (the integer column)", () => {
    const r = validateRecordGreenGrade({ ...validRaw(), cat2Defects: "3.5" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.cat2Defects).toBeDefined();
  });

  it("rejects a non-numeric defect count", () => {
    const r = validateRecordGreenGrade({ ...validRaw(), cat1Defects: "lots" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.cat1Defects).toBeDefined();
  });

  it("rejects a negative screen size when one is supplied", () => {
    const r = validateRecordGreenGrade({ ...validRaw(), screenSize: "-2" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.screenSize).toBeDefined();
  });

  it("rejects a missing idempotency key", () => {
    const r = validateRecordGreenGrade({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });

  it("collects multiple field errors at once", () => {
    const r = validateRecordGreenGrade({
      ...validRaw(),
      greenLotCode: "",
      cat1Defects: "-5",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(["cat1Defects", "greenLotCode"]);
    }
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("recordGreenGrade", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });

    const result = await recordGreenGrade(store, { ...validRaw(), greenLotCode: "" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.greenLotCode).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls record_green_grade once with the exact snake_case envelope and returns the grade id", async () => {
    const { store, rpc } = fakeStore({ data: 42, error: null });

    const result = await recordGreenGrade(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_green_grade", {
      p_green_lot_code: "JC-701",
      p_cat1_defects: 0,
      p_cat2_defects: 3,
      p_screen_size: 17,
      p_idempotency_key: "grade-2026-06-20-001",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.gradeId).toBe(42);
  });

  it("forwards a blank screen size as null (the RPC's nullable integer arg)", async () => {
    const { store, rpc } = fakeStore({ data: 7, error: null });

    await recordGreenGrade(store, { ...validRaw(), screenSize: "" });

    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_screen_size).toBeNull();
  });

  it("coerces a PostgREST string id back to a number", async () => {
    const { store } = fakeStore({ data: "42", error: null });
    const result = await recordGreenGrade(store, validRaw());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.gradeId).toBe(42);
  });

  it("maps an unknown-green-lot rejection to a friendly message (never raw PG)", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "unknown green lot JC-999", code: "23503" },
    });

    const result = await recordGreenGrade(store, validRaw());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/lot|found/i);
      expect(result.message).not.toMatch(/record_green_grade|23503/);
    }
  });

  it("surfaces a clean labelled message for any other RPC failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "no tenant in session" },
    });

    const result = await recordGreenGrade(store, validRaw());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBeTruthy();
      expect(result.message).not.toMatch(/record_green_grade/);
    }
  });

  it("returns a clean message when the RPC yields no id", async () => {
    const { store } = fakeStore({ data: null, error: null });

    const result = await recordGreenGrade(store, validRaw());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });
});
