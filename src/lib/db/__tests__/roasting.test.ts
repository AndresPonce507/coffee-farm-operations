import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  RoasterRow,
  RoastProfileRow,
  RoastBatchRow,
  RoastCurvePointRow,
  RoastEventRow,
  RoastAlogImportRow,
  RoastSkuRow,
  RoastShrinkageByLotRow,
  RoastTraceabilityRow,
} from "@/lib/db/roasting";

/**
 * Coverage of the `roasting.ts` READ-port (P3-S10 — roasting): the pure mappers
 * (snake_case view/table row → camelCase domain, numeric coercion of id/kg/temp/pct
 * columns PostgREST may serialize as strings, NULL preservation for an un-finalized
 * batch's roasted_kg_out / shrinkage_pct, a profile's un-set DTR / locked_at, an
 * import's max_deviation_c, a SKU's price/GTIN, and the left-joined grade columns in
 * roast_traceability) and the `cache()`-wrapped getters' fetch + map round-trip.
 *
 * Strategy mirrors milling.test.ts: mock `@/lib/supabase/server` so `getSupabase()`
 * returns a chainable, thenable query-builder. The roast oversell / conservation /
 * golden gate is the migration's job (pinned by its PGlite tests, not re-implemented
 * here); this port only proves the row→domain seam + NULL handling survive `cache()`
 * and hit the right table/view. DB-GENERATED `shrinkage_pct` is carried VERBATIM.
 */

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

// ----- fixture rows ---------------------------------------------------------

const roasterRow: RoasterRow = {
  id: "1",
  kind: "drum",
  name: "Probat L12 (drum)",
  capacity_kg: "12",
  created_at: "2026-06-01T00:00:00Z",
};

// A DRAFT profile: locked_at / retired_at NULL, optional DTR present.
const draftProfileRow: RoastProfileRow = {
  id: "7",
  name: "Janson House Filter",
  version: 1,
  variety: "Geisha",
  roast_level: "medium-light",
  target_charge_temp_c: "200",
  target_drop_temp_c: "205",
  target_total_time_s: "600",
  target_dtr_pct: "22",
  status: "draft",
  locked_at: null,
  retired_at: null,
  created_at: "2026-06-20T00:00:00Z",
};

// A house-style profile spanning varieties (variety NULL) with no DTR target.
const houseProfileRow: RoastProfileRow = {
  id: 8,
  name: "Janson House Espresso",
  version: 2,
  variety: null,
  roast_level: "medium-dark",
  target_charge_temp_c: 195,
  target_drop_temp_c: 218,
  target_total_time_s: 720,
  target_dtr_pct: null,
  status: "approved",
  locked_at: "2026-06-22T00:00:00Z",
  retired_at: null,
  created_at: "2026-06-21T00:00:00Z",
};

// An OPEN batch: roasted_lot_code / roasted_kg_out / shrinkage_pct NULL until finalize.
const openBatchRow: RoastBatchRow = {
  id: "5",
  green_lot_code: "JC-742",
  profile_id: "8",
  roaster_id: "1",
  green_in_kg: "12",
  roasted_lot_code: null,
  roasted_kg_out: null,
  shrinkage_pct: null,
  green_shipment_id: "31",
  status: "open",
  opened_at: "2026-06-24T10:00:00Z",
  created_at: "2026-06-24T10:00:00Z",
};

// A FINALIZED batch: roasted node + shrinkage populated (DB-GENERATED).
const finalizedBatchRow: RoastBatchRow = {
  id: 6,
  green_lot_code: "JC-743",
  profile_id: 8,
  roaster_id: 1,
  green_in_kg: 10,
  roasted_lot_code: "JC-803",
  roasted_kg_out: 8.4,
  shrinkage_pct: "0.16",
  green_shipment_id: 32,
  status: "finalized",
  opened_at: "2026-06-20T09:00:00Z",
  created_at: "2026-06-20T09:00:00Z",
};

const curvePointRow: RoastCurvePointRow = {
  id: "100",
  batch_id: "5",
  t_seconds: "60",
  bean_temp_c: "150",
  env_temp_c: "180",
  ror_c_per_min: "-50",
  created_at: "2026-06-24T10:01:00Z",
};

// A point with only BT logged — ET / RoR NULL, preserved (never fabricated to 0).
const sparseCurvePointRow: RoastCurvePointRow = {
  id: 101,
  batch_id: 5,
  t_seconds: 0,
  bean_temp_c: 200,
  env_temp_c: null,
  ror_c_per_min: null,
  created_at: "2026-06-24T10:00:00Z",
};

