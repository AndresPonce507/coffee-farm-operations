import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SkuProvenancePublicRow } from "@/lib/db/provenance-microsite";

/**
 * Coverage of the `provenance-microsite.ts` READ-port (P3-S13 — the PUBLIC per-lot
 * QR provenance microsite; THE security-critical slice). It binds to the EXACT
 * surface the `20260706092000_provenance_microsite.sql` migration ships:
 *   - VIEW  `sku_provenance_public`   (the curated, published-only projection — the
 *                                      ONE anon-readable door of all of Phase 3)
 *   - RPC   `resolve_provenance(p_slug)` (the SECURITY DEFINER anon resolver — the
 *                                      assembled public JSON for a PUBLISHED slug,
 *                                      NULL for unpublished/unknown)
 *   - TABLE `provenance_pages`        (the owner curation record — tenant-scoped read)
 *
 * The whitelist / no-leak / curation-gate enforcement is the migration's job (pinned
 * by src/test/db/s13_provenance_microsite.db.test.ts in PGlite); this port only proves
 * the row→domain seam + the right query/RPC name + args + NULL preservation + the
 * labelled-error contract survive the `cache()` round-trip. Strategy mirrors
 * getters.test.ts + eudr.test.ts: mock `@/lib/supabase/server` so `getSupabase()`
 * resolves to a chainable, thenable builder that also exposes `.rpc()`.
 */

interface QueryResult<T> {
  data: T;
  error: { message: string } | null;
}

/**
 * A client whose `.from()` returns a chainable, thenable builder (so list/`await`
 * queries resolve) and whose `.rpc()` resolves to the same configured result. The
 * `calls` record captures the exact table/select/eq/order + rpc name/args so each
 * test can assert the query shape.
 */
function makeClient<T>(result: QueryResult<T>) {
  const calls = {
    from: undefined as string | undefined,
    selectArgs: [] as unknown[][],
    eqArgs: [] as Array<[string, unknown]>,
    orderArgs: [] as Array<[string, Record<string, unknown> | undefined]>,
    rpcName: undefined as string | undefined,
    rpcArgs: undefined as Record<string, unknown> | undefined,
  };
  const builder = {
    select: vi.fn((...a: unknown[]) => {
      calls.selectArgs.push(a);
      return builder;
    }),
    eq: vi.fn((col: string, val: unknown) => {
      calls.eqArgs.push([col, val]);
      return builder;
    }),
    order: vi.fn((col: string, opts?: Record<string, unknown>) => {
      calls.orderArgs.push([col, opts]);
      return builder;
    }),
    then: (
      onFulfilled: (value: QueryResult<T>) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  const client = {
    from: (table: string) => {
      calls.from = table;
      return builder;
    },
    rpc: vi.fn((name: string, args?: Record<string, unknown>) => {
      calls.rpcName = name;
      calls.rpcArgs = args;
      return Promise.resolve(result);
    }),
  };
  return { client, calls };
}

const getSupabaseMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => getSupabaseMock(),
}));

beforeEach(() => getSupabaseMock.mockReset());
afterEach(() => vi.resetModules());

/** A complete `sku_provenance_public` row as PostgREST returns it (snake_case). */
const publicRow: SkuProvenancePublicRow = {
  slug: "janson-geisha-jc901",
  gtin: "0840012345678",
  curated_story: "Grown on Quetzal Ridge at 1650m.",
  green_lot_code: "JC-901",
  pack_format: "whole-bean",
  bag_size: "250g",
  product_name: "Janson Geisha",
  variety: "Geisha",
  process: "Washed",
  cupping_score: "91", // PostgREST may serialize a numeric as a string
  sca_grade: "Presidential",
  is_single_origin: true,
};

// ─────────────────────────── mapper ────────────────────────────────────────

describe("mapSkuProvenancePublic", () => {
  it("maps the snake_case projection to camelCase, coercing the cup score", async () => {
    const { mapSkuProvenancePublic } = await import(
      "@/lib/db/provenance-microsite"
    );
    const m = mapSkuProvenancePublic(publicRow);
    expect(m).toEqual({
      slug: "janson-geisha-jc901",
      gtin: "0840012345678",
      curatedStory: "Grown on Quetzal Ridge at 1650m.",
      greenLotCode: "JC-901",
      packFormat: "whole-bean",
      bagSize: "250g",
      productName: "Janson Geisha",
      variety: "Geisha",
      process: "Washed",
      cuppingScore: 91,
      scaGrade: "Presidential",
      isSingleOrigin: true,
    });
  });

  it("PRESERVES a null cup score / gtin / story — never fabricates a 0", async () => {
    const { mapSkuProvenancePublic } = await import(
      "@/lib/db/provenance-microsite"
    );
    const m = mapSkuProvenancePublic({
      ...publicRow,
      gtin: null,
      curated_story: null,
      cupping_score: null,
    });
    expect(m.cuppingScore).toBeNull();
    expect(m.gtin).toBeNull();
    expect(m.curatedStory).toBeNull();
  });
});

// ─────────────────────────── getPublicProvenance ───────────────────────────

describe("getPublicProvenance", () => {
  it("reads the sku_provenance_public view, ordered by slug, and maps the rows", async () => {
    const { client, calls } = makeClient({ data: [publicRow], error: null });
    getSupabaseMock.mockReturnValue(client);

    const { getPublicProvenance } = await import(
      "@/lib/db/provenance-microsite"
    );
    const rows = await getPublicProvenance();

    expect(calls.from).toBe("sku_provenance_public");
    expect(calls.orderArgs[0][0]).toBe("slug");
    expect(rows).toHaveLength(1);
    expect(rows[0].greenLotCode).toBe("JC-901");
    expect(rows[0].cuppingScore).toBe(91);
  });

  it("throws a labelled error when the view query fails", async () => {
    const { client } = makeClient({ data: null, error: { message: "boom" } });
    getSupabaseMock.mockReturnValue(client);
    const { getPublicProvenance } = await import(
      "@/lib/db/provenance-microsite"
    );
    await expect(getPublicProvenance()).rejects.toThrow(
      "getPublicProvenance: boom",
    );
  });
});

