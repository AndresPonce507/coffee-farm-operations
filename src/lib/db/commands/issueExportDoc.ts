import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for THE GATED WRITER (P3-S3 — the headline invariant: an export
 * doc CANNOT issue without its prerequisites; ADR-002 — every write flows through a
 * SECURITY DEFINER RPC). `issue_export_doc` evaluates the DECLARATIVE
 * `export_doc_prereqs` against LIVE state via `export_doc_prereqs_unmet`; on a
 * non-empty unmet list it raises with the EXACT missing prerequisites and renders
 * NOTHING — never a blank/false document (a non-deforestation-free lot physically
 * cannot get a Certificate of Origin; the B/L is chain-locked until the other four
 * issue). On a pass it freezes the rendered payload snapshot, mints the doc_no,
 * supersedes any prior live doc of that kind, and appends an 'export_doc_issued'
 * lot_event per loaded lot.
 *
 * Symmetric twin of the read port: a pure validator (`validateIssueExportDoc`, the
 * doc_kind enum guard) + a friendly-error mapper that — unlike the other commands —
 * PRESERVES the exact unmet-prerequisite list (auditor-honest: the family must SEE
 * precisely what is still needed) + a thin command (`issueExportDoc`) calling the one
 * `.rpc()` it needs (the `IssueExportDocStore` port), testable with no DB. The
 * idempotency key is REQUIRED — a replay returns the same doc id with no second issue.
 */

/** The five mandated trade documents (the `export_doc_kind` enum). */
export const EXPORT_DOC_KINDS = [
  "commercial_invoice",
  "certificate_of_origin",
  "phytosanitary",
  "packing_list",
  "bill_of_lading",
] as const;
export type ExportDocKind = (typeof EXPORT_DOC_KINDS)[number];

/** Validated, domain-shaped issue args (camelCase). */
export interface IssueExportDocInput {
  /** The shipment to issue a doc for (the `export_shipments.id`). */
  shipmentId: number;
  /** Which of the five mandated documents to issue. */
  docKind: ExportDocKind;
  /** Exactly-once anchor — the DB dedupes on a tenant-qualified key (no second issue). */
  idempotencyKey: string;
}

/** Is `v` one of the five mandated doc kinds? */
function isExportDocKind(v: string): v is ExportDocKind {
  return (EXPORT_DOC_KINDS as readonly string[]).includes(v);
}

/**
 * Pure validation of a raw issue request — mirrors the `issue_export_doc` surface so
 * errors surface before the round-trip (a known doc_kind; a shipment id). The
 * prerequisite gate evaluated against LIVE state is the real, auditable enforcement.
 */
export function validateIssueExportDoc(
  raw: Record<string, unknown>,
): ValidationResult<IssueExportDocInput> {
  const errors: Record<string, string> = {};

  const shipmentId = toNumber(raw.shipmentId);
  if (shipmentId === null || shipmentId <= 0) {
    errors.shipmentId = "Choose a shipment.";
  }

  const docKind = trimmed(raw.docKind);
  if (!docKind) {
    errors.docKind = "Choose a document to issue.";
  } else if (!isExportDocKind(docKind)) {
    errors.docKind = "Choose one of the five export documents.";
  }

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      shipmentId: shipmentId as number,
      docKind: docKind as ExportDocKind,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint doc id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method the command needs. */
export interface IssueExportDocStore {
  rpc(
    fn: "issue_export_doc",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the issued doc id, or friendly/labelled errors. */
export type IssueExportDocResult =
  | { ok: true; docId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

const UNMET_MARKER = "unmet prerequisites:";

/**
 * Map a raw Postgres error from `issue_export_doc` onto a family-readable sentence.
 * THE KEYSTONE: when the gate blocks issue, the family must SEE precisely which
 * prerequisites are still unmet (the auditor-honest, 'incomplete-with-names'
 * posture), so the unmet list is PRESERVED verbatim — never scrubbed to a vague
 * error. Returns null for anything unrecognised so the caller falls back to generic.
 */
export function friendlyIssueExportDocError(error: {
  message: string;
  code?: string;
}): string | null {
  const lower = error.message.toLowerCase();

  // THE HEADLINE: the prerequisite gate blocked the issue — surface the EXACT list.
  const idx = lower.indexOf(UNMET_MARKER);
  if (idx >= 0) {
    const list = error.message
      .slice(idx + UNMET_MARKER.length)
      .trim()
      .replace(/\.+$/, "");
    return `This document can't be issued yet. Still needed: ${list}.`;
  }

  if (error.code === "23503" || /unknown shipment|foreign key/.test(lower)) {
    return "That shipment couldn't be found. Refresh and try again.";
  }
  return null;
}

/**
 * Validate then issue: calls `issue_export_doc` exactly once with the snake_case
 * argument envelope. Bad input never reaches the RPC (friendly errors); a blocked
 * prerequisite surfaces with its EXACT unmet list PRESERVED (the headline UX); any
 * other failure surfaces labelled (raw Postgres never leaks). Exactly-once on
 * `idempotencyKey` — a replay returns the same doc id with no second issue.
 */
export async function issueExportDoc(
  store: IssueExportDocStore,
  raw: Record<string, unknown>,
): Promise<IssueExportDocResult> {
  const parsed = validateIssueExportDoc(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { data, error } = await store.rpc("issue_export_doc", {
    p_shipment_id: parsed.data.shipmentId,
    p_doc_kind: parsed.data.docKind,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyIssueExportDocError(error) ??
        "This document couldn't be issued right now. Please try again.",
    };
  }
  if (data == null) {
    return {
      ok: false,
      message: "This document couldn't be issued right now. Please try again.",
    };
  }
  return { ok: true, docId: Number(data) };
}
