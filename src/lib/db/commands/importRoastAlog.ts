import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for the $0 Artisan .alog capture path (P3-S10 — roasting;
 * ADR-002). `import_roast_alog` parses a normalized .alog jsonb
 * ({points:[{t,bt,et,ror}], events:[{marker,t,temp}]}), inserts the APPEND-ONLY curve
 * points + phase markers, and computes the max |BT − interpolated golden target| — a
 * receipt RECORDED as evidence. No untrusted inbound drives a downstream write (rail 7):
 * the .alog is captured, but a human runs finalize/link. The RPC is idempotent on a
 * tenant-qualified key (a replay returns the same import id, no second insert).
 *
 * Symmetric twin of the read ports: a pure validator (a real batch id + a plain-object
 * payload) plus a thin command that calls the single `.rpc()` it needs (the
 * `ImportRoastAlogStore` port), testable with no database. The payload is forwarded
 * VERBATIM as jsonb; the filename is OPTIONAL (blank ⇒ null); the idempotency key is
 * REQUIRED.
 */

/** Validated, domain-shaped import args (camelCase). */
export interface ImportRoastAlogInput {
  /** The open roast batch to attach the .alog to (`roast_batches.id`, positive integer). */
  batchId: number;
  /** The uploaded filename; null ⇒ not supplied. */
  sourceFilename: string | null;
  /** The normalized .alog payload ({points, events}); forwarded verbatim as jsonb. */
  alogPayload: Record<string, unknown>;
  /** Exactly-once anchor — the DB dedupes on a tenant-qualified key. */
  idempotencyKey: string;
}

/** Is `v` a plain object (the jsonb payload shape) — not null, not an array? */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Pure validation of a raw import — mirrors the `import_roast_alog` preconditions (a
 * real batch id, a jsonb-object payload) so errors surface before the round-trip. The
 * append-only triggers, tenant clamp, and deviation math are the RPC's job (ADR-002).
 */
export function validateImportRoastAlog(
  raw: Record<string, unknown>,
): ValidationResult<ImportRoastAlogInput> {
  const errors: Record<string, string> = {};

  const batchId = toNumber(raw.batchId);
  if (batchId === null || !Number.isInteger(batchId) || batchId <= 0) {
    errors.batchId = "Choose a roast batch to import into.";
  }

  // filename: optional (nullable column); blank ⇒ null.
  const rawFilename = trimmed(raw.sourceFilename);
  const sourceFilename: string | null = rawFilename || null;

  // payload: required, must be a plain object (jsonb). An empty object is fine — the
  // RPC coalesces points/events to []; an array / primitive / missing is rejected.
  let alogPayload: Record<string, unknown> = {};
  if (!isPlainObject(raw.alogPayload)) {
    errors.alogPayload = "A roast (.alog) reading is required.";
  } else {
    alogPayload = raw.alogPayload;
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      batchId: batchId as number,
      sourceFilename,
      alogPayload,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint import id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method `import_roast_alog` needs. */
export interface ImportRoastAlogStore {
  rpc(
    fn: "import_roast_alog",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the import receipt id, or friendly/labelled errors. */
export type ImportRoastAlogResult =
  | { ok: true; importId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `import_roast_alog` onto a family-readable sentence —
 * the family must never see raw PG text (function names, errcodes). Always returns a
 * clean sentence.
 */
export function friendlyImportRoastAlogError(error: {
  message: string;
  code?: string;
}): string {
  const m = error.message.toLowerCase();
  if (error.code === "23503" || m.includes("unknown roast batch") || m.includes("foreign key")) {
    return "That roast batch couldn't be found. Open a roast batch before importing its reading.";
  }
  return "This roast reading couldn't be imported right now. Please check the file and try again.";
}

/**
 * Validate then import: calls `import_roast_alog` exactly once with the snake_case
 * argument envelope (the payload forwarded verbatim as jsonb). Bad input never reaches
 * the RPC (friendly errors); an RPC failure surfaces as a clean, family-readable
 * sentence (raw Postgres text never leaks). Exactly-once on `idempotencyKey` — a
 * replay returns the same import id with no second insert.
 */
export async function importRoastAlog(
  store: ImportRoastAlogStore,
  raw: Record<string, unknown>,
): Promise<ImportRoastAlogResult> {
  const parsed = validateImportRoastAlog(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("import_roast_alog", {
    p_batch_id: parsed.data.batchId,
    p_source_filename: parsed.data.sourceFilename,
    p_alog_payload: parsed.data.alogPayload,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return { ok: false, message: friendlyImportRoastAlogError(error) };
  }
  if (data == null) {
    return {
      ok: false,
      message: "This roast reading couldn't be imported right now. Please try again.",
    };
  }
  return { ok: true, importId: Number(data) };
}
