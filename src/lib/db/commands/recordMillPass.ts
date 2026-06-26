import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for appending one dry-milling machine pass (P3-S8 — the
 * ordered machine chain + the closed mass balance; ADR-002 — all writes flow
 * through a SECURITY DEFINER command RPC). `mill_passes` is APPEND-ONLY
 * (immutability triggers reject UPDATE/DELETE): a correction is a corrective run,
 * never an edit. The single write door is `record_mill_pass` — tenant-clamped,
 * idempotent on a tenant-qualified key, appending a `mill_pass_recorded` lot_event
 * in the SAME txn.
 *
 * THE INVARIANTS the RPC + the table enforce (the data layer, not just this
 * command): a single machine can't emit (clean output + reject) more than it took
 * (the per-pass mass-balance CHECK), and the clean stream is contiguous — pass N's
 * input equals pass N−1's output (pass 1 == the run's parchment intake; the in-RPC
 * cross-pass continuity check). Passes can only be recorded while the run is OPEN.
 *
 * Symmetric twin of the read ports: a pure validator (`validateRecordMillPass`,
 * which mirrors the CHECKs so errors surface before the round-trip) plus a thin
 * command (`recordMillPass`) calling the one `.rpc()` it needs (the
 * `RecordMillPassStore` port), testable with no database. The idempotency key is
 * REQUIRED — the action/form layer mints a stable token.
 */

/** The `pass_type` enum (P3-S6) — the dry-mill machine kinds, in chain order. */
export const MILL_PASS_MACHINE_KINDS = [
  "huller",
  "polisher",
  "screen_grader",
  "gravity_table",
  "optical_sorter",
] as const;
export type MillPassMachineKind = (typeof MILL_PASS_MACHINE_KINDS)[number];

/** Validated, domain-shaped machine-pass args (camelCase). */
export interface RecordMillPassInput {
  /** The open milling run this pass belongs to. */
  runId: number;
  /** 1-based position in the machine chain (the `pass_no >= 1` CHECK). */
  passNo: number;
  /** Which machine — one of the `pass_type` enum. */
  machineKind: MillPassMachineKind;
  /** Mass fed into the machine (kg) — the `input_kg > 0` CHECK guards it. */
  inputKg: number;
  /** Clean mass out (kg) — the `output_kg >= 0` CHECK. */
  outputKg: number;
  /** Reject/screen-out mass (kg) — the `reject_kg >= 0` CHECK; blank ⇒ 0. */
  rejectKg: number;
  /** Exactly-once anchor — the DB dedupes on a tenant-qualified key. */
  idempotencyKey: string;
}

/** Is `v` one of the recognised `pass_type` machine kinds? */
function isMillPassMachineKind(v: string): v is MillPassMachineKind {
  return (MILL_PASS_MACHINE_KINDS as readonly string[]).includes(v);
}

/** Is `v` blank (absent / empty after trim)? */
function isBlank(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "");
}

/**
 * Pure validation of a raw machine pass — mirrors the `mill_passes` CHECKs
 * (`pass_no >= 1`, `input_kg > 0`, `output_kg >= 0`, `reject_kg >= 0`, and the
 * per-pass mass balance `output_kg + reject_kg <= input_kg + 1e-9`) so errors
 * surface before the round-trip. The table CHECKs + the RPC's continuity guard are
 * the actual enforcement.
 */
