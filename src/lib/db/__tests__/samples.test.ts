import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GreenSampleRow, SamplePipelineRow } from "@/lib/db/samples";

/**
 * Coverage of the `samples.ts` READ-port (P3-S2 — B2B sample tracking +
 * sample-approval-as-contract-prereq): the pure mappers (snake_case view/table row
 * → camelCase domain, numeric coercion of id/buyer_id/grams/score columns PostgREST
 * may serialize as strings, NULL preservation for a spec/type sample with no buyer,
 * an un-drawn shipment, an un-scored lot, an un-rendered verdict) and the
 * `cache()`-wrapped getters' fetch + map round-trip:
 *
 *   - `getSamplePipeline()`     reads `v_sample_pipeline` (OPEN samples awaiting feedback — buyer_verdict IS NULL).
 *   - `listSamplesForLot(lot)`  reads `green_samples` filtered to one green lot (full history incl. verdicts, newest first).
 *
 * Strategy mirrors `pricing.test.ts` / `greenlots.test.ts`: mock `@/lib/supabase/server`
 * so `getSupabase()` returns a chainable, thenable query-builder. The sample-pipeline
 * join / ATP-draw is the view's/RPC's job (pinned by the migration's PGlite tests, not
 * re-implemented here); this port only proves the row→domain seam + NULL handling
 * survive `cache()` and hit the right table/view.
 */

// ----- chainable, per-table Supabase query-builder stub ---------------------

interface QueryResult<T> {
  data: T;
  error: { message: string } | null;
}

type TableResults = Record<string, QueryResult<unknown>>;

function makeClient(results: TableResults) {
  const fromCalls: string[] = [];
  const client = {
    from: (table: string) => {
      fromCalls.push(table);
      const result = results[table] ?? { data: [], error: null };
      const builder: Record<string, unknown> = {
        select: vi.fn(() => builder),
        order: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        limit: vi.fn(() => builder),
        then: (
          onFulfilled: (value: QueryResult<unknown>) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) => Promise.resolve(result).then(onFulfilled, onRejected),
      };
      return builder;
    },
  };
  return { client, fromCalls };
}

const getSupabaseMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => getSupabaseMock(),
}));

