import { describe, expect, it, vi } from "vitest";

import {
  EXPORT_DOC_KINDS,
  friendlyIssueExportDocError,
  issueExportDoc,
  validateIssueExportDoc,
  type IssueExportDocStore,
} from "@/lib/db/commands/issueExportDoc";

/**
 * Pure-domain command test for THE GATED WRITER (P3-S3 — the headline invariant: an
 * export doc CANNOT issue without its prerequisites; ADR-002 — every write flows
 * through a SECURITY DEFINER RPC). `issue_export_doc` evaluates the declarative
 * `export_doc_prereqs` against live state and, on a non-empty unmet list, raises with
 * the EXACT missing prerequisites — never a blank document. This file does NOT touch
 * a database: it drives the command against a *fake store* stubbing
 * `.rpc('issue_export_doc', …)`, and proves (a) the doc_kind enum guard, (b) the exact
 * snake_case envelope, and — the keystone — (c) that a blocked-prereq rejection is
 * surfaced to the family with the EXACT unmet list PRESERVED (auditor-honest: the
 * traffic-light shows precisely what is still needed), not scrubbed to a vague error.
 * The gate evaluation + minting + freeze are the RPC's job (the migration's PGlite tests).
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: IssueExportDocStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as IssueExportDocStore, rpc };
}

/** A complete, valid raw issue request — the happy-path baseline each case tweaks. */
const validRaw = (): Record<string, unknown> => ({
  shipmentId: "10",
  docKind: "commercial_invoice",
  idempotencyKey: "idem-doc-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateIssueExportDoc", () => {
  it("accepts a complete, well-formed issue request", () => {
    const r = validateIssueExportDoc(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.shipmentId).toBe(10);
      expect(r.data.docKind).toBe("commercial_invoice");
      expect(r.data.idempotencyKey).toBe("idem-doc-1");
    }
  });

  it("accepts every one of the five mandated doc kinds", () => {
    for (const k of EXPORT_DOC_KINDS) {
      const r = validateIssueExportDoc({ ...validRaw(), docKind: k });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.docKind).toBe(k);
    }
  });

  it("rejects an unknown doc kind", () => {
    const r = validateIssueExportDoc({ ...validRaw(), docKind: "import_license" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.docKind).toBeDefined();
  });

  it("rejects a missing doc kind", () => {
    const r = validateIssueExportDoc({ ...validRaw(), docKind: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.docKind).toBeDefined();
  });

  it("rejects a missing / non-positive shipment id", () => {
    const r = validateIssueExportDoc({ ...validRaw(), shipmentId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.shipmentId).toBeDefined();
  });

  it("rejects a missing idempotency key", () => {
    const r = validateIssueExportDoc({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── friendly errors (THE KEYSTONE) ─────────────────

describe("friendlyIssueExportDocError", () => {
  it("PRESERVES the exact unmet-prerequisite list (auditor-honest, never scrubbed)", () => {
    const msg = friendlyIssueExportDocError({
      message:
        "export doc certificate_of_origin blocked — unmet prerequisites: all loaded lots EUDR-compliant",
      code: "23514",
    });
    expect(msg).toBeTruthy();
    // the family must SEE precisely what is still needed.
    expect(msg).toMatch(/all loaded lots EUDR-compliant/);
  });

  it("preserves a multi-item unmet list (e.g. the B/L's four prereqs)", () => {
    const msg = friendlyIssueExportDocError({
      message:
        "export doc bill_of_lading blocked — unmet prerequisites: commercial invoice issued; certificate of origin issued; phytosanitary certificate issued; packing list issued",
      code: "23514",
    });
    expect(msg).toMatch(/commercial invoice issued/);
    expect(msg).toMatch(/packing list issued/);
  });

  it("maps an unknown shipment / foreign-key violation to plain English", () => {
    const msg = friendlyIssueExportDocError({
      message: "unknown shipment 99 for tenant",
      code: "23503",
    });
    expect(msg).toMatch(/shipment/i);
    expect(msg).not.toMatch(/tenant/);
  });

  it("returns null for an unrecognised error (caller falls back to generic)", () => {
    expect(
      friendlyIssueExportDocError({ message: "some other failure" }),
    ).toBeNull();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("issueExportDoc", () => {
  it("returns a validation failure WITHOUT calling the RPC on an unknown doc kind", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await issueExportDoc(store, {
      ...validRaw(),
      docKind: "import_license",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.docKind).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls issue_export_doc with the exact snake_case envelope and returns the doc id", async () => {
    const { store, rpc } = fakeStore({ data: 55, error: null });
    const result = await issueExportDoc(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("issue_export_doc", {
      p_shipment_id: 10,
      p_doc_kind: "commercial_invoice",
      p_idempotency_key: "idem-doc-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.docId).toBe(55);
  });

  it("coerces a string id from PostgREST to a number", async () => {
    const { store } = fakeStore({ data: "56", error: null });
    const result = await issueExportDoc(store, validRaw());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.docId).toBe(56);
  });

  it("surfaces the EXACT unmet-prereq list when the gate blocks issue (the headline UX)", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        message:
          "export doc certificate_of_origin blocked — unmet prerequisites: all loaded lots EUDR-compliant",
        code: "23514",
      },
    });
    const result = await issueExportDoc(store, {
      ...validRaw(),
      docKind: "certificate_of_origin",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/all loaded lots EUDR-compliant/);
    }
  });

  it("surfaces a generic labelled message for an unrecognised failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "deadlock detected" },
    });
    const result = await issueExportDoc(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });
});
