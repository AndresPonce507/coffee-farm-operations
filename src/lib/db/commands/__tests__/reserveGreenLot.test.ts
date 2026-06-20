import { describe, expect, it, vi } from "vitest";

import {
  reserveGreenLot,
  validateReserveGreenLot,
  type ReserveGreenLotStore,
} from "@/lib/db/commands/reserveGreenLot";

/**
 * Pure-domain command test for the GreenLot reservation write (S5 — the first
 * money-shaped slice). A reservation is an APPEND-ONLY claim row inserted into
 * `lot_reservations`; the `prevent_oversell` BEFORE INSERT trigger is the *real*
 * enforcement (fail-closed at the data layer — double-selling a scarce micro-lot
 * is physically impossible). This file does NOT touch a database: it drives the
 * command against a *fake store* stubbing the one insert path the command uses,
 * and proves (a) the friendly-validation seam, (b) the exact snake_case row the
 * append-only insert receives, and — the load-bearing case — (c) that an oversell
 * rejection from the trigger surfaces as a CLEAN, friendly error (red first), not
 * a raw Postgres exception leaking to the family.
 *
 * Mirrors the established command-test idiom in recordCherryIntake.test.ts; the
 * store shape is an insert-builder (`.from(table).insert(row)`) rather than an
 * `.rpc()` because reservations are the one legal append-only client write (the
 * migration grants INSERT only on the claim tables — no reservation RPC).
 */

interface InsertResult {
  data: unknown;
  error: { message: string; code?: string } | null;
}

/**
 * Build a fake ReserveGreenLotStore whose `.from(t).insert(row)` resolves to a
 * fixed result, capturing the table + row it was called with.
 */
function fakeStore(result: InsertResult): {
  store: ReserveGreenLotStore;
  insert: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
} {
  const insert = vi.fn(() => Promise.resolve(result));
  const from = vi.fn(() => ({ insert }));
  return { store: { from } as unknown as ReserveGreenLotStore, insert, from };
}

/** A complete, valid raw reservation — the happy-path baseline each case tweaks. */
const validRaw = (): Record<string, unknown> => ({
  greenLotCode: "JC-564-G",
  buyer: "Onyx Coffee Lab",
  kg: "60",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateReserveGreenLot", () => {
  it("accepts a complete, well-formed reservation", () => {
    const r = validateReserveGreenLot(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.greenLotCode).toBe("JC-564-G");
      expect(r.data.buyer).toBe("Onyx Coffee Lab");
      expect(r.data.kg).toBe(60);
    }
  });

  it("rejects a missing green lot with a friendly error", () => {
    const r = validateReserveGreenLot({ ...validRaw(), greenLotCode: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.greenLotCode).toMatch(/lot/i);
  });

  it("rejects a missing buyer with a friendly error", () => {
    const r = validateReserveGreenLot({ ...validRaw(), buyer: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.buyer).toMatch(/buyer/i);
  });

  it("rejects non-positive reservation mass (the kg > 0 CHECK)", () => {
    const zero = validateReserveGreenLot({ ...validRaw(), kg: "0" });
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.errors.kg).toMatch(/greater than 0/i);

    const neg = validateReserveGreenLot({ ...validRaw(), kg: "-5" });
    expect(neg.ok).toBe(false);
    if (!neg.ok) expect(neg.errors.kg).toBeDefined();
  });

  it("rejects a non-numeric kg", () => {
    const r = validateReserveGreenLot({ ...validRaw(), kg: "lots" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.kg).toBeDefined();
  });

  it("collects multiple field errors at once", () => {
    const r = validateReserveGreenLot({ ...validRaw(), buyer: "", kg: "-1" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(["buyer", "kg"]);
    }
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("reserveGreenLot", () => {
  it("returns a validation failure WITHOUT inserting on bad input", async () => {
    const { store, insert, from } = fakeStore({ data: null, error: null });

    const result = await reserveGreenLot(store, { ...validRaw(), buyer: "" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.buyer).toBeDefined();
    // The trigger is the real guard, but bad input must never reach it.
    expect(from).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("inserts EXACTLY ONE append-only row with the snake_case column envelope", async () => {
    const { store, insert, from } = fakeStore({ data: [{ id: 1 }], error: null });

    const result = await reserveGreenLot(store, validRaw());

    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("lot_reservations");
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith({
      green_lot_code: "JC-564-G",
      buyer: "Onyx Coffee Lab",
      kg: 60,
    });
    expect(result.ok).toBe(true);
  });

  it("surfaces a CLEAN, friendly error when the oversell trigger fails closed", async () => {
    // The DESIGN money guarantee: an over-commit is physically rejected by the
    // `prevent_oversell` BEFORE INSERT trigger (errcode check_violation). The
    // command must NOT leak the raw Postgres exception — it returns a clean,
    // buyer-readable "not enough available-to-promise" message.
    const { store } = fakeStore({
      data: null,
      error: {
        message:
          "oversell guard: committing 60 kg to green lot JC-564-G would exceed its 50 kg available-to-promise (40 already committed)",
        code: "23514", // check_violation
      },
    });

    const result = await reserveGreenLot(store, validRaw());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // A clean, friendly message — NOT a stack trace; mentions availability.
      expect(result.message).toMatch(/available|enough|oversell|exceed/i);
      // The reservation kind is identifiable in the surfaced error.
      expect(result.message).toContain("JC-564-G");
    }
  });

  it("surfaces a labelled error for a generic insert failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "permission denied for table lot_reservations" },
    });

    const result = await reserveGreenLot(store, validRaw());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("reserve");
      expect(result.message).toContain("permission denied");
    }
  });
});
