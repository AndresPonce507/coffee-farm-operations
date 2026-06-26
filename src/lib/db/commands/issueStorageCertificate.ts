import { trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for the storage-certificate writer (P3-S20 — the EUDR
 * honest-provenance posture, here for controlled-environment storage; ADR-002).
 * `issue_storage_certificate` reads the readings in the window, computes the verdict
 * against the location's bands, computes a `cert_hash` binding the verdict to the
 * EXACT readings, appends a hash-chained 'storage_certified' lot_event, and — the
 * LOAD-BEARING refusal — RAISES when the window has zero readings (the verdict can
 * only ever be 'insufficient-data', NEVER a fabricated 'in-band'). `storage_certificates`
 * is APPEND-ONLY; a correction is a superseding certificate. Idempotent + tenant-clamped.
 *
 * Symmetric twin of the read ports: a pure validator (`validateIssueStorageCertificate`)
 * plus a thin command that calls the one `.rpc()` it needs. The idempotency key is
 * REQUIRED. This command surfaces the EVIDENCE-GATE refusal as a CLEAN sentence.
 */

/** Validated, domain-shaped certificate args (camelCase). */
export interface IssueStorageCertificateInput {
  greenLotCode: string;
  locationCode: string;
  /** Inclusive window start (ISO). */
  windowStart: string;
  /** Exclusive window end (ISO) — must be strictly after the start. */
  windowEnd: string;
  idempotencyKey: string;
}

/** Is `v` a recognised ISO-8601 timestamp or date? */
function isISOInstant(v: string): boolean {
  if (v === "") return false;
  const t = Date.parse(v);
  return Number.isFinite(t) && /^\d{4}-\d{2}-\d{2}/.test(v);
}

/**
 * Pure validation of a raw certificate request — a real lot + location, and a
 * well-formed window whose end is strictly after its start (an empty/inverted
 * window is the EVIDENCE GATE's zero-readings case). The window read + cert_hash +
 * the readings_count=0 refusal are the RPC's job (the migration's PGlite tests).
 */
export function validateIssueStorageCertificate(
  raw: Record<string, unknown>,
): ValidationResult<IssueStorageCertificateInput> {
  const errors: Record<string, string> = {};

  const greenLotCode = trimmed(raw.greenLotCode);
  if (!greenLotCode) errors.greenLotCode = "Choose a green lot.";

  const locationCode = trimmed(raw.locationCode);
  if (!locationCode) errors.locationCode = "Choose a storage location.";

  const windowStart = trimmed(raw.windowStart);
  if (!windowStart) {
    errors.windowStart = "A window start is required.";
  } else if (!isISOInstant(windowStart)) {
    errors.windowStart = "A valid window start is required.";
  }

  const windowEnd = trimmed(raw.windowEnd);
  if (!windowEnd) {
    errors.windowEnd = "A window end is required.";
  } else if (!isISOInstant(windowEnd)) {
    errors.windowEnd = "A valid window end is required.";
  }

  if (
    !errors.windowStart &&
    !errors.windowEnd &&
    Date.parse(windowEnd) <= Date.parse(windowStart)
  ) {
    errors.windowEnd = "The window end must be after its start.";
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: { greenLotCode, locationCode, windowStart, windowEnd, idempotencyKey },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` `issue_storage_certificate` needs. */
export interface IssueStorageCertificateStore {
  rpc(
    fn: "issue_storage_certificate",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the certificate's id, or friendly/labelled errors. */
export type IssueStorageCertificateResult =
  | { ok: true; certificateId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `issue_storage_certificate` onto a family-readable
 * sentence — the EVIDENCE GATE (zero readings ⇒ no honest verdict) and the
 * unknown-lot/location not-found. Returns null for anything unrecognised.
 */
export function friendlyIssueStorageCertificateError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  // The EVIDENCE GATE — the window has no readings, so no cert can be issued.
  if (/zero readings|insufficient-data|never a fabricated/.test(m)) {
    return "There are no readings in that window, so a certificate can't be issued. Log readings first, then certify.";
  }
  // Unknown lot or location.
  if (
    error.code === "23503" ||
    /unknown green lot|unknown storage location|foreign key/.test(m)
  ) {
    return "That green lot or storage location couldn't be found. Refresh and try again.";
  }
  return null;
}

/**
 * Validate then issue: calls `issue_storage_certificate` exactly once with the
 * snake_case argument envelope. Bad input never reaches the RPC (friendly errors);
 * the EVIDENCE-GATE refusal surfaces as a CLEAN "no readings" sentence, any other
 * failure labelled. Exactly-once on `idempotencyKey` — a replay returns the same id.
 */
export async function issueStorageCertificate(
  store: IssueStorageCertificateStore,
  raw: Record<string, unknown>,
): Promise<IssueStorageCertificateResult> {
  const parsed = validateIssueStorageCertificate(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("issue_storage_certificate", {
    p_green_lot_code: parsed.data.greenLotCode,
    p_location_code: parsed.data.locationCode,
    p_window_start: parsed.data.windowStart,
    p_window_end: parsed.data.windowEnd,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyIssueStorageCertificateError(error) ??
        "The certificate couldn't be issued right now. Please try again.",
    };
  }
  if (data == null) {
    return { ok: false, message: "The certificate couldn't be issued right now. Please try again." };
  }
  return { ok: true, certificateId: Number(data) };
}