const eventRow: RoastEventRow = {
  id: "200",
  batch_id: "5",
  marker: "first_crack",
  t_seconds: "540",
  temp_c: "196",
  created_at: "2026-06-24T10:09:00Z",
};

const alogImportRow: RoastAlogImportRow = {
  id: "9",
  batch_id: "5",
  source_filename: "janson-2026-06-25.alog",
  alog_payload: { points: [], events: [] },
  max_deviation_c: "4.2",
  point_count: 120,
  created_at: "2026-06-24T11:00:00Z",
};

// An import receipt with no deviation computed yet / no filename — NULLs preserved.
const bareAlogImportRow: RoastAlogImportRow = {
  id: 10,
  batch_id: 5,
  source_filename: null,
  alog_payload: {},
  max_deviation_c: null,
  point_count: 0,
  created_at: "2026-06-24T11:05:00Z",
};

const skuRow: RoastSkuRow = {
  id: "11",
  roast_batch_id: "6",
  roasted_lot_code: "JC-803",
  sku_code: "JANSON-GEISHA-250",
  bag_size_g: 250,
  price_usd_cents: 2400,
  gtin: "07401234567890",
  is_active: true,
  created_at: "2026-06-24T12:00:00Z",
};

// A SKU with no price / GTIN set — NULLs preserved.
const draftSkuRow: RoastSkuRow = {
  id: 12,
  roast_batch_id: 6,
  roasted_lot_code: "JC-803",
  sku_code: "JANSON-GEISHA-1000",
  bag_size_g: 1000,
  price_usd_cents: null,
  gtin: null,
  is_active: false,
  created_at: "2026-06-24T12:05:00Z",
};

const shrinkageRow: RoastShrinkageByLotRow = {
  green_lot_code: "JC-743",
  green_in_kg: "10",
  roasted_kg_out: "8.4",
  shrinkage_pct: "0.16",
};

// Full traceability chain (finalized batch joined to grade).
const traceRow: RoastTraceabilityRow = {
  roast_batch_id: "6",
  roasted_lot_code: "JC-803",
  green_lot_code: "JC-743",
  green_in_kg: "10",
  roasted_kg_out: "8.4",
  shrinkage_pct: "0.16",
  status: "finalized",
  profile_name: "Janson House Espresso",
  profile_version: 2,
  roast_level: "medium-dark",
  profile_status: "approved",
  cupping_score: "88.5",
  sca_grade: "Specialty",
  sca_prep: "European Prep",
  cat1_defects: 0,
  cat2_defects: 3,
};

// An open batch with no grade yet — left-joined grade columns NULL, preserved.
const bareTraceRow: RoastTraceabilityRow = {
  roast_batch_id: 5,
  roasted_lot_code: null,
  green_lot_code: "JC-742",
  green_in_kg: 12,
  roasted_kg_out: null,
  shrinkage_pct: null,
  status: "open",
  profile_name: "Janson House Espresso",
  profile_version: 2,
  roast_level: "medium-dark",
  profile_status: "approved",
  cupping_score: null,
  sca_grade: null,
  sca_prep: null,
  cat1_defects: null,
  cat2_defects: null,
};

// ----- pure mappers ---------------------------------------------------------

describe("mapRoaster", () => {
  it("maps a roasters row with numeric coercion", async () => {
    const { mapRoaster } = await import("@/lib/db/roasting");
    expect(mapRoaster(roasterRow)).toEqual({
      id: 1,
      kind: "drum",
      name: "Probat L12 (drum)",
      capacityKg: 12,
      createdAt: "2026-06-01T00:00:00Z",
    });
  });
});

describe("mapRoastProfile", () => {
  it("maps a draft profile (numeric coercion, NULL locked/retired preserved)", async () => {
    const { mapRoastProfile } = await import("@/lib/db/roasting");
    expect(mapRoastProfile(draftProfileRow)).toEqual({
      id: 7,
      name: "Janson House Filter",
      version: 1,
      variety: "Geisha",
      roastLevel: "medium-light",
      targetChargeTempC: 200,
      targetDropTempC: 205,
      targetTotalTimeS: 600,
      targetDtrPct: 22,
      status: "draft",
      lockedAt: null,
      retiredAt: null,
      createdAt: "2026-06-20T00:00:00Z",
    });
  });

  it("preserves a NULL variety / DTR for a house style, carries the lock stamp", async () => {
    const { mapRoastProfile } = await import("@/lib/db/roasting");
    const p = mapRoastProfile(houseProfileRow);
    expect(p.variety).toBeNull();
    expect(p.targetDtrPct).toBeNull();
    expect(p.status).toBe("approved");
    expect(p.lockedAt).toBe("2026-06-22T00:00:00Z");
  });
});

