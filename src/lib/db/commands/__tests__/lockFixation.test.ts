import { describe, expect, it, vi } from "vitest";

import {
  lockFixation,
  validateLockFixation,
  type LockFixationStore,
} from "@/lib/db/commands/lockFixation";

/**
 * Pure-domain command test for locking a commodity quote's "C" fixation (P3-S0).
 * Drives the command against a fake `.rpc('lock_fixation', …)` store and proves
 * the friendly-validation seam, the exact snake_case argument envelope, and — the
 * load-bearing cases — that the data-layer guards surface CLEAN, family-readable
 * errors:
 *   - the FIXATION REGIME GUARD (a reserve quote has no "C" leg to fix),
 *   - the must-be-accepted gate (fix only after a reservation exists),
 *   - a missing ICE "C" mark to fix.
 * The RPC raises are the real enforcement (the migration's PGlite tests).
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: LockFixationStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as LockFixationStore, rpc };
}

/** The /hedge cockpit's published `LockFixationInput` uses `priceQuoteId`. */
const validRaw = (): Record<string, unknown> => ({
  priceQuoteId: "101",
  idempotencyKey: "idem-fix-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateLockFixation", () => {
  it("accepts a complete, well-formed fixation lock (priceQuoteId — the UI contract)", () => {
    const r = validateLockFixation(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.quoteId).toBe(101);
      expect(r.data.idempotencyKey).toBe("idem-fix-1");
    }
  });

  it("also accepts the legacy `quoteId` field name", () => {
    const r = validateLockFixation({ quoteId: "55", idempotencyKey: "idem-fix-2" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.quoteId).toBe(55);
  });

  it("rejects a missing / non-numeric / non-positive quote id", () => {
    expect(validateLockFixation({ ...validRaw(), priceQuoteId: "" }).ok).toBe(false);
    expect(validateLockFixation({ ...validRaw(), priceQuoteId: "abc" }).ok).toBe(false);
    expect(validateLockFixation({ ...validRaw(), priceQuoteId: "0" }).ok).toBe(false);
    expect(validateLockFixation({ ...validRaw(), priceQuoteId: "2.5" }).ok).toBe(false);
  });

  it("rejects a missing idempotency key", () => {
    const r = validateLockFixation({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("lockFixation", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await lockFixation(store, { ...validRaw(), priceQuoteId: "" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls lock_fixation with the exact snake_case envelope and returns the fixation id", async () => {
    const { store, rpc } = fakeStore({ data: 777, error: null });
    const result = await lockFixation(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("lock_fixation", {
      p_quote_id: 101,
      p_idempotency_key: "idem-fix-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fixationId).toBe(777);
  });

  it("surfaces the FIXATION REGIME GUARD as a friendly commodity-only message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        code: "23514",
        message:
          'fixation regime guard: quote 202 is a reserve quote — only a commodity "C" leg can be fixed',
      },
    });
    const result = await lockFixation(store, { ...validRaw(), priceQuoteId: "202" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/commodity|reserve/i);
      expect(result.message).not.toMatch(/fixation regime guard:|check_violation/);
    }
  });

  it("surfaces the must-be-accepted gate as a friendly message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        code: "23514",
        message:
          "quote 101 must be accepted (have a reservation) before fixation",
      },
    });
    const result = await lockFixation(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/accept|reserv/i);
  });

  it("surfaces a missing ICE 'C' mark to fix as a friendly message", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: 'no ICE "C" mark to fix for month 2026-12' },
    });
    const result = await lockFixation(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/mark|C|month/);
  });

  it("falls back to a labelled message for an unrecognised RPC failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "deadlock detected" },
    });
    const result = await lockFixation(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });
});
