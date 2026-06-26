import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P3-S8 Server Actions — `recordMillPassAction` / `recordMillByproductAction`, the
 * two append-only write doors the mass-balance workspace drives. Server Actions are
 * the only driving port (ADR-002 — only ever invoked by an authenticated human
 * submitting a form; no untrusted inbound, rail §7).
 *
 * Drives each action with plain input objects against a mocked Supabase client,
 * proving:
 *   - a valid pass / byproduct APPENDS the right snake_case `p_*` envelope via the
 *     `record_mill_pass` / `record_mill_byproduct` SECDEF RPC (mill_passes /
 *     mill_byproducts have NO insert policy — a direct insert is RLS-denied),
 *   - the DB CHECK-shape rules are enforced app-side BEFORE a round-trip (a pass that
 *     emits more than it took, a pass-no < 1, an unknown machine/byproduct enum, a
 *     non-positive input/kg) — no wasted network hop, no append,
 *   - a labelled DB guard error (continuity broken, run-not-open, oversell) surfaces
 *     as a CLEAN { ok:false, error } — never a raw SQLSTATE leak.
 */

const getSupabaseMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => getSupabaseMock(),
}));

import {
  recordMillByproductAction,
  recordMillPassAction,
} from "@/app/(app)/mill/[runId]/balance/actions";

