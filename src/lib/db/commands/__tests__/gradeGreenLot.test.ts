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
 * The green code is SYSTEM IDENTITY, minted server-side by `materialize_green_lot`
 * (migration 20260621120000) — the form passes NO green code, so the command
 * forwards `p_green_code` as null and shows the RETURNED minted code. Defense in
 * depth: if a green code IS ever supplied it must match the `lots_code_format`
 * CHECK (`^JC-[0-9]{3,}$`) or the command rejects it before the round-trip.
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

/**
 * A complete, valid raw grade — the happy-path baseline each case tweaks. NO
 * green code is supplied (the common path): the RPC mints the JC-NNN identity.
 */
const validRaw = (): Record<string, unknown> => ({
  sourceCode: "JC-564",
  kg: "240",
  cuppingScore: "88.5",
  location: "Warehouse A · Rack 3",
  occurredAt: "2026-06-20T14:03:00.000Z",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateGradeGreenLot", () => {
  it("accepts a complete, well-formed grade with NO green code (server-minted)", () => {
    const r = validateGradeGreenLot(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.sourceCode).toBe("JC-564");
      expect(r.data.greenCode).toBe("");
      expect(r.data.kg).toBe(240);
      expect(r.data.cuppingScore).toBe(88.5);
    }
  });

  it("accepts a SUPPLIED green code that matches the lots_code_format CHECK", () => {
    const r = validateGradeGreenLot({ ...validRaw(), greenCode: "JC-564" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.greenCode).toBe("JC-564");
  });

  it("rejects a SUPPLIED green code that violates the lots_code_format CHECK", () => {
    // The old '<source>-G' form is exactly what broke every grade — defense in depth.
    const r = validateGradeGreenLot({ ...validRaw(), greenCode: "JC-564-G" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.greenCode).toMatch(/JC|format|code/i);
  });

  it("rejects a missing source lot with a friendly error", () => {
    const r = validateGradeGreenLot({ ...validRaw(), sourceCode: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.sourceCode).toMatch(/source/i);
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

  it("passes p_green_code as null so the RPC mints the identity, and returns the MINTED code", async () => {
    // The DB mints a digit-only JC-NNN and returns it; the command surfaces it.
    const { store, rpc } = fakeStore({ data: "JC-572", error: null });

    const result = await gradeGreenLot(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("materialize_green_lot", {
      p_source_code: "JC-564",
      p_green_code: null,
      p_kg: 240,
      p_cupping_score: 88.5,
      p_location: "Warehouse A · Rack 3",
      p_occurred_at: "2026-06-20T14:03:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.greenLotCode).toBe("JC-572");
  });

  it("forwards a SUPPLIED, well-formed green code to the RPC unchanged", async () => {
    const { store, rpc } = fakeStore({ data: "JC-564", error: null });

    const result = await gradeGreenLot(store, { ...validRaw(), greenCode: "JC-564" });

    expect(rpc).toHaveBeenCalledTimes(1);
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_green_code).toBe("JC-564");
    expect(result.ok).toBe(true);
  });

  it("rejects a malformed SUPPLIED green code WITHOUT a round-trip (defense in depth)", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });

    const result = await gradeGreenLot(store, { ...validRaw(), greenCode: "JC-564-G" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.greenCode).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces a FRIENDLY message (never raw PG) when the conservation trigger rejects over-routing", async () => {
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
      expect(result.message).toMatch(/available|exceed|enough|mass/i);
      // The raw function-name prefix must not leak to the family.
      expect(result.message).not.toMatch(/materialize_green_lot/);
    }
  });

  it("maps an unknown-source foreign-key rejection to a friendly message", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: 'unknown source lot "JC-999"' },
    });

    const result = await gradeGreenLot(store, validRaw());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/source|lot|exist/i);
      expect(result.message).not.toMatch(/materialize_green_lot/);
    }
  });

  it("maps a code-format CHECK rejection to a friendly message (never raw PG)", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        message:
          'new row for relation "lots" violates check constraint "lots_code_format"',
      },
    });

    const result = await gradeGreenLot(store, validRaw());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toMatch(/lots_code_format|check constraint/);
      expect(result.message?.length).toBeGreaterThan(0);
    }
  });

  it("returns a clean message when the RPC yields no code", async () => {
    const { store } = fakeStore({ data: null, error: null });

    const result = await gradeGreenLot(store, validRaw());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBeTruthy();
      expect(result.message).not.toMatch(/materialize_green_lot/);
    }
  });
});