describe("mapRoastBatch", () => {
  it("maps a finalized batch and carries the DB-GENERATED shrinkage verbatim", async () => {
    const { mapRoastBatch } = await import("@/lib/db/roasting");
    expect(mapRoastBatch(finalizedBatchRow)).toEqual({
      id: 6,
      greenLotCode: "JC-743",
      profileId: 8,
      roasterId: 1,
      greenInKg: 10,
      roastedLotCode: "JC-803",
      roastedKgOut: 8.4,
      shrinkagePct: 0.16,
      greenShipmentId: 32,
      status: "finalized",
      openedAt: "2026-06-20T09:00:00Z",
      createdAt: "2026-06-20T09:00:00Z",
    });
  });

  it("preserves NULL roasted_lot_code / roasted_kg_out / shrinkage for an open batch", async () => {
    const { mapRoastBatch } = await import("@/lib/db/roasting");
    const b = mapRoastBatch(openBatchRow);
    expect(b.id).toBe(5);
    expect(b.greenInKg).toBe(12);
    expect(b.roastedLotCode).toBeNull();
    expect(b.roastedKgOut).toBeNull();
    expect(b.shrinkagePct).toBeNull();
    expect(b.greenShipmentId).toBe(31);
  });
});

describe("mapRoastCurvePoint", () => {
  it("maps a full BT/ET/RoR point with numeric coercion", async () => {
    const { mapRoastCurvePoint } = await import("@/lib/db/roasting");
    expect(mapRoastCurvePoint(curvePointRow)).toEqual({
      id: 100,
      batchId: 5,
      tSeconds: 60,
      beanTempC: 150,
      envTempC: 180,
      rorCPerMin: -50,
      createdAt: "2026-06-24T10:01:00Z",
    });
  });

  it("preserves NULL ET / RoR for a sparse point (never fabricated to 0)", async () => {
    const { mapRoastCurvePoint } = await import("@/lib/db/roasting");
    const p = mapRoastCurvePoint(sparseCurvePointRow);
    expect(p.tSeconds).toBe(0);
    expect(p.beanTempC).toBe(200);
    expect(p.envTempC).toBeNull();
    expect(p.rorCPerMin).toBeNull();
  });
});

describe("mapRoastEvent", () => {
  it("maps a phase marker with numeric coercion", async () => {
    const { mapRoastEvent } = await import("@/lib/db/roasting");
    expect(mapRoastEvent(eventRow)).toEqual({
      id: 200,
      batchId: 5,
      marker: "first_crack",
      tSeconds: 540,
      tempC: 196,
      createdAt: "2026-06-24T10:09:00Z",
    });
  });
});

describe("mapRoastAlogImport", () => {
  it("maps an import receipt and forwards the payload verbatim", async () => {
    const { mapRoastAlogImport } = await import("@/lib/db/roasting");
    expect(mapRoastAlogImport(alogImportRow)).toEqual({
      id: 9,
      batchId: 5,
      sourceFilename: "janson-2026-06-25.alog",
      alogPayload: { points: [], events: [] },
      maxDeviationC: 4.2,
      pointCount: 120,
      createdAt: "2026-06-24T11:00:00Z",
    });
  });

  it("preserves NULL filename / deviation (never fabricated)", async () => {
    const { mapRoastAlogImport } = await import("@/lib/db/roasting");
    const i = mapRoastAlogImport(bareAlogImportRow);
    expect(i.sourceFilename).toBeNull();
    expect(i.maxDeviationC).toBeNull();
    expect(i.pointCount).toBe(0);
  });
});

describe("mapRoastSku", () => {
  it("maps a SKU with numeric coercion and boolean pass-through", async () => {
    const { mapRoastSku } = await import("@/lib/db/roasting");
    expect(mapRoastSku(skuRow)).toEqual({
      id: 11,
      roastBatchId: 6,
      roastedLotCode: "JC-803",
      skuCode: "JANSON-GEISHA-250",
      bagSizeG: 250,
      priceUsdCents: 2400,
      gtin: "07401234567890",
      isActive: true,
      createdAt: "2026-06-24T12:00:00Z",
    });
  });

  it("preserves NULL price / GTIN and carries is_active=false verbatim", async () => {
    const { mapRoastSku } = await import("@/lib/db/roasting");
    const s = mapRoastSku(draftSkuRow);
    expect(s.priceUsdCents).toBeNull();
    expect(s.gtin).toBeNull();
    expect(s.isActive).toBe(false);
  });
});

