import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The owner curation Server Actions call `await (await getSupabase()).rpc(...)`. Mock
// the client with a single rpc spy whose result each test sets. next-intl/server is
// mocked globally in setup.ts, so getTranslations resolves the real EN copy — the
// family-readable validation/guard messages come back as the actual UI strings.
const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => Promise.resolve({ rpc: rpcMock }),
}));

import {
  publishProvenanceAction,
  unpublishProvenanceAction,
} from "@/app/(app)/provenance/actions";

beforeEach(() => rpcMock.mockReset());
afterEach(() => vi.clearAllMocks());

const publishInput = () => ({
  skuId: 7,
  slug: "janson-geisha-jc901",
  gtin: "0840012345678",
  curatedStory: "Grown on Quetzal Ridge at 1,650m.",
  idempotencyKey: "idem-1",
});

describe("publishProvenanceAction — validation seam (DB untouched on bad input)", () => {
  it("rejects a blank slug WITHOUT touching the database", async () => {
    const r = await publishProvenanceAction({ ...publishInput(), slug: "   " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Add a public link before publishing.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a non-positive skuId WITHOUT touching the database", async () => {
    const r = await publishProvenanceAction({ ...publishInput(), skuId: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Pick a bag to publish.");
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("publishProvenanceAction — the one write door", () => {
  it("forwards p_-prefixed args to publish_provenance and returns the page id", async () => {
    rpcMock.mockResolvedValue({ data: 42, error: null });
    const r = await publishProvenanceAction(publishInput());
    expect(r).toEqual({ ok: true, pageId: 42 });
    expect(rpcMock).toHaveBeenCalledWith("publish_provenance", {
      p_sku_id: 7,
      p_slug: "janson-geisha-jc901",
      p_gtin: "0840012345678",
      p_curated_story: "Grown on Quetzal Ridge at 1,650m.",
      p_idempotency_key: "idem-1",
    });
  });

  it("maps a unique-violation (slug already taken) to clean copy, never raw PG", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "23505", message: 'duplicate key value violates unique constraint' },
    });
    const r = await publishProvenanceAction(publishInput());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("That public link is already used by another bag.");
  });

  it("passes a null gtin through as null (optional field)", async () => {
    rpcMock.mockResolvedValue({ data: 9, error: null });
    await publishProvenanceAction({ ...publishInput(), gtin: "" });
    expect(rpcMock).toHaveBeenCalledWith(
      "publish_provenance",
      expect.objectContaining({ p_gtin: null }),
    );
  });
});

describe("unpublishProvenanceAction — owner take-down", () => {
  it("rejects a non-positive skuId WITHOUT touching the database", async () => {
    const r = await unpublishProvenanceAction({ skuId: -1, idempotencyKey: "k" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Pick a bag to publish.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("forwards p_-prefixed args to unpublish_provenance", async () => {
    rpcMock.mockResolvedValue({ data: 42, error: null });
    const r = await unpublishProvenanceAction({ skuId: 7, idempotencyKey: "idem-2" });
    expect(r).toEqual({ ok: true, pageId: 42 });
    expect(rpcMock).toHaveBeenCalledWith("unpublish_provenance", {
      p_sku_id: 7,
      p_idempotency_key: "idem-2",
    });
  });
});
