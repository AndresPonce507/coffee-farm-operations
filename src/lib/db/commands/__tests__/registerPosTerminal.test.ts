import { describe, expect, it, vi } from "vitest";

import {
  registerPosTerminal,
  validateRegisterPosTerminal,
  type RegisterPosTerminalStore,
} from "@/lib/db/commands/registerPosTerminal";

/**
 * Pure-domain command test for the POS-terminal write door (P3-S14; ADR-002 — every
 * write flows through a SECURITY DEFINER RPC). This file does NOT touch a database: it
 * drives the command against a *fake store* stubbing the one method it calls,
 * `.rpc('register_pos_terminal', …)`, and proves (a) the friendly-validation seam,
 * (b) the exact snake_case argument envelope (incl. the optional `location` forwarding
 * as null), and (c) that a DB failure surfaces a clean labelled message, never raw
 * Postgres text. The tenant clamp + idempotent no-op re-register are the *real*
 * enforcement (proven by the migration's PGlite tests). Mirrors recordIceCQuote.test.ts.
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: RegisterPosTerminalStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as RegisterPosTerminalStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  code: "FARM-STORE",
  name: "Janson Farm Store",
  location: "Volcán",
  idempotencyKey: "idem-terminal-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateRegisterPosTerminal", () => {
  it("accepts a complete, well-formed terminal", () => {
    const r = validateRegisterPosTerminal(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.code).toBe("FARM-STORE");
      expect(r.data.name).toBe("Janson Farm Store");
      expect(r.data.location).toBe("Volcán");
      expect(r.data.idempotencyKey).toBe("idem-terminal-1");
    }
  });

  it("treats a blank location as 'not provided' (null)", () => {
    const r = validateRegisterPosTerminal({ ...validRaw(), location: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.location).toBeNull();
  });

  it("rejects a missing code", () => {
    const r = validateRegisterPosTerminal({ ...validRaw(), code: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.code).toBeDefined();
  });

  it("rejects a missing name", () => {
    const r = validateRegisterPosTerminal({ ...validRaw(), name: "  " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.name).toBeDefined();
  });

  it("rejects a missing idempotency key", () => {
    const r = validateRegisterPosTerminal({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("registerPosTerminal", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await registerPosTerminal(store, { ...validRaw(), code: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.code).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls register_pos_terminal with the exact snake_case envelope and returns the terminal id", async () => {
    const { store, rpc } = fakeStore({ data: 5, error: null });
    const result = await registerPosTerminal(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("register_pos_terminal", {
      p_code: "FARM-STORE",
      p_name: "Janson Farm Store",
      p_location: "Volcán",
      p_idempotency_key: "idem-terminal-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.terminalId).toBe(5);
  });

  it("forwards a null p_location when the location is blank", async () => {
    const { store, rpc } = fakeStore({ data: 6, error: null });
    await registerPosTerminal(store, { ...validRaw(), location: "" });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_location).toBeNull();
  });

  it("coerces a string id from PostgREST to a number", async () => {
    const { store } = fakeStore({ data: "9", error: null });
    const result = await registerPosTerminal(store, validRaw());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.terminalId).toBe(9);
  });

  it("surfaces a labelled error (never raw PG) when the RPC fails", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "permission denied for function register_pos_terminal" },
    });
    const result = await registerPosTerminal(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBeTruthy();
      expect(result.message).toContain("permission denied");
    }
  });
});
