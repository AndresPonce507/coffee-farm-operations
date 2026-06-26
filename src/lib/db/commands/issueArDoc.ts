import { toNumber, trimmed, type ValidationResult } from "@/lib/validation/shared";

/**
 * Write-side command for ISSUING an AR doc (P3-S17 — `issue_ar_doc`; ADR-002 — all
 * writes flow through a SECURITY DEFINER command RPC). Issuing an invoice is ONE
 * atomic act: the RPC mints a gap-free per-kind doc number, COMMITS each line's kg by
 * inserting a `lot_shipments` row — so the EXISTING `prevent_oversell` (+ QC-hold)
 * trigger fires — appends the journaling `revenue_entry`, enqueues an idempotent
 * `sync_outbox` post per target, and appends the `'ar_issued'` lot_event. The money
 * guarantee is REUSED, not rebuilt: invoicing 31 kg of a 30 kg lot fails closed and
 * rolls back the whole doc (no parallel counter). A commercial invoice with no
 * contract + Incoterm fails the shared export gate; a non-USD doc with no on-book
 * fx_rate fails the off-book-FX guard.
 *
 * Symmetric twin of the read ports: a pure validator (`validateIssueArDoc`, the
 * friendly-error seam) plus a thin command (`issueArDoc`) that calls the single
 * `.rpc()` method it needs (the `IssueArDocStore` port) so it is testable against a
 * fake store with no database. The idempotency key is REQUIRED — the action/form
 * layer mints a stable token. The fail-closed oversell / export-gate / off-book-FX /
 * QC-hold rejections surface as CLEAN, family-readable sentences.
 */

/** The `ar_doc_kind` enum (S16). */
export const AR_DOC_KINDS = [
  "proforma",
  "commercial_invoice",
  "credit_note",
  "dtc_receipt",
] as const;
export type ArDocKind = (typeof AR_DOC_KINDS)[number];

/** The `sync_target` enum (S17) — where the doc posts. */
export const SYNC_TARGETS = ["qbo", "xero", "dgi_pac"] as const;
export type SyncTarget = (typeof SYNC_TARGETS)[number];

/** A validated invoice line (camelCase). `description` defaults to "line"; an
 *  omitted `greenLotCode` / `sourceKind` serializes to null (a non-lot line). */
export interface ArDocLineInput {
  greenLotCode: string | null;
  description: string;
  kg: number | null;
  unitPriceDoc: number;
  amountDoc: number;
  sourceKind: string | null;
}

/** Validated, domain-shaped issue args (camelCase). */
export interface IssueArDocInput {
  kind: ArDocKind;
  currency: string;
  lines: ArDocLineInput[];
  buyerRef: string | null;
  contractRef: string | null;
  incoterm: string | null;
  targets: SyncTarget[];
  idempotencyKey: string;
}

function isArDocKind(v: string): v is ArDocKind {
  return (AR_DOC_KINDS as readonly string[]).includes(v);
}
function isSyncTarget(v: string): v is SyncTarget {
  return (SYNC_TARGETS as readonly string[]).includes(v);
}

/** Validate one raw line — `amount_doc` is required and ≥ 0 (the DB CHECK); a
 *  supplied kg / unit price must be ≥ 0. Returns the line or `null` if invalid. */
function validateLine(raw: unknown): ArDocLineInput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const amountDoc = toNumber(r.amountDoc);
  if (amountDoc === null || amountDoc < 0) return null;

  const kgRaw = trimmed(r.kg);
  let kg: number | null = null;
  if (kgRaw !== "") {
    const n = toNumber(r.kg);
    if (n === null || n < 0) return null;
    kg = n;
  }

  let unitPriceDoc = 0;
  if (trimmed(r.unitPriceDoc) !== "") {
    const n = toNumber(r.unitPriceDoc);
    if (n === null || n < 0) return null;
    unitPriceDoc = n;
  }

  const greenLotCode = trimmed(r.greenLotCode) || null;
  const sourceKind = trimmed(r.sourceKind) || null;
  const description = trimmed(r.description) || "line";

  return { greenLotCode, description, kg, unitPriceDoc, amountDoc, sourceKind };
}

/**
 * Pure validation of a raw issue — mirrors the `issue_ar_doc` preconditions (a known
 * kind, ≥1 well-formed line, recognised targets) so errors surface before the
 * round-trip. The oversell / export-gate / off-book-FX triggers fired inside the RPC
 * are the actual enforcement.
 */
