import { trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for registering a POS terminal (P3-S14 — the offline DGI
 * farm-store/café POS; ADR-002 — all writes flow through a SECURITY DEFINER command
 * RPC). The single write door is `register_pos_terminal` — tenant-clamped, idempotent
 * on a tenant-qualified key AND a no-op re-register on an existing `code` (a fresh
 * device re-registering the same till returns the existing terminal id, never a
 * duplicate). The terminals are the Janson Farm Store and the Lagunas Café tills.
 *
 * Symmetric twin of the read ports: a pure validator (`validateRegisterPosTerminal`,
 * the friendly-error seam) plus a thin command (`registerPosTerminal`) that calls the
 * single `.rpc()` method it needs (the `RegisterPosTerminalStore` port) so it is
 * testable against a fake store with no database. The idempotency key is REQUIRED —
 * the action/form layer mints a stable token (mirrors recordIceCQuote). `location` is
 * OPTIONAL — a blank forwards null.
 */

/** Validated, domain-shaped terminal args (camelCase). */
export interface RegisterPosTerminalInput {
  /** Stable terminal code, e.g. 'FARM-STORE' / 'CAFE' (the per-tenant UNIQUE key). */
  code: string;
  /** Human terminal name, e.g. 'Janson Farm Store'. */
  name: string;
  /** Where the till lives; null ⇒ not provided. */
  location: string | null;
  /** Exactly-once anchor — the DB dedupes on a tenant-qualified key. */
  idempotencyKey: string;
}

/**
 * Pure validation of a raw terminal — mirrors the `register_pos_terminal` /
 * `pos_terminals` constraints (code + name required, the per-tenant code UNIQUE) so
 * errors surface before the round-trip. The tenant clamp + the idempotent no-op
 * re-register are the actual enforcement (ADR-002).
 */
export function validateRegisterPosTerminal(
  raw: Record<string, unknown>,
): ValidationResult<RegisterPosTerminalInput> {
  const errors: Record<string, string> = {};

  const code = trimmed(raw.code);
  if (!code) errors.code = "A terminal code is required.";

  const name = trimmed(raw.name);
  if (!name) errors.name = "A terminal name is required.";

  // location: optional → blank forwards null.
  const rawLocation = trimmed(raw.location);
  const location: string | null = rawLocation || null;

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: { code, name, location, idempotencyKey },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint terminal id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/**
 * The narrow write port the command depends on — exactly the one `.rpc()` method
 * `register_pos_terminal` needs. A Supabase client satisfies this structurally; a
 * hand-rolled stub satisfies it in pure-domain tests.
 */
export interface RegisterPosTerminalStore {
  rpc(
    fn: "register_pos_terminal",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the terminal id, or friendly/labelled errors. */
export type RegisterPosTerminalResult =
  | { ok: true; terminalId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Validate then register: calls `register_pos_terminal` exactly once with the
 * snake_case argument envelope the SECURITY DEFINER RPC expects. Bad input never
 * reaches the RPC (friendly errors); a failure surfaces as a labelled message (raw
 * Postgres text never leaks). Idempotent — a replay (or a re-register of an existing
 * code) returns the same terminal id with no second insert.
 */
export async function registerPosTerminal(
  store: RegisterPosTerminalStore,
  raw: Record<string, unknown>,
): Promise<RegisterPosTerminalResult> {
  const parsed = validateRegisterPosTerminal(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("register_pos_terminal", {
    p_code: parsed.data.code,
    p_name: parsed.data.name,
    p_location: parsed.data.location,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message: `Couldn't register the terminal: ${error.message}`,
    };
  }
  if (data == null) {
    return {
      ok: false,
      message: "The terminal couldn't be registered. Please try again.",
    };
  }
  return { ok: true, terminalId: Number(data) };
}
