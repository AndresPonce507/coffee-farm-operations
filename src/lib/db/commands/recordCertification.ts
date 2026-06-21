import {
  isISODate,
  trimmed,
  type ValidationResult,
} from "@/lib/validation/shared";

/**
 * Write-side command for recording a worker certification (ADR-002 — all writes
 * flow through a `SECURITY DEFINER` command RPC, one per business intent).
 *
 * A pure validator (`validateCertification`, the friendly-error seam) plus a thin
 * command (`recordCertification`) that calls the *single write door*,
 * `record_certification`. The command takes only the one `.rpc()` method it needs
 * (the `CertificationStore` port) so it is testable against a fake store with no
 * database — the SQL CHECK/raise inside the RPC is the *real* enforcement. This
 * RPC returns a `bigint` cert id (number) rather than a uuid.
 *
 * Mirrors the established `@/lib/validation/*` `ValidationResult` contract.
 */

/** Validated, domain-shaped certification args (camelCase). */
export interface CertificationInput {
  workerId: string;
  certKind: string;
  /** Issue date — `issued_at` (ISO date, required). */
  issuedAt: string;
  /** Expiry date — `expires_at` (ISO date, nullable; >= issuedAt). */
  expiresAt: string | null;
  /** Optional issuing authority — `issuer`. */
  issuer: string | null;
  /** Optional reference to the certificate document — `doc_ref`. */
  docRef: string | null;
  /** Exactly-once anchor — the DB dedupes on this (`idempotency_key`). */
  idempotencyKey: string;
}

/**
 * Pure validation of a raw certification record — mirrors the
 * `record_certification` DB constraints (including the cross-field
 * issued/expires rule) so errors surface before the round-trip. The SQL
 * CHECK/raise is the actual enforcement (ADR-002).
 */
export function validateCertification(
  raw: Record<string, unknown>,
): ValidationResult<CertificationInput> {
  const errors: Record<string, string> = {};

  const workerId = trimmed(raw.workerId);
  if (!workerId) errors.workerId = "Choose a worker.";

  const certKind = trimmed(raw.certKind);
  if (!certKind) errors.certKind = "A certification kind is required.";

  const issuedAt = trimmed(raw.issuedAt);
  if (!isISODate(issuedAt)) {
    errors.issuedAt = "A valid issue date is required.";
  }

  // expiresAt is optional; when present it must be an ISO date on or after
  // issuedAt. Only run the cross-field comparison once both dates parse.
  const expiresAtRaw = trimmed(raw.expiresAt);
  let expiresAt: string | null = null;
  if (expiresAtRaw !== "") {
    if (!isISODate(expiresAtRaw)) {
      errors.expiresAt = "A valid expiry date is required.";
    } else if (isISODate(issuedAt) && expiresAtRaw < issuedAt) {
      errors.expiresAt = "Expiry date must be on or after the issue date.";
    } else {
      expiresAt = expiresAtRaw;
    }
  }

  // issuer and docRef are optional.
  const issuerRaw = trimmed(raw.issuer);
  const issuer = issuerRaw === "" ? null : issuerRaw;

  const docRefRaw = trimmed(raw.docRef);
  const docRef = docRefRaw === "" ? null : docRefRaw;

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) {
    errors.idempotencyKey = "An idempotency key is required.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      workerId,
      certKind,
      issuedAt,
      expiresAt,
      issuer,
      docRef,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint → number). */
interface RpcResult {
  data: number | null;
  error: { message: string } | null;
}

/**
 * The narrow write port the command depends on — exactly the one `.rpc()`
 * method `record_certification` needs. A Supabase client satisfies this
 * structurally; a hand-rolled stub satisfies it in pure-domain tests.
 */
export interface CertificationStore {
  rpc(fn: "record_certification", args: Record<string, unknown>): Promise<RpcResult>;
}

/** Outcome of the command: the cert id, or friendly/labelled errors. */
export type CertificationResult =
  | { ok: true; certId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Validate then record: calls `record_certification` exactly once with the
 * snake_case argument envelope the SECURITY DEFINER RPC expects. Bad input never
 * reaches the RPC (friendly errors); RPC failures surface labelled. The RPC is
 * exactly-once on `idempotencyKey` — a replay returns the originally minted cert
 * id, no second record.
 */
export async function recordCertification(
  store: CertificationStore,
  raw: Record<string, unknown>,
): Promise<CertificationResult> {
  const parsed = validateCertification(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("record_certification", {
    p_worker_id: parsed.data.workerId,
    p_cert_kind: parsed.data.certKind,
    p_issued_at: parsed.data.issuedAt,
    p_expires_at: parsed.data.expiresAt,
    p_issuer: parsed.data.issuer,
    p_doc_ref: parsed.data.docRef,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return { ok: false, message: `record_certification: ${error.message}` };
  }
  if (data === null || data === undefined) {
    return { ok: false, message: "record_certification: no cert id returned" };
  }
  return { ok: true, certId: data };
}
