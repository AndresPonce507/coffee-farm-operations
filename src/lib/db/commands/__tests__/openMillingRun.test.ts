import { describe, expect, it, vi } from "vitest";

import {
  openMillingRun,
  validateOpenMillingRun,
  friendlyOpenMillingRunError,
  type OpenMillingRunStore,
} from "@/lib/db/commands/openMillingRun";

/**
 * Pure-domain command test for THE no-mill-out-of-spec gate writer (P3-S7 — mill
 * readiness + run skeleton; ADR-002 — every write flows through a SECURITY DEFINER RPC).
 * This file does NOT touch a database: it drives the command against a *fake store*
 * stubbing the one method it calls, `.rpc('open_milling_run', …)`, and proves
 * (a) the friendly-validation seam (parchment_kg_in > 0 — the table CHECK), (b) the exact
 * snake_case argument envelope, and (c) — the LOAD-BEARING one — that the keystone gate's
 * rejection (`open_milling_run` RAISES check_violation when NO passing `mill_readiness`
 * row exists) surfaces as a CLEAN, family-readable sentence, never raw Postgres text. The
 * gate itself (the `passed=true` precondition, the reposo snapshot) is the migration's job,
 * pinned by its PGlite tests; this command only translates the rejection.
 *
 * Mirrors the established command-test idiom (acceptQuote.test.ts / quoteCommodityPrice.test.ts):
 * the idempotency key is REQUIRED (the action/form layer mints a stable token).
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: OpenMillingRunStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as OpenMillingRunStore, rpc };
}

/** A complete, valid raw open-run request — the happy-path baseline each case tweaks. */
const validRaw = (): Record<string, unknown> => ({
  parchmentLotCode: "JC-204",
  parchmentKgIn: "1200",
  idempotencyKey: "idem-open-run-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateOpenMillingRun", () => {
  it("accepts a complete, well-formed open-run request", () => {
    const r = validateOpenMillingRun(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.parchmentLotCode).toBe("JC-204");
      expect(r.data.parchmentKgIn).toBe(1200);
      expect(r.data.idempotencyKey).toBe("idem-open-run-1");
    }
  });

  it("rejects a missing parchment lot", () => {
    const r = validateOpenMillingRun({ ...validRaw(), parchmentLotCode: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.parchmentLotCode).toBeDefined();
  });

  it("rejects a non-positive parchment_kg_in (the kg_in > 0 CHECK)", () => {
    const zero = validateOpenMillingRun({ ...validRaw(), parchmentKgIn: "0" });
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.errors.parchmentKgIn).toMatch(/greater than 0/i);

    const neg = validateOpenMillingRun({ ...validRaw(), parchmentKgIn: "-5" });
    expect(neg.ok).toBe(false);
  });

  it("rejects a non-numeric parchment_kg_in", () => {
    const r = validateOpenMillingRun({ ...validRaw(), parchmentKgIn: "heavy" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.parchmentKgIn).toBeDefined();
  });

  it("rejects a missing idempotency key", () => {
    const r = validateOpenMillingRun({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── friendly-error seam ───────────────────────────

describe("friendlyOpenMillingRunError", () => {
  it("translates THE keystone gate rejection (no passing readiness) into a plain sentence", () => {
    const msg = friendlyOpenMillingRunError({
      code: "23514",
      message:
        "no-mill-out-of-spec: parchment lot JC-204 has no passing mill_readiness (need moisture 10.5-11.5%, aw < 0.60, and reposo cleared) — cannot open a milling run",
    });
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/readiness|reposo|spec|ready to mill/i);
    expect(msg).not.toMatch(/no-mill-out-of-spec:|mill_readiness|23514/);
  });

  it("translates an unknown parchment lot (FK) into a plain sentence", () => {
    const msg = friendlyOpenMillingRunError({
      code: "23503",
      message:
        'insert or update on table "milling_runs" violates foreign key constraint "milling_runs_parchment_lot_tfk"',
    });
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/couldn't be found|lot/i);
  });

  it("returns null for an unrecognised error (caller falls back to generic)", () => {
    expect(
      friendlyOpenMillingRunError({ message: "deadlock detected" }),
    ).toBeNull();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("openMillingRun", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await openMillingRun(store, { ...validRaw(), parchmentKgIn: "0" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls open_milling_run with the exact snake_case envelope and returns the run id", async () => {
    const { store, rpc } = fakeStore({ data: 5, error: null });
    const result = await openMillingRun(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("open_milling_run", {
      p_parchment_lot_code: "JC-204",
      p_parchment_kg_in: 1200,
      p_idempotency_key: "idem-open-run-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.runId).toBe(5);
  });

  it("coerces a string id from PostgREST to a number", async () => {
    const { store } = fakeStore({ data: "8", error: null });
    const result = await openMillingRun(store, validRaw());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.runId).toBe(8);
  });

  it("surfaces THE keystone gate rejection as a friendly message (no raw PG text)", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        code: "23514",
        message:
          "no-mill-out-of-spec: parchment lot JC-204 has no passing mill_readiness (need moisture 10.5-11.5%, aw < 0.60, and reposo cleared) — cannot open a milling run",
      },
    });
    const result = await openMillingRun(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/readiness|reposo|spec|ready to mill/i);
      expect(result.message).not.toMatch(/no-mill-out-of-spec:|mill_readiness|23514/);
    }
  });

  it("surfaces an unknown parchment lot as a friendly message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        code: "23503",
        message:
          'insert or update on table "milling_runs" violates foreign key constraint',
      },
    });
    const result = await openMillingRun(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/couldn't be found|lot/i);
  });

  it("falls back to a labelled message for an unrecognised RPC failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "deadlock detected" },
    });
    const result = await openMillingRun(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBeTruthy();
      expect(result.message).not.toMatch(/deadlock detected/);
    }
  });
});
