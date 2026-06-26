import { describe, expect, it, vi } from "vitest";

import {
  friendlyRecordMillPassError,
  recordMillPass,
  validateRecordMillPass,
  type RecordMillPassStore,
} from "@/lib/db/commands/recordMillPass";

/**
 * Pure-domain command test for the dry-milling machine-pass writer (P3-S8 — the
 * ordered machine chain + the closed mass balance; ADR-002 — every write flows
 * through a SECURITY DEFINER RPC). Drives the command against a fake
 * `.rpc('record_mill_pass', …)` store (no database) and proves:
 *   - the friendly-validation seam mirrors the table's CHECKs (pass_no >= 1,
 *     input_kg > 0, output_kg >= 0, the per-pass mass balance
 *     `output_kg + reject_kg <= input_kg + 1e-9`),
 *   - the exact snake_case argument envelope `record_mill_pass` expects,
 *   - that the DATA-LAYER guards (cross-pass continuity, run-not-open, the mass
 *     CHECK, the duplicate-pass uniqueness, an unknown run) surface CLEAN,
 *     family-readable sentences instead of raw Postgres text.
 * The triggers/RPC are the REAL enforcement (pinned by the migration's PGlite
 * tests, s8_mill_passes.db.test.ts); this proves the friendly surface. Mirrors
 * quoteCommodityPrice.test.ts / recordIceCQuote.test.ts.
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: RecordMillPassStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as RecordMillPassStore, rpc };
}

/** A complete, valid raw pass — 1000 kg parchment in, 900 clean + 20 reject. */
const validRaw = (): Record<string, unknown> => ({
  runId: "7",
  passNo: "1",
  machineKind: "huller",
  inputKg: "1000",
  outputKg: "900",
  rejectKg: "20",
  idempotencyKey: "idem-pass-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateRecordMillPass", () => {
  it("accepts a complete, well-formed pass", () => {
    const r = validateRecordMillPass(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.runId).toBe(7);
      expect(r.data.passNo).toBe(1);
      expect(r.data.machineKind).toBe("huller");
      expect(r.data.inputKg).toBe(1000);
      expect(r.data.outputKg).toBe(900);
      expect(r.data.rejectKg).toBe(20);
      expect(r.data.idempotencyKey).toBe("idem-pass-1");
    }
  });

  it("defaults a blank reject_kg to 0 (the table default)", () => {
    const r = validateRecordMillPass({ ...validRaw(), rejectKg: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.rejectKg).toBe(0);
  });

  it("accepts every pass_type machine kind", () => {
    for (const k of [
      "huller",
      "polisher",
      "screen_grader",
      "gravity_table",
      "optical_sorter",
    ]) {
      const r = validateRecordMillPass({ ...validRaw(), machineKind: k });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.machineKind).toBe(k);
    }
  });

  it("rejects an unknown machine kind (not in the pass_type enum)", () => {
    const r = validateRecordMillPass({ ...validRaw(), machineKind: "blender" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.machineKind).toBeDefined();
  });

  it("rejects a pass number below 1 (the pass_no >= 1 CHECK)", () => {
    const r = validateRecordMillPass({ ...validRaw(), passNo: "0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.passNo).toBeDefined();
  });

  it("rejects a non-integer pass number", () => {
    const r = validateRecordMillPass({ ...validRaw(), passNo: "1.5" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.passNo).toBeDefined();
  });

  it("rejects a non-positive input_kg (the input_kg > 0 CHECK)", () => {
    const r = validateRecordMillPass({ ...validRaw(), inputKg: "0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.inputKg).toMatch(/greater than 0/i);
  });

  it("rejects a negative output_kg (the output_kg >= 0 CHECK)", () => {
    const r = validateRecordMillPass({ ...validRaw(), outputKg: "-1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.outputKg).toBeDefined();
  });

  it("rejects a negative reject_kg (the reject_kg >= 0 CHECK)", () => {
    const r = validateRecordMillPass({ ...validRaw(), rejectKg: "-5" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.rejectKg).toBeDefined();
  });

  it("rejects output+reject exceeding input (the per-pass mass-balance CHECK)", () => {
    // 990 clean + 20 reject = 1010 > 1000 in — a machine can't emit more than it took.
    const r = validateRecordMillPass({
      ...validRaw(),
      outputKg: "990",
      rejectKg: "20",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.outputKg).toMatch(/more than|took in|input/i);
  });

  it("allows output+reject exactly equal to input (boundary, zero loss)", () => {
    const r = validateRecordMillPass({
      ...validRaw(),
      outputKg: "980",
      rejectKg: "20",
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a non-positive run id", () => {
    const r = validateRecordMillPass({ ...validRaw(), runId: "0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.runId).toBeDefined();
  });

  it("rejects a missing idempotency key", () => {
    const r = validateRecordMillPass({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── friendly-error mapping ────────────────────────

describe("friendlyRecordMillPassError", () => {
  it("maps the cross-pass continuity break to a re-check-input sentence", () => {
    const m = friendlyRecordMillPassError({
      code: "23514",
      message:
        "mill-pass continuity broken: pass 2 input 850.0000 kg does not match the expected 900.0000 kg (prior output / parchment in)",
    });
    expect(m).toBeTruthy();
    expect(m).toMatch(/line up|previous|input/i);
    expect(m).not.toMatch(/continuity broken|check_violation/);
  });

  it("maps a closed/finalized run to a 'no longer open' sentence", () => {
    const m = friendlyRecordMillPassError({
      code: "P0001",
      message:
        "milling run 7 is finalized — passes can only be recorded while open",
    });
    expect(m).toBeTruthy();
    expect(m).toMatch(/open|closed|finalized/i);
  });

  it("maps the per-pass mass-balance CHECK constraint to a clean sentence", () => {
    const m = friendlyRecordMillPassError({
      code: "23514",
      message:
        'new row for relation "mill_passes" violates check constraint "mill_passes_mass_balance_chk"',
    });
    expect(m).toBeTruthy();
    expect(m).toMatch(/more|output|took|emit/i);
    expect(m).not.toMatch(/mill_passes_mass_balance_chk/);
  });

  it("maps the duplicate pass-number uniqueness to an 'already recorded' sentence", () => {
    const m = friendlyRecordMillPassError({
      code: "23505",
      message:
        'duplicate key value violates unique constraint "mill_passes_run_pass_ux"',
    });
    expect(m).toBeTruthy();
    expect(m).toMatch(/already|recorded|pass/i);
    expect(m).not.toMatch(/mill_passes_run_pass_ux/);
  });

  it("maps an unknown run to a 'couldn't be found' sentence", () => {
    const m = friendlyRecordMillPassError({
      code: "foreign_key_violation",
      message: "unknown milling run 999",
    });
    expect(m).toBeTruthy();
    expect(m).toMatch(/found|run/i);
  });

  it("returns null for an unrecognised error (caller falls back to generic)", () => {
    expect(
      friendlyRecordMillPassError({ message: "deadlock detected" }),
    ).toBeNull();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("recordMillPass", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await recordMillPass(store, { ...validRaw(), runId: "0" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.runId).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls record_mill_pass with the exact snake_case envelope and returns the pass id", async () => {
    const { store, rpc } = fakeStore({ data: 42, error: null });
    const result = await recordMillPass(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_mill_pass", {
      p_run_id: 7,
      p_pass_no: 1,
      p_machine_kind: "huller",
      p_input_kg: 1000,
      p_output_kg: 900,
      p_reject_kg: 20,
      p_idempotency_key: "idem-pass-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.passId).toBe(42);
  });

  it("forwards p_reject_kg 0 when reject is blank", async () => {
    const { store, rpc } = fakeStore({ data: 1, error: null });
    await recordMillPass(store, { ...validRaw(), rejectKg: "" });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_reject_kg).toBe(0);
  });

  it("coerces a string id from PostgREST to a number", async () => {
    const { store } = fakeStore({ data: "43", error: null });
    const result = await recordMillPass(store, validRaw());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.passId).toBe(43);
  });

  it("surfaces the continuity break as a friendly (non-raw) message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        code: "23514",
        message:
          "mill-pass continuity broken: pass 2 input 850.0000 kg does not match the expected 900.0000 kg (prior output / parchment in)",
      },
    });
    const result = await recordMillPass(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/line up|previous|input/i);
      expect(result.message).not.toMatch(/continuity broken/);
    }
  });

  it("surfaces a closed run as a friendly message", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        message:
          "milling run 7 is finalized — passes can only be recorded while open",
      },
    });
    const result = await recordMillPass(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/open|closed|finalized/i);
  });

  it("falls back to a labelled message for an unrecognised RPC failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "deadlock detected" },
    });
    const result = await recordMillPass(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });

  it("surfaces a labelled error when the RPC returns no id", async () => {
    const { store } = fakeStore({ data: null, error: null });
    const result = await recordMillPass(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });
});
