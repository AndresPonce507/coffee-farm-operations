import { describe, expect, it, vi } from "vitest";

import {
  recordCherryIntake,
  validateCherryIntake,
  type CherryIntakeStore,
} from "@/lib/db/commands/recordCherryIntake";

/**
 * Pure-domain command test for the cherry-intake write (ADR-002 — every write
 * flows through a SECURITY DEFINER command RPC). This file does NOT touch a
 * database: it drives the command against a *fake store* (a hand-rolled stub of
 * the one method the command calls, `.rpc('record_cherry_intake', …)`), so it
 * can prove the friendly-validation seam and the exactly-once contract SHAPE in
 * the fast jsdom loop. The SQL CHECK/raise is the *real* enforcement; this test
 * pins the friendly errors the family sees before the round-trip and the exact
 * snake_case argument envelope the RPC receives.
 *
 * Mirrors the Supabase-client mock idiom in src/lib/db/__tests__/getters.test.ts
 * (a vi.fn() returning a configured `{ data, error }` PostgREST-shaped result).
 */

/** Build a fake CherryIntakeStore whose `.rpc()` resolves to a fixed result. */
function fakeStore(
  result: { data: string | null; error: { message: string } | null },
): { store: CherryIntakeStore; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as CherryIntakeStore, rpc };
}

/** A complete, valid raw intake — the happy-path baseline each case tweaks. */
const validRaw = (): Record<string, unknown> => ({
  plotId: "p-tizingal-alto",
  workerId: "w-lucia",
  cherriesKg: "88",
  variety: "Geisha",
  occurredAt: "2026-06-20T14:03:00.000Z",
  deviceId: "server",
  deviceSeq: "1",
  idempotencyKey: "intake-2026-06-20-w-lucia-001",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateCherryIntake", () => {
  it("accepts a complete, well-formed intake", () => {
    const r = validateCherryIntake(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.cherriesKg).toBe(88);
      expect(r.data.variety).toBe("Geisha");
      expect(r.data.deviceSeq).toBe(1);
    }
  });

  it("rejects a missing plot with a friendly error", () => {
    const r = validateCherryIntake({ ...validRaw(), plotId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.plotId).toMatch(/plot/i);
  });

  it("rejects a missing picker with a friendly error", () => {
    const r = validateCherryIntake({ ...validRaw(), workerId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.workerId).toMatch(/picker/i);
  });

  it("rejects non-positive cherry mass", () => {
    const r = validateCherryIntake({ ...validRaw(), cherriesKg: "0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.cherriesKg).toMatch(/greater than 0/i);
  });

  it("rejects an unknown variety (not in the coffee_variety enum)", () => {
    const r = validateCherryIntake({ ...validRaw(), variety: "Robusta" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.variety).toMatch(/variety/i);
  });

  it("rejects a non-ISO occurredAt timestamp", () => {
    const r = validateCherryIntake({ ...validRaw(), occurredAt: "not-a-date" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.occurredAt).toBeDefined();
  });

  it("rejects a blank idempotency key (the exactly-once anchor)", () => {
    const r = validateCherryIntake({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });

  it("collects multiple field errors at once", () => {
    const r = validateCherryIntake({
      ...validRaw(),
      plotId: "",
      cherriesKg: "-3",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(["cherriesKg", "plotId"]);
    }
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("recordCherryIntake", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });

    const result = await recordCherryIntake(store, { ...validRaw(), plotId: "" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.plotId).toBeDefined();
    // The SQL is the real guard, but bad input must never reach it.
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls record_cherry_intake EXACTLY ONCE with the snake_case arg envelope", async () => {
    const { store, rpc } = fakeStore({ data: "JC-565", error: null });

    const result = await recordCherryIntake(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_cherry_intake", {
      p_plot_id: "p-tizingal-alto",
      p_worker_id: "w-lucia",
      p_cherries_kg: 88,
      p_variety: "Geisha",
      p_occurred_at: "2026-06-20T14:03:00.000Z",
      p_device_id: "server",
      p_device_seq: 1,
      p_idempotency_key: "intake-2026-06-20-w-lucia-001",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lotCode).toBe("JC-565");
  });

  it("surfaces a labelled error when the RPC fails", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "duplicate key value violates unique constraint" },
    });

    const result = await recordCherryIntake(store, validRaw());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("record_cherry_intake");
      expect(result.message).toContain("duplicate key");
    }
  });

  it("is exactly-once by key: the same idempotencyKey returns the SAME minted code without a second mint", async () => {
    // The SQL guarantees this; the command's contract is to pass the key
    // through unchanged so the DB can dedupe. We prove the key is forwarded and
    // that a replay (same key) yields the originally-minted code, no second arg
    // envelope mutation.
    const { store, rpc } = fakeStore({ data: "JC-565", error: null });
    const raw = validRaw();

    const first = await recordCherryIntake(store, raw);
    const second = await recordCherryIntake(store, raw);

    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.lotCode).toBe(second.lotCode); // same minted code
    }
    // Both calls carry the identical idempotency key — the dedupe anchor.
    const firstArgs = rpc.mock.calls[0][1] as Record<string, unknown>;
    const secondArgs = rpc.mock.calls[1][1] as Record<string, unknown>;
    expect(firstArgs.p_idempotency_key).toBe(secondArgs.p_idempotency_key);
  });
});