describe("mapRoastShrinkageByLot", () => {
  it("maps the per-lot shrinkage rollup with numeric coercion", async () => {
    const { mapRoastShrinkageByLot } = await import("@/lib/db/roasting");
    expect(mapRoastShrinkageByLot(shrinkageRow)).toEqual({
      greenLotCode: "JC-743",
      greenInKg: 10,
      roastedKgOut: 8.4,
      shrinkagePct: 0.16,
    });
  });
});

describe("mapRoastTraceability", () => {
  it("maps the full per-bag QR chain with numeric coercion", async () => {
    const { mapRoastTraceability } = await import("@/lib/db/roasting");
    expect(mapRoastTraceability(traceRow)).toEqual({
      roastBatchId: 6,
      roastedLotCode: "JC-803",
      greenLotCode: "JC-743",
      greenInKg: 10,
      roastedKgOut: 8.4,
      shrinkagePct: 0.16,
      status: "finalized",
      profileName: "Janson House Espresso",
      profileVersion: 2,
      roastLevel: "medium-dark",
      profileStatus: "approved",
      cuppingScore: 88.5,
      scaGrade: "Specialty",
      scaPrep: "European Prep",
      cat1Defects: 0,
      cat2Defects: 3,
    });
  });

  it("preserves NULL left-joined grade columns for an ungraded open batch", async () => {
    const { mapRoastTraceability } = await import("@/lib/db/roasting");
    const t = mapRoastTraceability(bareTraceRow);
    expect(t.roastedLotCode).toBeNull();
    expect(t.cuppingScore).toBeNull();
    expect(t.scaGrade).toBeNull();
    expect(t.scaPrep).toBeNull();
    expect(t.cat1Defects).toBeNull();
    expect(t.cat2Defects).toBeNull();
  });
});

// ----- getters --------------------------------------------------------------