beforeEach(() => {
  getSupabaseMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

// ----- sample rows ----------------------------------------------------------

const pipelineRow: SamplePipelineRow = {
  sample_id: "12",
  green_lot_code: "JC-204",
  buyer_id: "3",
  buyer_name: "Zürich Roastery AG",
  sample_kind: "pre_shipment",
  grams: "200", // numeric PostgREST may serialize as a string
  courier: "DHL Express",
  tracking_no: "JD0140290923",
  dispatched_at: "2026-06-20T10:00:00Z",
  sca_grade: "Presidential",
  cupping_score: "91",
};

// A spec/type sample with no buyer (buyer_id IS NULL ⇒ buyer_name LEFT-JOIN miss),
// no courier/tracking, and an un-scored lot — every nullable preserved, never 0/"".
const specPipelineRow: SamplePipelineRow = {
  sample_id: 13,
  green_lot_code: "JC-301",
  buyer_id: null,
  buyer_name: null,
  sample_kind: "type",
  grams: 100,
  courier: null,
  tracking_no: null,
  dispatched_at: "2026-06-21T09:00:00Z",
  sca_grade: "Specialty",
  cupping_score: null,
};

const sampleRow: GreenSampleRow = {
  id: "12",
  green_lot_code: "JC-204",
  buyer_id: "3",
  sample_kind: "pre_shipment",
  grams: "200",
  courier: "DHL Express",
  tracking_no: "JD0140290923",
  shipment_id: "77", // a pre_shipment draw stamped the lot_shipments id
  buyer_score: "92.5",
  buyer_verdict: "approved",
  verdict_at: "2026-06-24T12:00:00Z",
  dispatched_at: "2026-06-20T10:00:00Z",
  created_at: "2026-06-20T10:00:01Z",
};

// An offer sample still open: no ATP draw (shipment_id null), no verdict yet.
const openSampleRow: GreenSampleRow = {
  id: 14,
  green_lot_code: "JC-204",
  buyer_id: null,
  sample_kind: "offer",
  grams: 50,
  courier: null,
  tracking_no: null,
  shipment_id: null,
  buyer_score: null,
  buyer_verdict: null,
  verdict_at: null,
  dispatched_at: "2026-06-22T08:00:00Z",
  created_at: "2026-06-22T08:00:01Z",
};

// ----- pure mapper: mapSamplePipelineEntry ----------------------------------

describe("mapSamplePipelineEntry", () => {
  it("maps a v_sample_pipeline row to a camelCase entry with numeric coercion", async () => {
    const { mapSamplePipelineEntry } = await import("@/lib/db/samples");
    expect(mapSamplePipelineEntry(pipelineRow)).toEqual({
      sampleId: 12,
      greenLotCode: "JC-204",
      buyerId: 3,
      buyerName: "Zürich Roastery AG",
      sampleKind: "pre_shipment",
      grams: 200,
      courier: "DHL Express",
      trackingNo: "JD0140290923",
      dispatchedAt: "2026-06-20T10:00:00Z",
      scaGrade: "Presidential",
      cuppingScore: 91,
    });
  });

  it("preserves NULL buyer/courier/tracking/score for a spec sample (never fabricated)", async () => {
    const { mapSamplePipelineEntry } = await import("@/lib/db/samples");
    const e = mapSamplePipelineEntry(specPipelineRow);
    expect(e.buyerId).toBeNull();
    expect(e.buyerName).toBeNull();
    expect(e.courier).toBeNull();
    expect(e.trackingNo).toBeNull();
    expect(e.cuppingScore).toBeNull();
    expect(e.sampleKind).toBe("type");
  });
});

// ----- pure mapper: mapGreenSample ------------------------------------------

describe("mapGreenSample", () => {
  it("maps a green_samples row (incl. verdict) with numeric coercion", async () => {
    const { mapGreenSample } = await import("@/lib/db/samples");
    expect(mapGreenSample(sampleRow)).toEqual({
      id: 12,
      greenLotCode: "JC-204",
      buyerId: 3,
      sampleKind: "pre_shipment",
      grams: 200,
      courier: "DHL Express",
      trackingNo: "JD0140290923",
      shipmentId: 77,
      buyerScore: 92.5,
      buyerVerdict: "approved",
      verdictAt: "2026-06-24T12:00:00Z",
      dispatchedAt: "2026-06-20T10:00:00Z",
      createdAt: "2026-06-20T10:00:01Z",
    });
  });

  it("preserves NULL shipment/score/verdict for an open offer sample (never fabricated)", async () => {
    const { mapGreenSample } = await import("@/lib/db/samples");
    const s = mapGreenSample(openSampleRow);
    expect(s.shipmentId).toBeNull();
    expect(s.buyerScore).toBeNull();
    expect(s.buyerVerdict).toBeNull();
    expect(s.verdictAt).toBeNull();
    expect(s.buyerId).toBeNull();
  });
});

// ----- getter: getSamplePipeline --------------------------------------------

describe("getSamplePipeline", () => {
  it("reads v_sample_pipeline and returns camelCase entries", async () => {
    const { client, fromCalls } = makeClient({
      v_sample_pipeline: { data: [pipelineRow, specPipelineRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getSamplePipeline } = await import("@/lib/db/samples");
    const pipeline = await getSamplePipeline();

    expect(fromCalls).toContain("v_sample_pipeline");
    expect(pipeline).toHaveLength(2);
    expect(pipeline[0].sampleId).toBe(12);
    expect(pipeline[0].buyerName).toBe("Zürich Roastery AG");
    expect(pipeline[1].buyerId).toBeNull();
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      v_sample_pipeline: { data: null, error: { message: "pipeline boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getSamplePipeline } = await import("@/lib/db/samples");
    await expect(getSamplePipeline()).rejects.toThrow(
      "getSamplePipeline: pipeline boom",
    );
  });
});

// ----- getter: listSamplesForLot --------------------------------------------

describe("listSamplesForLot", () => {
  it("reads green_samples for one lot and returns camelCase samples", async () => {
    const { client, fromCalls } = makeClient({
      green_samples: { data: [sampleRow, openSampleRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { listSamplesForLot } = await import("@/lib/db/samples");
    const samples = await listSamplesForLot("JC-204");

    expect(fromCalls).toContain("green_samples");
    expect(samples).toHaveLength(2);
    expect(samples[0].id).toBe(12);
    expect(samples[0].buyerVerdict).toBe("approved");
    expect(samples[1].buyerVerdict).toBeNull();
  });

  it("returns an empty array when the lot has no samples", async () => {
    const { client } = makeClient({
      green_samples: { data: [], error: null },
    });
    getSupabaseMock.mockReturnValue(client);
    const { listSamplesForLot } = await import("@/lib/db/samples");
    expect(await listSamplesForLot("JC-000")).toEqual([]);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      green_samples: { data: null, error: { message: "samples boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { listSamplesForLot } = await import("@/lib/db/samples");
    await expect(listSamplesForLot("JC-204")).rejects.toThrow(
      "listSamplesForLot: samples boom",
    );
  });
});