function makeClient(opts?: {
  pass?: { data: unknown; error: { message: string; code?: string } | null };
  byproduct?: {
    data: unknown;
    error: { message: string; code?: string } | null;
  };
}): { client: unknown; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn((name: string) => {
    if (name === "record_mill_pass") {
      return Promise.resolve(opts?.pass ?? { data: 7, error: null });
    }
    if (name === "record_mill_byproduct") {
      return Promise.resolve(opts?.byproduct ?? { data: "JC-805", error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
  return { client: { rpc }, rpc };
}

const passCall = (rpc: ReturnType<typeof vi.fn>) =>
  rpc.mock.calls.find((c) => c[0] === "record_mill_pass");
const bypCall = (rpc: ReturnType<typeof vi.fn>) =>
  rpc.mock.calls.find((c) => c[0] === "record_mill_byproduct");

const VALID_PASS = {
  runId: 712,
  passNo: 2,
  machineKind: "polisher" as const,
  inputKg: 880,
  outputKg: 850,
  rejectKg: 10,
  idempotencyKey: "k-pass-1",
};

const VALID_BYP = {
  runId: 712,
  kind: "husk" as const,
  kg: 80,
  idempotencyKey: "k-byp-1",
};

beforeEach(() => getSupabaseMock.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("recordMillPassAction", () => {
  it("appends a pass via record_mill_pass with the right p_* envelope", async () => {
    const { client, rpc } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await recordMillPassAction(VALID_PASS);

    expect(result).toEqual({ ok: true, passId: 7 });
    expect(rpc).toHaveBeenCalledWith("record_mill_pass", {
      p_run_id: 712,
      p_pass_no: 2,
      p_machine_kind: "polisher",
      p_input_kg: 880,
      p_output_kg: 850,
      p_reject_kg: 10,
      p_idempotency_key: "k-pass-1",
    });
  });

  it("rejects a pass whose clean output + reject exceeds input WITHOUT a round-trip (the per-pass mass CHECK, mirrored)", async () => {
    const { client, rpc } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await recordMillPassAction({
      ...VALID_PASS,
      outputKg: 880,
      rejectKg: 20, // 900 > 880 input
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/output|reject|input|exceed/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a pass number below 1 without a round-trip", async () => {
    const { client, rpc } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await recordMillPassAction({ ...VALID_PASS, passNo: 0 });

    expect(result.ok).toBe(false);
    expect(passCall(rpc)).toBeUndefined();
  });

  it("rejects an unknown machine-kind enum value without a round-trip", async () => {
    const { client, rpc } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await recordMillPassAction({
      ...VALID_PASS,
      machineKind: "teleporter" as never,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/machine/i);
    expect(passCall(rpc)).toBeUndefined();
  });

  it("rejects a non-positive input and a negative output/reject without a round-trip", async () => {
    const { client, rpc } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const badInput = await recordMillPassAction({ ...VALID_PASS, inputKg: 0 });
    const badOutput = await recordMillPassAction({
      ...VALID_PASS,
      outputKg: -1,
    });
    const badReject = await recordMillPassAction({
      ...VALID_PASS,
      rejectKg: -5,
    });

    expect(badInput.ok).toBe(false);
    expect(badOutput.ok).toBe(false);
    expect(badReject.ok).toBe(false);
    expect(passCall(rpc)).toBeUndefined();
  });

  it("rejects a NaN output without a round-trip", async () => {
    const { client, rpc } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await recordMillPassAction({
      ...VALID_PASS,
      outputKg: Number.NaN,
    });

    expect(result.ok).toBe(false);
    expect(passCall(rpc)).toBeUndefined();
  });

  it("rejects a blank idempotency key without a round-trip", async () => {
    const { client, rpc } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await recordMillPassAction({
      ...VALID_PASS,
      idempotencyKey: "   ",
    });

    expect(result.ok).toBe(false);
    expect(passCall(rpc)).toBeUndefined();
  });

  it("surfaces a labelled DB guard error (continuity broken, 23514) verbatim as a CLEAN result", async () => {
    const { client } = makeClient({
      pass: {
        data: null,
        error: {
          message: "mill-pass continuity broken: pass 2 input does not match",
          code: "23514",
        },
      },
    });
    getSupabaseMock.mockReturnValue(client);

    const result = await recordMillPassAction(VALID_PASS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("continuity broken");
      expect(result.error).not.toMatch(/SQLSTATE|23514/);
    }
  });

  it("maps an access-denied error (42501) to friendly copy (never the raw string)", async () => {
    const { client } = makeClient({
      pass: { data: null, error: { message: "permission denied for function", code: "42501" } },
    });
    getSupabaseMock.mockReturnValue(client);

    const result = await recordMillPassAction(VALID_PASS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toMatch(/permission denied|42501/);
      expect(result.error.length).toBeGreaterThan(0);
    }
  });
});

describe("recordMillByproductAction", () => {
  it("appends a byproduct via record_mill_byproduct, returning the minted lot code", async () => {
    const { client, rpc } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await recordMillByproductAction(VALID_BYP);

    expect(result).toEqual({ ok: true, byproductLotCode: "JC-805" });
    expect(rpc).toHaveBeenCalledWith("record_mill_byproduct", {
      p_run_id: 712,
      p_kind: "husk",
      p_kg: 80,
      p_idempotency_key: "k-byp-1",
    });
  });

  it("rejects an unknown byproduct-kind enum value without a round-trip", async () => {
    const { client, rpc } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const result = await recordMillByproductAction({
      ...VALID_BYP,
      kind: "gold" as never,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/kind|stream/i);
    expect(bypCall(rpc)).toBeUndefined();
  });

  it("rejects a non-positive kg without a round-trip", async () => {
    const { client, rpc } = makeClient();
    getSupabaseMock.mockReturnValue(client);

    const zero = await recordMillByproductAction({ ...VALID_BYP, kg: 0 });
    const neg = await recordMillByproductAction({ ...VALID_BYP, kg: -3 });

    expect(zero.ok).toBe(false);
    expect(neg.ok).toBe(false);
    expect(bypCall(rpc)).toBeUndefined();
  });

  it("surfaces a labelled oversell/guard error verbatim as a CLEAN result", async () => {
    const { client } = makeClient({
      byproduct: {
        data: null,
        error: {
          message: "lot_edges_conserve_mass: cannot route more than the parchment holds",
          code: "23514",
        },
      },
    });
    getSupabaseMock.mockReturnValue(client);

    const result = await recordMillByproductAction(VALID_BYP);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("conserve_mass");
  });
});
