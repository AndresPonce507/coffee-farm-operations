import { describe, expect, it, vi } from "vitest";

import {
  createProduct,
  validateCreateProduct,
  type CreateProductStore,
} from "@/lib/db/commands/createProduct";

/**
 * Pure-domain command test for the roasted-SKU-master writer (P3-S11 — catalog +
 * lot-linked SKUs; ADR-002 — every write flows through a SECURITY DEFINER RPC). No
 * database: the command runs against a *fake store* stubbing the one method it
 * calls, `.rpc('create_product', …)`, proving (a) the friendly-validation seam,
 * (b) the exact snake_case argument envelope (incl. the optional variety/process/
 * notes passing as null), and (c) that a DB failure surfaces a clean labelled
 * message, never a raw Postgres exception. The tenant clamp + idempotency are the
 * RPC's job (pinned by the migration's PGlite test).
 *
 * Mirrors the established command-test idiom (createRoastProfile.test.ts): the
 * idempotency key is REQUIRED (the action/form layer mints a stable token).
 */

interface RpcResult {
  data: number | string | null;
  error: { message: string; code?: string } | null;
}

function fakeStore(result: RpcResult): {
  store: CreateProductStore;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { store: { rpc } as unknown as CreateProductStore, rpc };
}

const validRaw = (): Record<string, unknown> => ({
  slug: "geisha-natural",
  name: "Geisha Natural",
  variety: "Geisha",
  process: "Natural",
  tastingNotes: "jasmine, bergamot",
  idempotencyKey: "idem-prod-1",
});

// ─────────────────────────── validation seam ───────────────────────────────

describe("validateCreateProduct", () => {
  it("accepts a complete, well-formed product", () => {
    const r = validateCreateProduct(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.slug).toBe("geisha-natural");
      expect(r.data.name).toBe("Geisha Natural");
      expect(r.data.variety).toBe("Geisha");
      expect(r.data.process).toBe("Natural");
      expect(r.data.tastingNotes).toBe("jasmine, bergamot");
      expect(r.data.idempotencyKey).toBe("idem-prod-1");
    }
  });

  it("treats blank optional variety/process/notes as null", () => {
    const r = validateCreateProduct({
      ...validRaw(),
      variety: "",
      process: "   ",
      tastingNotes: "",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.variety).toBeNull();
      expect(r.data.process).toBeNull();
      expect(r.data.tastingNotes).toBeNull();
    }
  });

  it("rejects a missing slug", () => {
    const r = validateCreateProduct({ ...validRaw(), slug: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.slug).toBeDefined();
  });

  it("rejects a missing name", () => {
    const r = validateCreateProduct({ ...validRaw(), name: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.name).toBeDefined();
  });

  it("rejects a missing idempotency key", () => {
    const r = validateCreateProduct({ ...validRaw(), idempotencyKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.idempotencyKey).toBeDefined();
  });
});

// ─────────────────────────── command behaviour ─────────────────────────────

describe("createProduct", () => {
  it("returns a validation failure WITHOUT calling the RPC on bad input", async () => {
    const { store, rpc } = fakeStore({ data: null, error: null });
    const result = await createProduct(store, { ...validRaw(), slug: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.slug).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls create_product with the exact snake_case envelope and returns the product id", async () => {
    const { store, rpc } = fakeStore({ data: 12, error: null });
    const result = await createProduct(store, validRaw());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("create_product", {
      p_slug: "geisha-natural",
      p_name: "Geisha Natural",
      p_variety: "Geisha",
      p_process: "Natural",
      p_tasting_notes: "jasmine, bergamot",
      p_idempotency_key: "idem-prod-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.productId).toBe(12);
  });

  it("forwards null for blank optional fields", async () => {
    const { store, rpc } = fakeStore({ data: 13, error: null });
    await createProduct(store, { ...validRaw(), variety: "", process: "", tastingNotes: "" });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_variety).toBeNull();
    expect(args.p_process).toBeNull();
    expect(args.p_tasting_notes).toBeNull();
  });

  it("coerces a string id from PostgREST to a number", async () => {
    const { store } = fakeStore({ data: "14", error: null });
    const result = await createProduct(store, validRaw());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.productId).toBe(14);
  });

  it("maps a duplicate-slug unique violation to a clean message (never raw PG)", async () => {
    const { store } = fakeStore({
      data: null,
      error: {
        message:
          'duplicate key value violates unique constraint "products_tenant_slug_ux"',
        code: "23505",
      },
    });
    const result = await createProduct(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/slug/i);
      expect(result.message).not.toMatch(/constraint|23505/);
    }
  });

  it("surfaces a generic clean message for an unrecognised RPC failure", async () => {
    const { store } = fakeStore({
      data: null,
      error: { message: "some internal boom" },
    });
    const result = await createProduct(store, validRaw());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBeTruthy();
      expect(result.message).not.toContain("boom");
    }
  });
});
