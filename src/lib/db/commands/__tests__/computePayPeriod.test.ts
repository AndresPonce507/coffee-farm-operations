import { describe, expect, it, vi } from "vitest";

import {
  computePayPeriod,
  computePayPeriodRpcArgs,
  validateComputePayPeriod,
  type ComputePayPeriodStore,
} from "@/lib/db/commands/computePayPeriod";

/**
 * Pure-domain command test for the compute-pay-period write (P2-S7 — THE
 * PEOPLE-TRUNK CAPSTONE, ADR-002: every write flows through a SECURITY DEFINER
 * command RPC). This file does NOT touch a database: it drives the command against a
 * *fake store* (a stub of the one method the command calls, `.rpc('compute_pay_period',
 * …)`) so it proves the friendly-validation seam + the exact snake_case envelope in
 * the fast loop. The SQL CHECK/raise + the make-whole guard on pay_line are the *real*
 * enforcement; this pins the friendly errors the owner sees before the round-trip.
 */

/** Build a fake ComputePayPeriodStore whose `.rpc()` resolves to a fixed result. */
function fakeStore(result: {
  data: string | null;
  error: { message: string } | null;
}): { store: ComputePayPeriodStore; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as ComputePayPeriodStore, rpc };
}

/** A complete, valid raw compute-pay-period — the happy-path baseline each case tweaks. */
const validRaw = (): Record<string, unknown> => ({
  periodId: "pp-2026-06-w3",
  periodStart: "2026-06-15",
  periodEnd: "2026-06-21",
  season: "2026-main",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateComputePayPeriod", () => {
  it("accepts a complete, well-formed period (defaulting the hourly-rate source to daily)", () => {
    const r = validateComputePayPeriod(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.periodId).toBe("pp-2026-06-w3");
      expect(r.data.periodStart).toBe("2026-06-15");
      expect(r.data.periodEnd).toBe("2026-06-21");
      expect(r.data.season).toBe("2026-main");
      expect(r.data.hourlyRateSource).toBe("daily");
    }
  });

  it("errors when periodId is blank", () => {
    const r = validateComputePayPeriod({ ...validRaw(), periodId: "  " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.periodId).toBeTruthy();
  });

  it("rejects a non-ISO start or end date", () => {
    const a = validateComputePayPeriod({ ...validRaw(), periodStart: "June 15" });
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.errors.periodStart).toBeTruthy();
    const b = validateComputePayPeriod({ ...validRaw(), periodEnd: "" });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.errors.periodEnd).toBeTruthy();
  });

  it("rejects an end date before the start date (the window rule)", () => {
    const r = validateComputePayPeriod({
      ...validRaw(),
      periodStart: "2026-06-21",
      periodEnd: "2026-06-15",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.periodEnd).toMatch(/on or after/i);
  });

  it("treats a missing season as null (it is optional)", () => {
    const raw = validRaw();
    delete raw.season;
    const r = validateComputePayPeriod(raw);
    expect(r.ok && r.data.season).toBeNull();
  });

  it("defaults an absent/unknown hourly-rate source to daily", () => {
    const a = validateComputePayPeriod({ ...validRaw(), hourlyRateSource: "" });
    expect(a.ok && a.data.hourlyRateSource).toBe("daily");
    const b = validateComputePayPeriod({ ...validRaw(), hourlyRateSource: "monthly" });
    expect(b.ok && b.data.hourlyRateSource).toBe("daily");
  });
});

// ─────────────────────────── envelope + command ────────────────────────────

describe("computePayPeriodRpcArgs", () => {
  it("maps the validated input to the exact snake_case RPC envelope", () => {
    const v = validateComputePayPeriod(validRaw());
    if (!v.ok) throw new Error("fixture should validate");
    expect(computePayPeriodRpcArgs(v.data)).toEqual({
      p_period_id: "pp-2026-06-w3",
      p_period_start: "2026-06-15",
      p_period_end: "2026-06-21",
      p_season: "2026-main",
      p_hourly_rate_source: "daily",
    });
  });
});

describe("computePayPeriod", () => {
  it("calls compute_pay_period once and returns the period id", async () => {
    const { store, rpc } = fakeStore({ data: "pp-2026-06-w3", error: null });
    const res = await computePayPeriod(store, validRaw());
    expect(res).toEqual({ ok: true, periodId: "pp-2026-06-w3" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "compute_pay_period",
      expect.objectContaining({
        p_period_id: "pp-2026-06-w3",
        p_period_start: "2026-06-15",
      }),
    );
  });

  it("never reaches the RPC on invalid input (friendly errors only)", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const res = await computePayPeriod(store, { ...validRaw(), periodId: "" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors?.periodId).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces an RPC error labelled", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "no active workers for the period" },
    });
    const res = await computePayPeriod(store, validRaw());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/no active workers/);
  });
});
