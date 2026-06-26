import { describe, expect, it, vi } from "vitest";

import {
  friendlyUnpublishProvenanceError,
  unpublishProvenance,
  validateUnpublishProvenance,
  type UnpublishProvenanceStore,
} from "@/lib/db/commands/unpublishProvenance";

/**
 * Pure-domain command test for the OWNER curation writer that TAKES DOWN a per-lot
 * provenance microsite page (P3-S13 — flips `is_published` back to false; ADR-002 —
 * every write flows through a SECURITY DEFINER RPC). This file does NOT touch a
 * database: it drives the command against a *fake store* stubbing the one method it
 * calls, `.rpc('unpublish_provenance', …)`, and proves (a) the friendly-validation
 * seam, (b) the exact snake_case argument envelope, and (c) that an "no page for
 * this bag" failure surfaces a CLEAN sentence, never raw Postgres text. The curation
 * gate + tenant clamp are the *real* enforcement (the migration's PGlite tests).
 * Mirrors recordIceCQuote.test.ts: the idempotency key is REQUIRED.
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: UnpublishProvenanceStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as UnpublishProvenanceStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  skuId: "12",
  idempotencyKey: "idem-unpub-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateUnpublishProvenance", () => {
  it("accepts a complete, well-formed unpublish request", () => {
    const r = validateUnpublishProvenance(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.skuId).toBe(12);
      expect(r.data.idempotencyKey).toBe("idem-unpub-1");
    }
  });

  it("rejects a missing / non-positive / non-integer sku id", () => {
    for (const skuId of ["", "0", "-1", "2.5", "nope"]) {
      const r = validateUnpublishProvenance({ ...validRaw(), skuId });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.skuId).toBeDefined();
    }
  });

  it("rejects a missing idempotency key", () => {
    const r = validateUnpublishProvenance({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── friendly-error seam ───────────────────────────

describe("friendlyUnpublishProvenanceError", () => {
  it("maps a 'no provenance page' failure to a clean sentence", () => {
    const m = friendlyUnpublishProvenanceError({
      message: "no provenance page for sku 12 in this tenant",
      code: "23503",
    });
    expect(m).toBeTruthy();
    expect(m).toMatch(/page|bag/i);
  });

  it("returns null for an unrecognised error (caller falls back to generic)", () => {
    expect(
      friendlyUnpublishProvenanceError({ message: "some other failure" }),
    ).toBeNull();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("unpublishProvenance", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await unpublishProvenance(store, { ...validRaw(), skuId: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.skuId).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls unpublish_provenance with the exact snake_case envelope and returns the page id", async () => {
    const { store, rpc } = fakeStore({ data: 5, error: null });
    const result = await unpublishProvenance(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("unpublish_provenance", {
      p_sku_id: 12,
      p_idempotency_key: "idem-unpub-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pageId).toBe(5);
  });

  it("coerces a string id from PostgREST to a number", async () => {
    const { store } = fakeStore({ data: "8", error: null });
    const result = await unpublishProvenance(store, validRaw());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pageId).toBe(8);
  });

  it("surfaces a friendly 'no page' sentence (never raw PG) when there's nothing to take down", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        message: "no provenance page for sku 12 in this tenant",
        code: "23503",
      },
    });
    const result = await unpublishProvenance(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/page|bag/i);
      expect(result.message).not.toMatch(/sku 12 in this tenant/i);
    }
  });

  it("surfaces a labelled generic message for an unrecognised RPC failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "connection reset" },
    });
    const result = await unpublishProvenance(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });
});
