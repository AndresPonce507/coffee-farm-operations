import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for the P3-S19 correction path (`revise_accolade`). A cup score
 * is NEVER edited: a revision posts a 'score-revision' REVERSING row whose
 * `reverses_id` points at the original; the original stays on the append-only ledger,
 * just superseded (excluded from the net-live `v_lot_reputation` view) — the
 * cost_entry/revenue_entry idiom. The single write door is `revise_accolade` —
 * SECURITY DEFINER, tenant-clamped, idempotent on a tenant-qualified key, appending a
 * `lot_event` onto the lot's chain in the same txn.
 *
 * Symmetric twin of the read port: a pure validator (`validateReviseAccolade`) plus a
 * thin command (`reviseAccolade`) calling the one `.rpc()` method it needs (the
 * `ReviseAccoladeStore` port), testable with no database. The fail-fast guards mirror
 * the RPC: a revision must carry a score in [0,100] and name a real original; the
 * already-revised / unknown-original / wrong-kind guards are the SECURITY DEFINER
 * RPC's job (the migration's PGlite tests).
 */

/** Is `v` blank (absent / empty after trim)? `Number("")` is 0, so a required numeric
 *  must reject blank BEFORE coercion or an empty field silently reads as a 0 score. */
function isBlank(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "");
}

/** Validated, domain-shaped revision args (camelCase). `note` is null when blank. */
export interface ReviseAccoladeInput {
  /** The original accolade this revision supersedes (its `reverses_id`). */
  accoladeId: number;
  /** The corrected cup score — [0,100] (the score-revision range guard). */
  newScore: number;
  note: string | null;
  idempotencyKey: string;
}

/**
 * Pure validation of a raw revision — mirrors the `revise_accolade` guards (a real
 * positive original id; a corrected score in [0,100]) so errors surface before the
 * round-trip. The already-revised / unknown-original / only-a-cup-score-can-be-revised
 * guards are enforced in the RPC (they need a DB read).
 */
export function validateReviseAccolade(
  raw: Record<string, unknown>,
): ValidationResult<ReviseAccoladeInput> {
  const errors: Record<string, string> = {};

  const id = toNumber(raw.accoladeId);
  if (id === null || !Number.isInteger(id) || id <= 0) {
    errors.accoladeId = "Pick the accolade to revise.";
  }

  let newScore: number | null = null;
  if (isBlank(raw.newScore)) {
    errors.newScore = "A revised score is required.";
  } else {
    const s = toNumber(raw.newScore);
    if (s === null || s < 0 || s > 100) {
      errors.newScore = "The revised score must be between 0 and 100.";
    } else {
      newScore = s;
    }
  }

  const note = trimmed(raw.note);

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      accoladeId: id as number,
      newScore: newScore as number,
      note: note === "" ? null : note,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port the command depends on — exactly the one `.rpc()` method
 *  `revise_accolade` needs. */
export interface ReviseAccoladeStore {
  rpc(
    fn: "revise_accolade",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the posted revision's id, or friendly/labelled errors. */
export type ReviseAccoladeResult =
  | { ok: true; accoladeId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Validate then post: calls `revise_accolade` exactly once with the snake_case `p_`
 * argument envelope. Bad input never reaches the RPC (friendly errors); a failure —
 * including the already-revised guard — surfaces labelled (raw Postgres text never
 * leaks). Exactly-once on `idempotencyKey`.
 */
export async function reviseAccolade(
  store: ReviseAccoladeStore,
  raw: Record<string, unknown>,
): Promise<ReviseAccoladeResult> {
  const parsed = validateReviseAccolade(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("revise_accolade", {
    p_accolade_id: parsed.data.accoladeId,
    p_new_score: parsed.data.newScore,
    p_note: parsed.data.note,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return { ok: false, message: `Couldn't revise the accolade: ${error.message}` };
  }
  if (data == null) {
    return { ok: false, message: "The revision couldn't be posted. Please try again." };
  }
  return { ok: true, accoladeId: Number(data) };
}
