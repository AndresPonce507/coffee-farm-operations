import { describe, expect, it, vi } from "vitest";

import {
  reviseAccolade,
  validateReviseAccolade,
  type ReviseAccoladeStore,
} from "@/lib/db/commands/reviseAccolade";

/**
 * Pure-domain command test for the P3-S19 correction path (`revise_accolade`). A
 * revision is the ONLY way to change a cup score: it posts a 'score-revision'
 * REVERSING row (reverses_id → the original); the original is NEVER edited, just
 * superseded — the cost_entry/revenue_entry append-only idiom. This drives the
 * command against a fake `.rpc('revise_accolade', …)` store and proves the
 * fail-fast validation (a revision must carry a score in [0,100], a real original
 * id), the exact snake_case `p_` envelope, and clean error surfacing. The
 * already-revised / unknown-original / wrong-kind guards live in the SECURITY
 * DEFINER RPC (the migration's PGlite tests).
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: ReviseAccoladeStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as ReviseAccoladeStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  accoladeId: "5",
  newScore: "90.25",
  note: "Re-cupped after rest; corrected.",
  idempotencyKey: "idem-rev-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateReviseAccolade", () => {
  it("accepts a complete revision", () => {
    const r = validateReviseAccolade(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.accoladeId).toBe(5);
      expect(r.data.newScore).toBe(90.25);
      expect(r.data.note).toBe("Re-cupped after rest; corrected.");
    }
  });

  it("rejects a non-positive / non-integer accolade id", () => {
    const zero = validateReviseAccolade({ ...validRaw(), accoladeId: "0" });
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.errors.accoladeId).toBeDefined();
    const frac = validateReviseAccolade({ ...validRaw(), accoladeId: "5.5" });
    expect(frac.ok).toBe(false);
  });

  it("rejects a missing new score", () => {
    const r = validateReviseAccolade({ ...validRaw(), newScore: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.newScore).toBeDefined();
  });

  it("rejects a new score outside [0,100]", () => {
    const r = validateReviseAccolade({ ...validRaw(), newScore: "101" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.newScore).toMatch(/0.*100/);
  });

  it("rejects a missing idempotency key", () => {
    const r = validateReviseAccolade({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });

  it("forwards a blank note as null", () => {
    const r = validateReviseAccolade({ ...validRaw(), note: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.note).toBeNull();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("reviseAccolade", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await reviseAccolade(store, { ...validRaw(), newScore: "" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls revise_accolade with the exact snake_case envelope and returns the id", async () => {
    const { store, rpc } = fakeStore({ data: 12, error: null });
    const result = await reviseAccolade(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("revise_accolade", {
      p_accolade_id: 5,
      p_new_score: 90.25,
      p_note: "Re-cupped after rest; corrected.",
      p_idempotency_key: "idem-rev-1",
    });
    expect(result).toEqual({ ok: true, accoladeId: 12 });
  });

  it("coerces a string id from PostgREST to a number", async () => {
    const { store } = fakeStore({ data: "13", error: null });
    const result = await reviseAccolade(store, validRaw());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.accoladeId).toBe(13);
  });

  it("surfaces a labelled error when the RPC fails (already-revised guard)", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        message: "accolade 5 has already been revised; revise the latest revision instead",
        code: "23514",
      },
    });
    const result = await reviseAccolade(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("already been revised");
  });

  it("reports a try-again message when the RPC returns no id", async () => {
    const { store } = fakeStore({ data: null, error: null });
    const result = await reviseAccolade(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/try again/i);
  });
});