// ─────────────────────────── getPublicProvenanceBySlug ─────────────────────

describe("getPublicProvenanceBySlug", () => {
  it("filters the view by slug and returns the single mapped row", async () => {
    const { client, calls } = makeClient({ data: [publicRow], error: null });
    getSupabaseMock.mockReturnValue(client);

    const { getPublicProvenanceBySlug } = await import(
      "@/lib/db/provenance-microsite"
    );
    const row = await getPublicProvenanceBySlug("janson-geisha-jc901");

    expect(calls.from).toBe("sku_provenance_public");
    expect(calls.eqArgs).toContainEqual(["slug", "janson-geisha-jc901"]);
    expect(row?.slug).toBe("janson-geisha-jc901");
    expect(row?.scaGrade).toBe("Presidential");
  });

  it("returns null when no published row matches the slug", async () => {
    const { client } = makeClient({ data: [], error: null });
    getSupabaseMock.mockReturnValue(client);
    const { getPublicProvenanceBySlug } = await import(
      "@/lib/db/provenance-microsite"
    );
    expect(await getPublicProvenanceBySlug("nope")).toBeNull();
  });

  it("throws a labelled error when the lookup fails", async () => {
    const { client } = makeClient({ data: null, error: { message: "down" } });
    getSupabaseMock.mockReturnValue(client);
    const { getPublicProvenanceBySlug } = await import(
      "@/lib/db/provenance-microsite"
    );
    await expect(getPublicProvenanceBySlug("x")).rejects.toThrow(
      "getPublicProvenanceBySlug: down",
    );
  });
});

// ─────────────────────────── resolveProvenance (the anon RPC) ──────────────

describe("resolveProvenance", () => {
  it("calls resolve_provenance with the snake_case p_slug arg and returns the JSON", async () => {
    const assembled = {
      slug: "janson-geisha-jc901",
      gtin: "0840012345678",
      green_lot_code: "JC-901",
      product_name: "Janson Geisha",
      cupping_score: 91,
      sca_grade: "Presidential",
      eudr_status: "compliant",
      origin_plots: [
        {
          plot_name: "Quetzal Ridge",
          established_year: 2018,
          centroid: { type: "Point", coordinates: [-82.5, 8.8] },
          geolocated: true,
          deforestation_free: true,
        },
      ],
      crew_labels: ["Crew Quetzal"],
      processing_timeline: [{ kind: "cherry_intake", occurred_at: "2026-06-20" }],
    };
    const { client, calls } = makeClient({ data: assembled, error: null });
    getSupabaseMock.mockReturnValue(client);

    const { resolveProvenance } = await import("@/lib/db/provenance-microsite");
    const r = await resolveProvenance("janson-geisha-jc901");

    expect(calls.rpcName).toBe("resolve_provenance");
    expect(calls.rpcArgs).toEqual({ p_slug: "janson-geisha-jc901" });
    expect(r?.slug).toBe("janson-geisha-jc901");
    expect(r?.eudr_status).toBe("compliant");
    expect(r?.origin_plots[0].plot_name).toBe("Quetzal Ridge");
    expect(r?.crew_labels).toEqual(["Crew Quetzal"]);
  });

  it("returns null when the resolver yields NULL (unpublished / unknown slug)", async () => {
    const { client } = makeClient({ data: null, error: null });
    getSupabaseMock.mockReturnValue(client);
    const { resolveProvenance } = await import("@/lib/db/provenance-microsite");
    expect(await resolveProvenance("unpublished")).toBeNull();
  });

  it("throws a labelled error when the resolver RPC fails", async () => {
    const { client } = makeClient({ data: null, error: { message: "rpc-fail" } });
    getSupabaseMock.mockReturnValue(client);
    const { resolveProvenance } = await import("@/lib/db/provenance-microsite");
    await expect(resolveProvenance("x")).rejects.toThrow(
      "resolveProvenance: rpc-fail",
    );
  });
});

// ─────────────────────────── getProvenancePages (owner admin) ──────────────

describe("getProvenancePages", () => {
  it("reads the tenant-scoped provenance_pages table and maps to camelCase", async () => {
    const pageRow = {
      id: 5,
      sku_id: 12,
      slug: "janson-geisha-jc901",
      gtin: "0840012345678",
      is_published: true,
      curated_story: "story",
      created_at: "2026-06-20T00:00:00Z",
      updated_at: "2026-06-21T00:00:00Z",
    };
    const { client, calls } = makeClient({ data: [pageRow], error: null });
    getSupabaseMock.mockReturnValue(client);

    const { getProvenancePages } = await import(
      "@/lib/db/provenance-microsite"
    );
    const rows = await getProvenancePages();

    expect(calls.from).toBe("provenance_pages");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: 5,
      skuId: 12,
      slug: "janson-geisha-jc901",
      gtin: "0840012345678",
      isPublished: true,
      curatedStory: "story",
      createdAt: "2026-06-20T00:00:00Z",
      updatedAt: "2026-06-21T00:00:00Z",
    });
  });

  it("throws a labelled error when the table read fails", async () => {
    const { client } = makeClient({ data: null, error: { message: "rls" } });
    getSupabaseMock.mockReturnValue(client);
    const { getProvenancePages } = await import(
      "@/lib/db/provenance-microsite"
    );
    await expect(getProvenancePages()).rejects.toThrow(
      "getProvenancePages: rls",
    );
  });
});
