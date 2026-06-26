import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ExportDocPackRow,
  ExportDocPrereqRow,
  ExportPackReadinessRow,
  ExportShipmentRow,
} from "@/lib/db/export-pack";

/**
 * Coverage of the `export-pack.ts` READ-port (P3-S3 — export shipments + the
 * export-doc-pack engine, THE HEADLINE SLICE): the pure mappers (snake_case
 * view/table row → camelCase domain, numeric coercion of the bigint/numeric
 * columns PostgREST may serialize as strings, NULL preservation for an un-issued
 * live_doc_id / a not-yet-departed shipment) and the `cache()`-wrapped getters'
 * fetch + map round-trip:
 *
 *   - `getExportShipments()`           reads `export_shipments`        (every consignment).
 *   - `getExportShipmentsByContract()` reads `export_shipments`        filtered to one contract.
 *   - `getExportShipment(no)`          reads `export_shipments`        filtered to one shipment_no (null when absent).
 *   - `getPackReadiness(shipmentId)`   reads `v_export_pack_readiness` (the traffic-light source: issued? / unmet prereqs per doc_kind).
 *   - `getExportDocPack(shipmentId)`   reads `v_export_doc_pack`       (the LIVE issued docs + their frozen payloads — the PDF source).
 *   - `getExportDocPrereqs()`          reads `export_doc_prereqs`      (the DECLARATIVE, auditable gate — global reference data).
 *
 * Strategy mirrors `pricing.test.ts` / `greenlots.test.ts`: mock
 * `@/lib/supabase/server` so `getSupabase()` returns a chainable, thenable
 * query-builder. The prereq evaluation + doc rendering are the views'/RPCs' job
 * (pinned by the migration's PGlite tests, not re-implemented here); this port
 * only proves the row→domain seam + NULL handling survive `cache()` and hit the
 * right table/view. The frozen `payload` snapshot is passed through UNCHANGED — it
 * is the at-issue PDF source, deliberately NOT re-shaped to camelCase.
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

const shipmentRow: ExportShipmentRow = {
  id: 10,
  contract_id: 3,
  shipment_no: "JC-S-0001",
  port_of_loading: "Balboa, PA",
  bag_weight_kg: "30", // PostgREST may serialize numeric as a string
  status: "building",
  departed_at: null, // not departed yet (preserved, never fabricated)
  created_at: "2026-06-24T09:00:00Z",
};

const departedShipmentRow: ExportShipmentRow = {
  id: 11,
  contract_id: 3,
  shipment_no: "JC-S-0002",
  port_of_loading: "Balboa, PA",
  bag_weight_kg: 30,
  status: "departed",
  departed_at: "2026-06-25T12:00:00Z",
  created_at: "2026-06-24T09:30:00Z",
};

const readinessBlockedRow: ExportPackReadinessRow = {
  tenant_id: "t",
  shipment_id: 10,
  doc_kind: "certificate_of_origin",
  issued: false,
  live_doc_id: null,
  unmet_prereqs: ["all loaded lots EUDR-compliant"],
};

const readinessIssuedRow: ExportPackReadinessRow = {
  tenant_id: "t",
  shipment_id: 10,
  doc_kind: "packing_list",
  issued: true,
  live_doc_id: "55",
  unmet_prereqs: [],
};

const docPackRow: ExportDocPackRow = {
  tenant_id: "t",
  shipment_id: 10,
  doc_id: 55,
  doc_kind: "commercial_invoice",
  doc_no: "JC-XD-0001",
  payload: {
    doc_kind: "commercial_invoice",
    shipment_no: "JC-S-0001",
    port_of_loading: "Balboa, PA",
    contract_no: "JC-K-0001",
    incoterm: "FOB",
    consignee: { name: "Tokyo Roasters", country_code: "JP" },
    issued_at: "2026-06-24T10:00:00Z",
    total_bags: 8,
    total_net_kg: 240,
    lines: [
      { green_lot_code: "JC-204", bags: 8, net_kg: 240, eudr_status: "compliant" },
    ],
  },
  issued_at: "2026-06-24T10:00:00Z",
};

const prereqRow: ExportDocPrereqRow = {
  id: 4,
  doc_kind: "bill_of_lading",
  prereq_label: "commercial invoice issued",
  prereq_kind: "doc_issued",
  required_doc_kind: "commercial_invoice",
  created_at: "2026-06-20T10:00:00Z",
};

const eudrPrereqRow: ExportDocPrereqRow = {
  id: 2,
  doc_kind: "certificate_of_origin",
  prereq_label: "all loaded lots EUDR-compliant",
  prereq_kind: "eudr_compliant",
  required_doc_kind: null, // not a doc_issued prereq
  created_at: "2026-06-20T10:00:00Z",
};

// ----- pure mapper: mapExportShipment ---------------------------------------

describe("mapExportShipment", () => {
  it("maps an export_shipments row to a camelCase shipment with numeric coercion", async () => {
    const { mapExportShipment } = await import("@/lib/db/export-pack");
    expect(mapExportShipment(shipmentRow)).toEqual({
      id: 10,
      contractId: 3,
      shipmentNo: "JC-S-0001",
      portOfLoading: "Balboa, PA",
      bagWeightKg: 30,
      status: "building",
      departedAt: null,
      createdAt: "2026-06-24T09:00:00Z",
    });
  });

  it("preserves a NULL departed_at (never fabricated) and carries a departed stamp through", async () => {
    const { mapExportShipment } = await import("@/lib/db/export-pack");
    expect(mapExportShipment(shipmentRow).departedAt).toBeNull();
    expect(mapExportShipment(departedShipmentRow).departedAt).toBe(
      "2026-06-25T12:00:00Z",
    );
    expect(mapExportShipment(departedShipmentRow).status).toBe("departed");
  });
});

// ----- pure mapper: mapPackReadiness ----------------------------------------

describe("mapPackReadiness", () => {
  it("maps a blocked v_export_pack_readiness row, preserving the unmet-prereq list and NULL live_doc_id", async () => {
    const { mapPackReadiness } = await import("@/lib/db/export-pack");
    expect(mapPackReadiness(readinessBlockedRow)).toEqual({
      shipmentId: 10,
      docKind: "certificate_of_origin",
      issued: false,
      liveDocId: null,
      unmetPrereqs: ["all loaded lots EUDR-compliant"],
    });
  });

  it("maps an issued row, coercing the live_doc_id string and giving an empty unmet list", async () => {
    const { mapPackReadiness } = await import("@/lib/db/export-pack");
    const r = mapPackReadiness(readinessIssuedRow);
    expect(r.issued).toBe(true);
    expect(r.liveDocId).toBe(55);
    expect(r.unmetPrereqs).toEqual([]);
  });

  it("treats a NULL unmet_prereqs array as empty (defensive)", async () => {
    const { mapPackReadiness } = await import("@/lib/db/export-pack");
    const r = mapPackReadiness({
      ...readinessIssuedRow,
      unmet_prereqs: null,
    });
    expect(r.unmetPrereqs).toEqual([]);
  });
});

// ----- pure mapper: mapExportDoc --------------------------------------------

describe("mapExportDoc", () => {
  it("maps a v_export_doc_pack row and passes the frozen payload through UNCHANGED", async () => {
    const { mapExportDoc } = await import("@/lib/db/export-pack");
    const d = mapExportDoc(docPackRow);
    expect(d.shipmentId).toBe(10);
    expect(d.docId).toBe(55);
    expect(d.docKind).toBe("commercial_invoice");
    expect(d.docNo).toBe("JC-XD-0001");
    expect(d.issuedAt).toBe("2026-06-24T10:00:00Z");
    // the frozen snapshot is the at-issue PDF source — passed through verbatim.
    expect(d.payload).toBe(docPackRow.payload);
    expect(d.payload.total_net_kg).toBe(240);
    expect(d.payload.lines[0].eudr_status).toBe("compliant");
  });
});

// ----- pure mapper: mapExportDocPrereq --------------------------------------

describe("mapExportDocPrereq", () => {
  it("maps an export_doc_prereqs row to camelCase, carrying required_doc_kind", async () => {
    const { mapExportDocPrereq } = await import("@/lib/db/export-pack");
    expect(mapExportDocPrereq(prereqRow)).toEqual({
      id: 4,
      docKind: "bill_of_lading",
      prereqLabel: "commercial invoice issued",
      prereqKind: "doc_issued",
      requiredDocKind: "commercial_invoice",
      createdAt: "2026-06-20T10:00:00Z",
    });
  });

  it("passes a NULL required_doc_kind through (a non-doc_issued prereq)", async () => {
    const { mapExportDocPrereq } = await import("@/lib/db/export-pack");
    expect(mapExportDocPrereq(eudrPrereqRow).requiredDocKind).toBeNull();
    expect(mapExportDocPrereq(eudrPrereqRow).prereqKind).toBe("eudr_compliant");
  });
});

// ----- getter: getExportShipments -------------------------------------------

describe("getExportShipments", () => {
  it("reads export_shipments and returns camelCase shipments", async () => {
    const { client, fromCalls } = makeClient({
      export_shipments: { data: [shipmentRow, departedShipmentRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getExportShipments } = await import("@/lib/db/export-pack");
    const ships = await getExportShipments();

    expect(fromCalls).toContain("export_shipments");
    expect(ships).toHaveLength(2);
    expect(ships[0].shipmentNo).toBe("JC-S-0001");
    expect(ships[1].status).toBe("departed");
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      export_shipments: { data: null, error: { message: "ship boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getExportShipments } = await import("@/lib/db/export-pack");
    await expect(getExportShipments()).rejects.toThrow(
      "getExportShipments: ship boom",
    );
  });
});

// ----- getter: getExportShipmentsByContract ---------------------------------

describe("getExportShipmentsByContract", () => {
  it("reads export_shipments filtered to one contract", async () => {
    const { client, fromCalls } = makeClient({
      export_shipments: { data: [shipmentRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getExportShipmentsByContract } = await import("@/lib/db/export-pack");
    const ships = await getExportShipmentsByContract(3);

    expect(fromCalls).toContain("export_shipments");
    expect(ships).toHaveLength(1);
    expect(ships[0].contractId).toBe(3);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      export_shipments: { data: null, error: { message: "by-contract boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getExportShipmentsByContract } = await import("@/lib/db/export-pack");
    await expect(getExportShipmentsByContract(3)).rejects.toThrow(
      "getExportShipmentsByContract: by-contract boom",
    );
  });
});

// ----- getter: getExportShipment --------------------------------------------

describe("getExportShipment", () => {
  it("reads export_shipments for one shipment_no and returns the single shipment", async () => {
    const { client, fromCalls } = makeClient({
      export_shipments: { data: [shipmentRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getExportShipment } = await import("@/lib/db/export-pack");
    const ship = await getExportShipment("JC-S-0001");

    expect(fromCalls).toContain("export_shipments");
    expect(ship).not.toBeNull();
    expect(ship?.id).toBe(10);
    expect(ship?.shipmentNo).toBe("JC-S-0001");
  });

  it("returns null when the shipment_no has no row (notFound territory)", async () => {
    const { client } = makeClient({
      export_shipments: { data: [], error: null },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getExportShipment } = await import("@/lib/db/export-pack");
    expect(await getExportShipment("JC-S-9999")).toBeNull();
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      export_shipments: { data: null, error: { message: "one-ship boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getExportShipment } = await import("@/lib/db/export-pack");
    await expect(getExportShipment("JC-S-0001")).rejects.toThrow(
      "getExportShipment: one-ship boom",
    );
  });
});

// ----- getter: getPackReadiness ---------------------------------------------

describe("getPackReadiness", () => {
  it("reads v_export_pack_readiness for a shipment and returns the traffic-light rows", async () => {
    const { client, fromCalls } = makeClient({
      v_export_pack_readiness: {
        data: [readinessBlockedRow, readinessIssuedRow],
        error: null,
      },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getPackReadiness } = await import("@/lib/db/export-pack");
    const rows = await getPackReadiness(10);

    expect(fromCalls).toContain("v_export_pack_readiness");
    expect(rows).toHaveLength(2);
    expect(rows[0].issued).toBe(false);
    expect(rows[0].unmetPrereqs).toEqual(["all loaded lots EUDR-compliant"]);
    expect(rows[1].issued).toBe(true);
    expect(rows[1].liveDocId).toBe(55);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      v_export_pack_readiness: { data: null, error: { message: "ready boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getPackReadiness } = await import("@/lib/db/export-pack");
    await expect(getPackReadiness(10)).rejects.toThrow(
      "getPackReadiness: ready boom",
    );
  });
});

// ----- getter: getExportDocPack ---------------------------------------------

describe("getExportDocPack", () => {
  it("reads v_export_doc_pack for a shipment and returns the live issued docs", async () => {
    const { client, fromCalls } = makeClient({
      v_export_doc_pack: { data: [docPackRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getExportDocPack } = await import("@/lib/db/export-pack");
    const docs = await getExportDocPack(10);

    expect(fromCalls).toContain("v_export_doc_pack");
    expect(docs).toHaveLength(1);
    expect(docs[0].docNo).toBe("JC-XD-0001");
    expect(docs[0].payload.consignee.name).toBe("Tokyo Roasters");
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      v_export_doc_pack: { data: null, error: { message: "pack boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getExportDocPack } = await import("@/lib/db/export-pack");
    await expect(getExportDocPack(10)).rejects.toThrow(
      "getExportDocPack: pack boom",
    );
  });
});

// ----- getter: getExportDocPrereqs ------------------------------------------

describe("getExportDocPrereqs", () => {
  it("reads export_doc_prereqs and returns the declarative gate rows", async () => {
    const { client, fromCalls } = makeClient({
      export_doc_prereqs: { data: [eudrPrereqRow, prereqRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getExportDocPrereqs } = await import("@/lib/db/export-pack");
    const rows = await getExportDocPrereqs();

    expect(fromCalls).toContain("export_doc_prereqs");
    expect(rows).toHaveLength(2);
    expect(rows[0].prereqKind).toBe("eudr_compliant");
    expect(rows[1].requiredDocKind).toBe("commercial_invoice");
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      export_doc_prereqs: { data: null, error: { message: "prereq boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getExportDocPrereqs } = await import("@/lib/db/export-pack");
    await expect(getExportDocPrereqs()).rejects.toThrow(
      "getExportDocPrereqs: prereq boom",
    );
  });
});
