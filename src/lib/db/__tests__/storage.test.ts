import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  LotStorageReadingRow,
  StorageCertificateRow,
  StorageLocationRow,
  StorageStatusRow,
} from "@/lib/db/storage";

/**
 * Coverage of the `storage.ts` READ-port (P3-S20 — controlled-environment
 * monitoring). The pure mappers (snake_case view/table row → camelCase domain,
 * numeric coercion of the band/reading columns PostgREST may serialize as strings,
 * NULL preservation for an unread location's latest values + its `in_band` flag —
 * a location with NO readings yet keeps `inBand = null`, never a fabricated false)
 * and the `cache()`-wrapped getters' fetch + map round-trip:
 *
 *   - `getStorageLocations()`        reads `storage_locations`     (the structured bands config).
 *   - `getStorageStatus()`           reads `v_storage_status`      (bands + latest reading + in-band flag).
 *   - `getLotStorageHistory(lot)`    reads `v_lot_storage_history` (one green lot's readings).
 *   - `getLotStorageCertificates(l)` reads `storage_certificates`  (one lot's append-only certs).
 *   - `listStorageCertificates()`    reads `storage_certificates`  (the whole cert ledger, newest first).
 *
 * Strategy mirrors `pricing.test.ts`: mock `@/lib/supabase/server` so `getSupabase()`
 * returns a chainable, thenable query-builder. The verdict/band math is the views'
 * job (pinned by the migration's PGlite tests); this port only proves the
 * row→domain seam + NULL handling survive `cache()` and hit the right table/view.
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

const locationRow: StorageLocationRow = {
  id: 1,
  code: "BODEGA-A",
  name: "Bodega A",
  temp_min_c: "15",
  temp_max_c: "25",
  rh_min_pct: "50",
  rh_max_pct: "65",
  aw_max: "0.65",
  created_at: "2026-06-20T10:00:00Z",
  updated_at: "2026-06-20T10:00:00Z",
};

const statusRow: StorageStatusRow = {
  location_id: 1,
  code: "BODEGA-A",
  name: "Bodega A",
  temp_min_c: "15",
  temp_max_c: "25",
  rh_min_pct: "50",
  rh_max_pct: "65",
  aw_max: "0.65",
  latest_temp_c: "21",
  latest_rh_pct: "58",
  latest_aw: "0.61",
  latest_reading_at: "2026-06-21T09:00:00Z",
  in_band: true,
};

const unreadStatusRow: StorageStatusRow = {
  location_id: 2,
  code: "BODEGA-B",
  name: "Bodega B",
  temp_min_c: "15",
  temp_max_c: "25",
  rh_min_pct: "50",
  rh_max_pct: "65",
  aw_max: "0.65",
  latest_temp_c: null, // no reading yet
  latest_rh_pct: null,
  latest_aw: null,
  latest_reading_at: null,
  in_band: null, // unknown ⇒ preserved, never a fabricated false
};

const historyRow: LotStorageReadingRow = {
  green_lot_code: "JC-701",
  location_id: 1,
  location_name: "Bodega A",
  reading_at: "2026-06-21T09:00:00Z",
  temp_c: "21",
  rh_pct: "58",
  aw: "0.61",
  source: "manual",
};

const certRow: StorageCertificateRow = {
  id: 9,
  green_lot_code: "JC-701",
  location_id: 1,
  window_start: "2026-06-01T00:00:00Z",
  window_end: "2026-06-21T00:00:00Z",
  readings_count: 20,
  in_band_pct: "100",
  verdict: "in-band",
  cert_hash: "\\xabcdef",
  issued_at: "2026-06-21T10:00:00Z",
  created_at: "2026-06-21T10:00:00Z",
};

// ----- pure mapper: mapStorageLocation --------------------------------------

describe("mapStorageLocation", () => {
  it("maps a storage_locations row to a camelCase location with numeric coercion", async () => {
    const { mapStorageLocation } = await import("@/lib/db/storage");
    expect(mapStorageLocation(locationRow)).toEqual({
      id: 1,
      code: "BODEGA-A",
      name: "Bodega A",
      tempMinC: 15,
      tempMaxC: 25,
      rhMinPct: 50,
      rhMaxPct: 65,
      awMax: 0.65,
      createdAt: "2026-06-20T10:00:00Z",
      updatedAt: "2026-06-20T10:00:00Z",
    });
  });
});

// ----- pure mapper: mapStorageStatus ----------------------------------------

describe("mapStorageStatus", () => {
  it("maps a v_storage_status row with numeric coercion + boolean in-band flag", async () => {
    const { mapStorageStatus } = await import("@/lib/db/storage");
    expect(mapStorageStatus(statusRow)).toEqual({
      locationId: 1,
      code: "BODEGA-A",
      name: "Bodega A",
      tempMinC: 15,
      tempMaxC: 25,
      rhMinPct: 50,
      rhMaxPct: 65,
      awMax: 0.65,
      latestTempC: 21,
      latestRhPct: 58,
      latestAw: 0.61,
      latestReadingAt: "2026-06-21T09:00:00Z",
      inBand: true,
    });
  });

  it("preserves NULL latest values + a NULL in_band (no reading ⇒ unknown, never false)", async () => {
    const { mapStorageStatus } = await import("@/lib/db/storage");
    const s = mapStorageStatus(unreadStatusRow);
    expect(s.latestTempC).toBeNull();
    expect(s.latestRhPct).toBeNull();
    expect(s.latestAw).toBeNull();
    expect(s.latestReadingAt).toBeNull();
    expect(s.inBand).toBeNull();
  });
});

// ----- pure mapper: mapLotStorageReading ------------------------------------

describe("mapLotStorageReading", () => {
  it("maps a v_lot_storage_history row with numeric coercion", async () => {
    const { mapLotStorageReading } = await import("@/lib/db/storage");
    expect(mapLotStorageReading(historyRow)).toEqual({
      greenLotCode: "JC-701",
      locationId: 1,
      locationName: "Bodega A",
      readingAt: "2026-06-21T09:00:00Z",
      tempC: 21,
      rhPct: 58,
      aw: 0.61,
      source: "manual",
    });
  });

  it("preserves NULL temp/rh/aw (a partial reading, never fabricated to 0)", async () => {
    const { mapLotStorageReading } = await import("@/lib/db/storage");
    const r = mapLotStorageReading({
      ...historyRow,
      temp_c: null,
      rh_pct: null,
      aw: null,
    });
    expect(r.tempC).toBeNull();
    expect(r.rhPct).toBeNull();
    expect(r.aw).toBeNull();
  });
});

// ----- pure mapper: mapStorageCertificate -----------------------------------

describe("mapStorageCertificate", () => {
  it("maps a storage_certificates row with numeric coercion + the cert hash", async () => {
    const { mapStorageCertificate } = await import("@/lib/db/storage");
    expect(mapStorageCertificate(certRow)).toEqual({
      id: 9,
      greenLotCode: "JC-701",
      locationId: 1,
      windowStart: "2026-06-01T00:00:00Z",
      windowEnd: "2026-06-21T00:00:00Z",
      readingsCount: 20,
      inBandPct: 100,
      verdict: "in-band",
      certHash: "\\xabcdef",
      issuedAt: "2026-06-21T10:00:00Z",
      createdAt: "2026-06-21T10:00:00Z",
    });
  });

  it("preserves a NULL in_band_pct", async () => {
    const { mapStorageCertificate } = await import("@/lib/db/storage");
    const c = mapStorageCertificate({ ...certRow, in_band_pct: null });
    expect(c.inBandPct).toBeNull();
  });
});

// ----- getter: getStorageLocations ------------------------------------------

describe("getStorageLocations", () => {
  it("reads storage_locations and returns camelCase locations", async () => {
    const { client, fromCalls } = makeClient({
      storage_locations: { data: [locationRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getStorageLocations } = await import("@/lib/db/storage");
    const rows = await getStorageLocations();

    expect(fromCalls).toContain("storage_locations");
    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe("BODEGA-A");
    expect(rows[0].awMax).toBe(0.65);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      storage_locations: { data: null, error: { message: "loc boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getStorageLocations } = await import("@/lib/db/storage");
    await expect(getStorageLocations()).rejects.toThrow(
      "getStorageLocations: loc boom",
    );
  });
});

// ----- getter: getStorageStatus ---------------------------------------------

describe("getStorageStatus", () => {
  it("reads v_storage_status and returns camelCase rows (NULL in_band preserved)", async () => {
    const { client, fromCalls } = makeClient({
      v_storage_status: { data: [statusRow, unreadStatusRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getStorageStatus } = await import("@/lib/db/storage");
    const rows = await getStorageStatus();

    expect(fromCalls).toContain("v_storage_status");
    expect(rows).toHaveLength(2);
    expect(rows[0].inBand).toBe(true);
    expect(rows[1].inBand).toBeNull();
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      v_storage_status: { data: null, error: { message: "status boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getStorageStatus } = await import("@/lib/db/storage");
    await expect(getStorageStatus()).rejects.toThrow(
      "getStorageStatus: status boom",
    );
  });
});

// ----- getter: getLotStorageHistory -----------------------------------------

describe("getLotStorageHistory", () => {
  it("reads v_lot_storage_history for one lot and returns camelCase readings", async () => {
    const { client, fromCalls } = makeClient({
      v_lot_storage_history: { data: [historyRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getLotStorageHistory } = await import("@/lib/db/storage");
    const rows = await getLotStorageHistory("JC-701");

    expect(fromCalls).toContain("v_lot_storage_history");
    expect(rows).toHaveLength(1);
    expect(rows[0].greenLotCode).toBe("JC-701");
    expect(rows[0].source).toBe("manual");
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      v_lot_storage_history: { data: null, error: { message: "hist boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getLotStorageHistory } = await import("@/lib/db/storage");
    await expect(getLotStorageHistory("JC-701")).rejects.toThrow(
      "getLotStorageHistory: hist boom",
    );
  });
});

// ----- getter: getLotStorageCertificates ------------------------------------

describe("getLotStorageCertificates", () => {
  it("reads storage_certificates for one lot and returns camelCase certs", async () => {
    const { client, fromCalls } = makeClient({
      storage_certificates: { data: [certRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getLotStorageCertificates } = await import("@/lib/db/storage");
    const rows = await getLotStorageCertificates("JC-701");

    expect(fromCalls).toContain("storage_certificates");
    expect(rows).toHaveLength(1);
    expect(rows[0].verdict).toBe("in-band");
    expect(rows[0].readingsCount).toBe(20);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      storage_certificates: { data: null, error: { message: "cert boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getLotStorageCertificates } = await import("@/lib/db/storage");
    await expect(getLotStorageCertificates("JC-701")).rejects.toThrow(
      "getLotStorageCertificates: cert boom",
    );
  });
});

// ----- getter: listStorageCertificates --------------------------------------

describe("listStorageCertificates", () => {
  it("reads the whole storage_certificates ledger", async () => {
    const { client, fromCalls } = makeClient({
      storage_certificates: { data: [certRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { listStorageCertificates } = await import("@/lib/db/storage");
    const rows = await listStorageCertificates();

    expect(fromCalls).toContain("storage_certificates");
    expect(rows[0].id).toBe(9);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      storage_certificates: { data: null, error: { message: "ledger boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { listStorageCertificates } = await import("@/lib/db/storage");
    await expect(listStorageCertificates()).rejects.toThrow(
      "listStorageCertificates: ledger boom",
    );
  });
});