describe("listRoasters", () => {
  it("reads roasters and returns camelCase entries", async () => {
    const { client, fromCalls } = makeClient({
      roasters: { data: [roasterRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);
    const { listRoasters } = await import("@/lib/db/roasting");
    const rows = await listRoasters();
    expect(fromCalls).toContain("roasters");
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Probat L12 (drum)");
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      roasters: { data: null, error: { message: "roasters boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { listRoasters } = await import("@/lib/db/roasting");
    await expect(listRoasters()).rejects.toThrow("listRoasters: roasters boom");
  });
});

describe("getRoastProfiles", () => {
  it("reads roast_profiles and returns camelCase entries", async () => {
    const { client, fromCalls } = makeClient({
      roast_profiles: { data: [draftProfileRow, houseProfileRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getRoastProfiles } = await import("@/lib/db/roasting");
    const rows = await getRoastProfiles();
    expect(fromCalls).toContain("roast_profiles");
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe("draft");
    expect(rows[1].variety).toBeNull();
  });
});

describe("getRoastBatches", () => {
  it("reads roast_batches (the /roast board) and returns camelCase entries", async () => {
    const { client, fromCalls } = makeClient({
      roast_batches: { data: [openBatchRow, finalizedBatchRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getRoastBatches } = await import("@/lib/db/roasting");
    const rows = await getRoastBatches();
    expect(fromCalls).toContain("roast_batches");
    expect(rows).toHaveLength(2);
    expect(rows[0].roastedKgOut).toBeNull();
    expect(rows[1].shrinkagePct).toBe(0.16);
  });
});

describe("getRoastBatch", () => {
  it("reads one roast_batches row by id", async () => {
    const { client, fromCalls } = makeClient({
      roast_batches: { data: [finalizedBatchRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getRoastBatch } = await import("@/lib/db/roasting");
    const b = await getRoastBatch(6);
    expect(fromCalls).toContain("roast_batches");
    expect(b).not.toBeNull();
    expect(b?.roastedLotCode).toBe("JC-803");
  });

  it("returns null when the batch does not exist", async () => {
    const { client } = makeClient({
      roast_batches: { data: [], error: null },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getRoastBatch } = await import("@/lib/db/roasting");
    expect(await getRoastBatch(999)).toBeNull();
  });
});

describe("getRoastCurvePoints", () => {
  it("reads roast_curve_points for a batch", async () => {
    const { client, fromCalls } = makeClient({
      roast_curve_points: { data: [sparseCurvePointRow, curvePointRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getRoastCurvePoints } = await import("@/lib/db/roasting");
    const pts = await getRoastCurvePoints(5);
    expect(fromCalls).toContain("roast_curve_points");
    expect(pts).toHaveLength(2);
    expect(pts[0].envTempC).toBeNull();
  });
});

describe("getRoastEvents", () => {
  it("reads roast_events for a batch", async () => {
    const { client, fromCalls } = makeClient({
      roast_events: { data: [eventRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getRoastEvents } = await import("@/lib/db/roasting");
    const evs = await getRoastEvents(5);
    expect(fromCalls).toContain("roast_events");
    expect(evs[0].marker).toBe("first_crack");
  });
});

describe("getRoastAlogImports", () => {
  it("reads roast_alog_imports for a batch", async () => {
    const { client, fromCalls } = makeClient({
      roast_alog_imports: { data: [alogImportRow, bareAlogImportRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getRoastAlogImports } = await import("@/lib/db/roasting");
    const imports = await getRoastAlogImports(5);
    expect(fromCalls).toContain("roast_alog_imports");
    expect(imports).toHaveLength(2);
    expect(imports[1].maxDeviationC).toBeNull();
  });
});

describe("getRoastShrinkageByLot", () => {
  it("reads roast_shrinkage_by_lot and returns camelCase entries", async () => {
    const { client, fromCalls } = makeClient({
      roast_shrinkage_by_lot: { data: [shrinkageRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getRoastShrinkageByLot } = await import("@/lib/db/roasting");
    const rows = await getRoastShrinkageByLot();
    expect(fromCalls).toContain("roast_shrinkage_by_lot");
    expect(rows[0].shrinkagePct).toBe(0.16);
  });
});

describe("getRoastTraceability", () => {
  it("reads roast_traceability and returns the per-bag QR chain", async () => {
    const { client, fromCalls } = makeClient({
      roast_traceability: { data: [traceRow, bareTraceRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getRoastTraceability } = await import("@/lib/db/roasting");
    const rows = await getRoastTraceability();
    expect(fromCalls).toContain("roast_traceability");
    expect(rows).toHaveLength(2);
    expect(rows[0].scaPrep).toBe("European Prep");
    expect(rows[1].cuppingScore).toBeNull();
  });
});

describe("getRoastTraceabilityForBatch", () => {
  it("reads one roast_traceability row by batch id", async () => {
    const { client } = makeClient({
      roast_traceability: { data: [traceRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getRoastTraceabilityForBatch } = await import("@/lib/db/roasting");
    const t = await getRoastTraceabilityForBatch(6);
    expect(t).not.toBeNull();
    expect(t?.roastedLotCode).toBe("JC-803");
  });

  it("returns null when the batch has no trace row", async () => {
    const { client } = makeClient({
      roast_traceability: { data: [], error: null },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getRoastTraceabilityForBatch } = await import("@/lib/db/roasting");
    expect(await getRoastTraceabilityForBatch(999)).toBeNull();
  });
});

describe("listRoastSkus", () => {
  it("reads roast_skus and returns camelCase entries", async () => {
    const { client, fromCalls } = makeClient({
      roast_skus: { data: [skuRow, draftSkuRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);
    const { listRoastSkus } = await import("@/lib/db/roasting");
    const rows = await listRoastSkus();
    expect(fromCalls).toContain("roast_skus");
    expect(rows).toHaveLength(2);
    expect(rows[1].priceUsdCents).toBeNull();
  });
});

describe("getRoastSkusForBatch", () => {
  it("reads roast_skus for a batch", async () => {
    const { client, fromCalls } = makeClient({
      roast_skus: { data: [skuRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getRoastSkusForBatch } = await import("@/lib/db/roasting");
    const rows = await getRoastSkusForBatch(6);
    expect(fromCalls).toContain("roast_skus");
    expect(rows[0].skuCode).toBe("JANSON-GEISHA-250");
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      roast_skus: { data: null, error: { message: "skus boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getRoastSkusForBatch } = await import("@/lib/db/roasting");
    await expect(getRoastSkusForBatch(6)).rejects.toThrow(
      "getRoastSkusForBatch: skus boom",
    );
  });
});
