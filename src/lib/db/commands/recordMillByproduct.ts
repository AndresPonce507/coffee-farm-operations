import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for recording one dry-milling byproduct stream (P3-S8 —
 * cascara/husk/chaff/screen-rejects/defects; ADR-002 — all writes flow through a
 * SECURITY DEFINER command RPC). Each byproduct is minted as ITS OWN sellable,
 * traceable `lots` node + a conserved `kind='byproduct'` lot_edge from the
 * parchment lot, so the SHIPPED `lot_edges_conserve_mass()` trigger guards it FOR
 * FREE — the mass guarantee is REUSED, never re-implemented (§1.4). `mill_byproducts`
 * is APPEND-ONLY (immutability triggers reject UPDATE/DELETE). The single write
 * door is `record_mill_byproduct` — tenant-clamped, idempotent on a tenant-qualified
 * key (never mints a SECOND node/edge on replay), appending a
 * `mill_byproduct_recorded` lot_event in the SAME txn. It RETURNS the minted
 * byproduct lot code.
 *
 * Symmetric twin of the read ports: a pure validator (`validateRecordMillByproduct`,
 * mirroring the `byproduct_kind` enum + the `kg > 0` CHECK) plus a thin command
 * (`recordMillByproduct`) calling the one `.rpc()` it needs (the
 * `RecordMillByproductStore` port), testable with no database. The idempotency key
 * is REQUIRED — the action/form layer mints a stable token.
 */

/** The `byproduct_kind` enum (P3-S6) — the sellable byproduct streams. */
export const MILL_BYPRODUCT_KINDS = [
  "husk",
  "chaff",
  "screen_rejects",
  "defects",
] as const;
export type MillByproductKind = (typeof MILL_BYPRODUCT_KINDS)[number];

/** Validated, domain-shaped byproduct args (camelCase). */
export interface RecordMillByproductInput {
  /** The open milling run this byproduct came off. */
  runId: number;
  /** Which byproduct stream — one of the `byproduct_kind` enum. */
  kind: MillByproductKind;
  /** Byproduct mass (kg) — the `kg > 0` CHECK; the conserve-mass trigger caps it. */
  kg: number;
  /** Exactly-once anchor — the DB dedupes on a tenant-qualified key. */
  idempotencyKey: string;
}

/** Is `v` one of the recognised `byproduct_kind` streams? */
function isMillByproductKind(v: string): v is MillByproductKind {
  return (MILL_BYPRODUCT_KINDS as readonly string[]).includes(v);
}

/**
 * Pure validation of a raw byproduct — mirrors the `mill_byproducts` constraints
 * (the `byproduct_kind` enum, `kg > 0`) so errors surface before the round-trip.
 * The append-only triggers + the reused `lot_edges_conserve_mass()` guard are the
 * actual enforcement (routing more byproduct than the parchment holds is rejected).
 */
export function validateRecordMillByproduct(
  raw: Record<string, unknown>,
): ValidationResult<RecordMillByproductInput> {
  const errors: Record<string, string> = {};

  const runId = toNumber(raw.runId);
  if (runId === null || runId <= 0 || !Number.isInteger(runId)) {
    errors.runId = "Choose a milling run.";
  }

  const kind = trimmed(raw.kind);
  if (!kind || !isMillByproductKind(kind)) {
    errors.kind = "Choose a valid byproduct stream.";
  }

  const kg = toNumber(raw.kg);
  if (kg === null || kg <= 0) {
    errors.kg = "Byproduct mass (kg) must be greater than 0.";
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      runId: runId as number,
      kind: kind as MillByproductKind,
      kg: kg as number,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (text — the minted lot code). */
interface RpcResult {
  data: string | number | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — the one `.rpc()` method `record_mill_byproduct` needs. */
export interface RecordMillByproductStore {
  rpc(
    fn: "record_mill_byproduct",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome: the minted byproduct lot code, or friendly/labelled errors. */
export type RecordMillByproductResult =
  | { ok: true; byproductLotCode: string }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `record_mill_byproduct` onto a family-readable
 * sentence — the RPC + the reused conserve-mass trigger are the real guard, but the
 * family must never see raw PG text. Returns null for anything unrecognised so the
 * caller can fall back to a generic message.
 */
export function friendlyRecordMillByproductError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  // The REUSED mass-conservation guard: routing more byproduct than the parchment holds.
  if (/mass conservation|conserv/.test(m)) {
    return "There isn't enough parchment mass left to record that byproduct. Re-check the weight.";
  }
  // Run no longer open — byproducts can only be recorded while the run is open.
  if (/while open|can only be recorded|run .* is (open|closed|finalized)|finalized/.test(m)) {
    return "This milling run is no longer open, so byproducts can't be added.";
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
 * Validate then record: calls `record_mill_byproduct` exactly once with the
 * snake_case argument envelope the SECURITY DEFINER RPC expects. Bad input never
 * reaches the RPC (friendly errors); the data-layer guards (mass conservation, a
 * closed run, an unknown run) surface as CLEAN, family-readable sentences, any other
 * failure surfaces labelled. Exactly-once on `idempotencyKey` — a replay returns the
 * same minted lot code with no second node/edge.
 */
export async function recordMillByproduct(
  store: RecordMillByproductStore,
  raw: Record<string, unknown>,
): Promise<RecordMillByproductResult> {
  const parsed = validateRecordMillByproduct(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("record_mill_byproduct", {
    p_run_id: parsed.data.runId,
    p_kind: parsed.data.kind,
    p_kg: parsed.data.kg,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyRecordMillByproductError(error) ??
        "This byproduct couldn't be recorded right now. Please check the details and try again.",
    };
  }
  if (data == null) {
    return {
      ok: false,
      message: "This byproduct couldn't be recorded right now. Please try again.",
    };
  }
  return { ok: true, byproductLotCode: String(data) };
}
