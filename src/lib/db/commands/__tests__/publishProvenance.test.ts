import { describe, expect, it, vi } from "vitest";

import {
  friendlyPublishProvenanceError,
  publishProvenance,
  validatePublishProvenance,
  type PublishProvenanceStore,
} from "@/lib/db/commands/publishProvenance";

/**
 * Pure-domain command test for the OWNER curation writer that publishes a per-lot
 * provenance microsite page (P3-S13 — THE security-critical slice; ADR-002 — every
 * write flows through a SECURITY DEFINER RPC). This file does NOT touch a database:
 * it drives the command against a *fake store* stubbing the one method it calls,
 * `.rpc('publish_provenance', …)`, and proves (a) the friendly-validation seam, (b)
 * the exact snake_case argument envelope the SECDEF RPC expects, and (c) that a DB
 * failure — a duplicate slug, an unknown SKU — surfaces a CLEAN, family-readable
 * sentence, never a raw Postgres exception. The is_published curation gate, the
 * tenant clamp, the no-client-mutation grant and the slug uniqueness are the *real*
 * enforcement (proven by the migration's PGlite tests). Mirrors the established
 * command-test idiom in recordIceCQuote.test.ts: the idempotency key is REQUIRED
 * (the action/form layer mints a stable token).
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: PublishProvenanceStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as PublishProvenanceStore, rpc };
}

/** A complete, valid raw publish request — the happy-path baseline each case tweaks. */
const validRaw = (): Record<string, unknown> => ({
  skuId: "12",
  slug: "janson-geisha-jc901",
  gtin: "0840012345678",
  curatedStory: "Grown on Quetzal Ridge at 1650m, hand-picked at peak ripeness.",
  idempotencyKey: "idem-pub-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validatePublishProvenance", () => {
  it("accepts a complete, well-formed publish request", () => {
    const r = validatePublishProvenance(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.skuId).toBe(12);
      expect(r.data.slug).toBe("janson-geisha-jc901");
      expect(r.data.gtin).toBe("0840012345678");
      expect(r.data.curatedStory).toContain("Quetzal Ridge");
      expect(r.data.idempotencyKey).toBe("idem-pub-1");
    }
  });

  it("rejects a missing / non-positive / non-integer sku id", () => {
    for (const skuId of ["", "0", "-3", "1.5", "abc"]) {
      const r = validatePublishProvenance({ ...validRaw(), skuId });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.skuId).toBeDefined();
    }
  });

  it("rejects a missing slug", () => {
    const r = validatePublishProvenance({ ...validRaw(), slug: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.slug).toBeDefined();
  });

  it("rejects a slug that contains whitespace (it is a URL path segment)", () => {
    const r = validatePublishProvenance({
      ...validRaw(),
      slug: "janson geisha",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.slug).toBeDefined();
  });

  it("treats a blank gtin as 'not provided' (null — GTIN is optional / $0 path)", () => {
    const r = validatePublishProvenance({ ...validRaw(), gtin: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.gtin).toBeNull();
  });

  it("treats a blank curated story as null", () => {
    const r = validatePublishProvenance({ ...validRaw(), curatedStory: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.curatedStory).toBeNull();
  });

  it("rejects a missing idempotency key", () => {
    const r = validatePublishProvenance({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── friendly-error seam ───────────────────────────

describe("friendlyPublishProvenanceError", () => {
  it("maps a duplicate-slug unique violation to a clean sentence", () => {
    const m = friendlyPublishProvenanceError({
      message:
        'duplicate key value violates unique constraint "provenance_pages_slug_ux"',
      code: "23505",
    });
    expect(m).toBeTruthy();
    expect(m).toMatch(/slug|web address/i);
  });

  it("maps an unknown-SKU foreign-key violation to a clean sentence", () => {
    const m = friendlyPublishProvenanceError({
      message: "unknown sku 99 for this tenant",
      code: "23503",
    });
    expect(m).toBeTruthy();
    expect(m).toMatch(/bag|sku/i);
  });

  it("returns null for an unrecognised error (caller falls back to generic)", () => {
    expect(
      friendlyPublishProvenanceError({ message: "some other failure" }),
    ).toBeNull();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("publishProvenance", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await publishProvenance(store, { ...validRaw(), slug: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.slug).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls publish_provenance with the exact snake_case envelope and returns the page id", async () => {
    const { store, rpc } = fakeStore({ data: 5, error: null });
    const result = await publishProvenance(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("publish_provenance", {
      p_sku_id: 12,
      p_slug: "janson-geisha-jc901",
      p_gtin: "0840012345678",
      p_curated_story:
        "Grown on Quetzal Ridge at 1650m, hand-picked at peak ripeness.",
      p_idempotency_key: "idem-pub-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pageId).toBe(5);
  });

  it("forwards null p_gtin / p_curated_story when those fields are blank", async () => {
    const { store, rpc } = fakeStore({ data: 6, error: null });
    await publishProvenance(store, {
      ...validRaw(),
      gtin: "",
      curatedStory: "",
    });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_gtin).toBeNull();
    expect(args.p_curated_story).toBeNull();
  });

  it("coerces a string id from PostgREST to a number", async () => {
    const { store } = fakeStore({ data: "9", error: null });
    const result = await publishProvenance(store, validRaw());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pageId).toBe(9);
  });

  it("surfaces a friendly duplicate-slug sentence (never raw PG) when the slug is taken", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        message:
          'duplicate key value violates unique constraint "provenance_pages_slug_ux"',
        code: "23505",
      },
    });
    const result = await publishProvenance(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/slug|web address/i);
      expect(result.message).not.toMatch(/duplicate key/i);
    }
  });

  it("surfaces a labelled generic message for an unrecognised RPC failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "connection reset" },
    });
    const result = await publishProvenance(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });
});