export function validateRecordMillPass(
  raw: Record<string, unknown>,
): ValidationResult<RecordMillPassInput> {
  const errors: Record<string, string> = {};

  const runId = toNumber(raw.runId);
  if (runId === null || runId <= 0 || !Number.isInteger(runId)) {
    errors.runId = "Choose a milling run.";
  }

  const passNo = toNumber(raw.passNo);
  if (passNo === null || passNo < 1 || !Number.isInteger(passNo)) {
    errors.passNo = "Pass number must be a whole number, 1 or greater.";
  }

  const machineKind = trimmed(raw.machineKind);
  if (!machineKind || !isMillPassMachineKind(machineKind)) {
    errors.machineKind = "Choose a valid machine.";
  }

  const inputKg = toNumber(raw.inputKg);
  if (inputKg === null || inputKg <= 0) {
    errors.inputKg = "Input mass (kg) must be greater than 0.";
  }

  const outputKg = toNumber(raw.outputKg);
  if (outputKg === null || outputKg < 0) {
    errors.outputKg = "Output mass (kg) can't be negative.";
  }

  // reject is optional; blank ⇒ 0. If provided it must be >= 0.
  let rejectKg = 0;
  if (!isBlank(raw.rejectKg)) {
    const rj = toNumber(raw.rejectKg);
    if (rj === null || rj < 0) errors.rejectKg = "Reject mass (kg) can't be negative.";
    else rejectKg = rj;
  }

  // The per-pass mass-balance CHECK (only when the legs parsed): a machine can't
  // emit more (clean output + reject) than it took in. 1e-9 absorbs float dust.
  if (
    inputKg !== null &&
    outputKg !== null &&
    !errors.inputKg &&
    !errors.outputKg &&
    !errors.rejectKg &&
    outputKg + rejectKg > inputKg + 1e-9
  ) {
    errors.outputKg = "A pass can't output more (clean + reject) than it took in.";
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      runId: runId as number,
      passNo: passNo as number,
      machineKind: machineKind as MillPassMachineKind,
      inputKg: inputKg as number,
      outputKg: outputKg as number,
      rejectKg,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint pass id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method `record_mill_pass` needs. */
export interface RecordMillPassStore {
  rpc(
    fn: "record_mill_pass",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the appended pass's id, or friendly/labelled errors. */
export type RecordMillPassResult =
  | { ok: true; passId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `record_mill_pass` onto a family-readable sentence
 * — the RPC/table are the real guard, but the family must never see raw PG text
 * (constraint names, errcodes, the function body's continuity prefix). Returns null
 * for anything unrecognised so the caller can fall back to a generic message.
 */
export function friendlyRecordMillPassError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  // Cross-pass continuity: pass N input must equal pass N−1 output / parchment in.
  if (/continuity/.test(m)) {
    return "This pass doesn't line up with the previous machine's output (or the run's parchment intake). Re-check the input weight.";
  }
  // The per-pass mass-balance CHECK (clean output + reject > input).
  if (/mass_balance|mass balance/.test(m)) {
    return "A machine can't emit more (clean output + rejects) than it took in. Re-check the weights.";
  }
  // Run no longer open — passes can only be recorded while the run is open.
  if (/while open|can only be recorded|run .* is (open|closed|finalized)|finalized/.test(m)) {
    return "This milling run is no longer open, so passes can't be added.";
  }
  // Duplicate pass number for the run.
  if (error.code === "23505" || /run_pass_ux|already/.test(m)) {
    return "That pass number is already recorded for this run.";
  }
  // Unknown run.
  if (
    error.code === "23503" ||
    error.code === "foreign_key_violation" ||
    /unknown milling run|foreign key/.test(m)
  ) {
    return "That milling run couldn't be found. Pick a run from the list and try again.";
  }
  return null;
}

/**
 * Validate then append: calls `record_mill_pass` exactly once with the snake_case
 * argument envelope the SECURITY DEFINER RPC expects. Bad input never reaches the
 * RPC (friendly errors); the data-layer guards (continuity, the mass CHECK, a closed
 * run, a duplicate pass, an unknown run) surface as CLEAN, family-readable sentences,
 * any other failure surfaces labelled. Exactly-once on `idempotencyKey`.
 */
export async function recordMillPass(
  store: RecordMillPassStore,
  raw: Record<string, unknown>,
): Promise<RecordMillPassResult> {
  const parsed = validateRecordMillPass(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("record_mill_pass", {
    p_run_id: parsed.data.runId,
    p_pass_no: parsed.data.passNo,
    p_machine_kind: parsed.data.machineKind,
    p_input_kg: parsed.data.inputKg,
    p_output_kg: parsed.data.outputKg,
    p_reject_kg: parsed.data.rejectKg,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyRecordMillPassError(error) ??
        "This pass couldn't be recorded right now. Please check the details and try again.",
    };
  }
  if (data == null) {
    return {
      ok: false,
      message: "This pass couldn't be recorded right now. Please try again.",
    };
  }
  return { ok: true, passId: Number(data) };
}
