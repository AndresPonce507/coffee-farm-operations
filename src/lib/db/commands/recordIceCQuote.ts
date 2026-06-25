import {
  isISODate,
  toNumber,
  trimmed,
  type ValidationResult,
} from "@/lib/validation/shared";

/**
 * Write-side command for posting an ICE "C" mark (P3-S0 — the dual-regime pricing
 * core; ADR-002 — all writes flow through a SECURITY DEFINER command RPC). The
 * `ice_c_quotes` ledger is APPEND-ONLY (immutability triggers reject UPDATE/DELETE):
 * a correction is a NEW mark, never an edit. The single write door is
 * `record_ice_c_quote` — tenant-clamped, idempotent on a tenant-qualified key.
 * The `source` enum keeps the engine feed-agnostic; 'manual' mark entry is the
 * always-available $0 fallback (a free-tier scrape adapter drops in behind the
 * same RPC). `as_of` is optional — a blank stamps `now()` in the RPC.
 *
 * Symmetric twin of the read ports: a pure validator (`validateRecordIceCQuote`,
 * the friendly-error seam) plus a thin command (`recordIceCQuote`) that calls the
 * single `.rpc()` method it needs (the `RecordIceCQuoteStore` port) so it is
 * testable against a fake store with no database. The idempotency key is REQUIRED
 * — the action/form layer mints a stable token (mirrors advanceProcessingStage).
 */

/** The `ice_c_source` enum — feed-agnostic; 'manual' is the $0 fallback. */
export const ICE_C_SOURCES = [
  "manual",
  "barchart-free",
  "investing-scrape",
] as const;
export type IceCSource = (typeof ICE_C_SOURCES)[number];

/** Validated, domain-shaped mark args (camelCase). */
export interface RecordIceCQuoteInput {
  /** The ICE "C" contract month, e.g. "2026-12". */
  contractMonth: string;
  /** The mark, USD per lb (the `price > 0` CHECK guards it). */
  price: number;
  /** Where the mark came from — defaults to 'manual'. */
  source: IceCSource;
  /** Field wall-clock of the mark; null ⇒ the RPC stamps now(). */
  asOf: string | null;
  /** Exactly-once anchor — the DB dedupes on a tenant-qualified key. */
  idempotencyKey: string;
}

/** Is `v` one of the recognised feed sources? (mirrors the `ice_c_source` enum) */
function isIceCSource(v: string): v is IceCSource {
  return (ICE_C_SOURCES as readonly string[]).includes(v);
}

/** Is `v` a recognised ISO-8601 timestamp (e.g. "2026-06-20T14:03:00.000Z")? */
function isISOTimestamp(v: string): boolean {
  if (v === "") return false;
  const t = Date.parse(v);
  return Number.isFinite(t) && /\d{4}-\d{2}-\d{2}T/.test(v);
}

/**
 * Pure validation of a raw mark — mirrors the `record_ice_c_quote` / `ice_c_quotes`
 * constraints (price > 0, the source enum) so errors surface before the round-trip.
 * The append-only triggers + tenant clamp are the actual enforcement (ADR-002).
 */
export function validateRecordIceCQuote(
  raw: Record<string, unknown>,
): ValidationResult<RecordIceCQuoteInput> {
  const errors: Record<string, string> = {};

  const contractMonth = trimmed(raw.contractMonth);
  if (!contractMonth) errors.contractMonth = "A contract month is required.";

  const price = toNumber(raw.price);
  if (price === null || price <= 0) {
    errors.price = 'The "C" price must be greater than 0.';
  }

  // Blank source defaults to 'manual'; a supplied value must be a known feed.
  const rawSource = trimmed(raw.source) || "manual";
  if (!isIceCSource(rawSource)) {
    errors.source = "Choose a valid mark source.";
  }

  // Blank as_of means "not provided" → null (the RPC stamps now()).
  const rawAsOf = trimmed(raw.asOf);
  let asOf: string | null = null;
  if (rawAsOf) {
    if (!isISOTimestamp(rawAsOf) && !isISODate(rawAsOf)) {
      errors.asOf = "A valid mark time is required.";
    } else {
      asOf = rawAsOf;
    }
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      contractMonth,
      price: price as number,
      source: rawSource as IceCSource,
      asOf,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/**
 * The narrow write port the command depends on — exactly the one `.rpc()` method
 * `record_ice_c_quote` needs. A Supabase client satisfies this structurally; a
 * hand-rolled stub satisfies it in pure-domain tests.
 */
export interface RecordIceCQuoteStore {
  rpc(
    fn: "record_ice_c_quote",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the posted mark's id, or friendly/labelled errors. */
export type RecordIceCQuoteResult =
  | { ok: true; markId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Validate then post: calls `record_ice_c_quote` exactly once with the snake_case
 * argument envelope the SECURITY DEFINER RPC expects. Bad input never reaches the
 * RPC (friendly errors); a failure surfaces as a labelled message (raw Postgres
 * text never leaks). Exactly-once on `idempotencyKey` — a replay returns the same
 * mark id with no second insert.
 */
export async function recordIceCQuote(
  store: RecordIceCQuoteStore,
  raw: Record<string, unknown>,
): Promise<RecordIceCQuoteResult> {
  const parsed = validateRecordIceCQuote(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("record_ice_c_quote", {
    p_contract_month: parsed.data.contractMonth,
    p_price: parsed.data.price,
    p_source: parsed.data.source,
    p_as_of: parsed.data.asOf,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return { ok: false, message: `Couldn't post the "C" mark: ${error.message}` };
  }
  if (data == null) {
    return { ok: false, message: 'The "C" mark couldn\'t be posted. Please try again.' };
  }
  return { ok: true, markId: Number(data) };
}