export function validateIssueArDoc(
  raw: Record<string, unknown>,
): ValidationResult<IssueArDocInput> {
  const errors: Record<string, string> = {};

  const rawKind = trimmed(raw.kind);
  if (!isArDocKind(rawKind)) errors.kind = "Choose a valid document kind.";

  // Blank currency defaults to USD.
  const currency = trimmed(raw.currency) || "USD";

  // Lines: at least one, each well-formed (amount ≥ 0, kg/unit ≥ 0).
  const rawLines = Array.isArray(raw.lines) ? raw.lines : [];
  const lines: ArDocLineInput[] = [];
  if (rawLines.length === 0) {
    errors.lines = "Add at least one line.";
  } else {
    for (const rl of rawLines) {
      const line = validateLine(rl);
      if (line === null) {
        errors.lines = "Each line needs a non-negative amount (and kg, if set).";
        break;
      }
      lines.push(line);
    }
  }

  // Targets: blank → ['qbo']; any supplied value must be a known target.
  const rawTargets = Array.isArray(raw.targets) ? raw.targets : [];
  let targets: SyncTarget[] = ["qbo"];
  if (rawTargets.length > 0) {
    const cleaned = rawTargets.map((t) => trimmed(t));
    if (!cleaned.every(isSyncTarget)) {
      errors.targets = "Choose valid sync targets.";
    } else {
      targets = cleaned as SyncTarget[];
    }
  }

  const buyerRef = trimmed(raw.buyerRef) || null;
  const contractRef = trimmed(raw.contractRef) || null;
  const incoterm = trimmed(raw.incoterm) || null;

  const idempotencyKey = trimmed(raw.idempotencyKey);
  if (!idempotencyKey) errors.idempotencyKey = "An idempotency key is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      kind: rawKind as ArDocKind,
      currency,
      lines,
      buyerRef,
      contractRef,
      incoterm,
      targets,
      idempotencyKey,
    },
  };
}

/** The PostgREST shape the command returns from `.rpc()` (bigint ar_doc id). */
interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

/** The narrow write port — exactly the one `.rpc()` method `issue_ar_doc` needs. */
export interface IssueArDocStore {
  rpc(
    fn: "issue_ar_doc",
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
}

/** Outcome of the command: the issued doc's id, or friendly/labelled errors. */
export type IssueArDocResult =
  | { ok: true; docId: number }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Map a raw Postgres error from `issue_ar_doc` onto a family-readable sentence — the
 * triggers/RPC are the real guard, but the family must never see raw PG text (the
 * `oversell guard:` / `export gate:` / `off-book FX:` prefixes, errcodes). Returns
 * null for anything unrecognised so the caller falls back to a generic message.
 */
export function friendlyIssueArDocError(error: {
  message: string;
  code?: string;
}): string | null {
  const m = error.message.toLowerCase();
  // The REUSED money guarantee — a line's lot_shipments insert hit prevent_oversell.
  if (/oversell|available-to-promise|would exceed|double-sell|no declared mass/.test(m)) {
    return "There isn't enough available-to-promise on one of these lots to invoice that quantity. Lower the kilograms or pick another lot.";
  }
  // The QC-hold commit block.
  if (/qc-hold|open qc-hold|reserved or shipped/.test(m)) {
    return "One of these lots is under an open QC hold and can't be committed yet. Release the hold first.";
  }
  // The shared export gate (commercial invoice needs its contract + Incoterm).
  if (/export gate|requires a contract|incoterm/.test(m)) {
    return "A commercial invoice needs its sales contract and an Incoterm before it can be issued.";
  }
  // The off-book-FX guard — the doc currency has no on-book rate.
  if (/off-book fx|no fx_rate|record the rate first/.test(m)) {
    return "There's no exchange rate on the books for this currency yet. Record the rate first, then issue the invoice.";
  }
  return null;
}

/**
 * Validate then issue: serializes the validated camelCase lines to the snake_case
 * jsonb the RPC reads, then calls `issue_ar_doc` exactly once with the snake_case
 * argument envelope. Bad input never reaches the RPC (friendly errors); the
 * fail-closed oversell / export-gate / off-book-FX / QC-hold rejections surface as
 * CLEAN sentences, any other failure surfaces labelled. Exactly-once on
 * `idempotencyKey` — a replay returns the same doc id with no second issue.
 */
export async function issueArDoc(
  store: IssueArDocStore,
  raw: Record<string, unknown>,
): Promise<IssueArDocResult> {
  const parsed = validateIssueArDoc(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const pLines = parsed.data.lines.map((l) => ({
    green_lot_code: l.greenLotCode,
    description: l.description,
    kg: l.kg,
    unit_price_doc: l.unitPriceDoc,
    amount_doc: l.amountDoc,
    source_kind: l.sourceKind,
  }));

  const { data, error } = await store.rpc("issue_ar_doc", {
    p_kind: parsed.data.kind,
    p_currency: parsed.data.currency,
    p_lines: pLines,
    p_buyer_ref: parsed.data.buyerRef,
    p_contract_ref: parsed.data.contractRef,
    p_incoterm: parsed.data.incoterm,
    p_targets: parsed.data.targets,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        friendlyIssueArDocError(error) ??
        "This invoice couldn't be issued right now. Please try again.",
    };
  }
  if (data == null) {
    return { ok: false, message: "This invoice couldn't be issued right now. Please try again." };
  }
  return { ok: true, docId: Number(data) };
}
