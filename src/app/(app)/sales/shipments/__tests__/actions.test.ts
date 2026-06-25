import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Server Actions call `await (await getSupabase()).rpc(...)`. Mock a single rpc
// spy whose result each test sets. next-intl/server is mocked globally in setup.ts so
// getTranslations resolves the real EN copy (error messages come back as the actual
// strings the UI shows). reactiveRefresh busts the inventory caches on the ATP-moving
// add-line write; stub the revalidate SSOT so no Next runtime is needed.
const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => Promise.resolve({ rpc: rpcMock }),
}));
vi.mock("@/lib/revalidate", () => ({ reactiveRefresh: vi.fn() }));

import {
  addShipmentLineAction,
  buildExportShipmentAction,
  issueExportDocAction,
} from "@/app/(app)/sales/shipments/actions";

beforeEach(() => rpcMock.mockReset());
afterEach(() => vi.clearAllMocks());

describe("buildExportShipmentAction", () => {
  it("rejects a missing contract WITHOUT touching the database", async () => {
    const result = await buildExportShipmentAction({
      contractId: 0,
      portOfLoading: "Balboa, PA",
      bagWeightKg: 30,
      idempotencyKey: "k1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Select a contract to build the shipment.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a non-positive bag weight WITHOUT touching the database", async () => {
    const result = await buildExportShipmentAction({
      contractId: 7,
      portOfLoading: "Balboa, PA",
      bagWeightKg: 0,
      idempotencyKey: "k1",
    });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("passes the EXACT snake_case p_ envelope on the happy path", async () => {
    rpcMock.mockResolvedValue({ data: 5, error: null });
    const result = await buildExportShipmentAction({
      contractId: 7,
      portOfLoading: " Balboa, PA ",
      bagWeightKg: 30,
      idempotencyKey: "k1",
    });
    expect(result).toEqual({ ok: true, shipmentId: 5 });
    expect(rpcMock).toHaveBeenCalledWith("build_export_shipment", {
      p_contract_id: 7,
      p_port_of_loading: "Balboa, PA",
      p_bag_weight_kg: 30,
      p_idempotency_key: "k1",
    });
  });
});

describe("addShipmentLineAction — the ATP-claim write", () => {
  it("rejects a non-positive bag count WITHOUT touching the database", async () => {
    const result = await addShipmentLineAction({
      shipmentId: 1,
      contractLineId: 21,
      bags: 0,
      idempotencyKey: "k2",
    });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("passes the exact envelope to add_shipment_line and returns the line id", async () => {
    rpcMock.mockResolvedValue({ data: 42, error: null });
    const result = await addShipmentLineAction({
      shipmentId: 1,
      contractLineId: 21,
      bags: 8,
      idempotencyKey: "k2",
    });
    expect(result).toEqual({ ok: true, lineId: 42 });
    expect(rpcMock).toHaveBeenCalledWith("add_shipment_line", {
      p_shipment_id: 1,
      p_contract_line_id: 21,
      p_bags: 8,
      p_idempotency_key: "k2",
    });
  });

  it("surfaces the oversell guard message verbatim (never a raw SQLSTATE leak)", async () => {
    const guard =
      "oversell guard: shipping 240 kg of green lot JC-204 would exceed its 200 kg available-to-promise";
    rpcMock.mockResolvedValue({ data: null, error: { message: guard, code: "23514" } });
    const result = await addShipmentLineAction({
      shipmentId: 1,
      contractLineId: 21,
      bags: 8,
      idempotencyKey: "k2",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(guard);
      expect(result.error).not.toMatch(/SQLSTATE|23514/);
    }
  });
});

describe("issueExportDocAction — THE GATED WRITER", () => {
  it("rejects an unknown doc kind WITHOUT touching the database", async () => {
    const result = await issueExportDocAction({
      shipmentId: 1,
      docKind: "not_a_doc",
      idempotencyKey: "k3",
    });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("passes the exact envelope to issue_export_doc and returns the doc id", async () => {
    rpcMock.mockResolvedValue({ data: 99, error: null });
    const result = await issueExportDocAction({
      shipmentId: 1,
      docKind: "commercial_invoice",
      idempotencyKey: "k3",
    });
    expect(result).toEqual({ ok: true, docId: 99 });
    expect(rpcMock).toHaveBeenCalledWith("issue_export_doc", {
      p_shipment_id: 1,
      p_doc_kind: "commercial_invoice",
      p_idempotency_key: "k3",
    });
  });

  it("THE HEADLINE GATE: surfaces the EXACT unmet-prerequisite list verbatim when a doc is blocked", async () => {
    const guard =
      "export doc certificate_of_origin blocked — unmet prerequisites: all loaded lots EUDR-compliant";
    rpcMock.mockResolvedValue({ data: null, error: { message: guard, code: "23514" } });
    const result = await issueExportDocAction({
      shipmentId: 1,
      docKind: "certificate_of_origin",
      idempotencyKey: "k3",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(guard);
      expect(result.error).not.toMatch(/SQLSTATE|23514/);
    }
  });

  it("maps an unknown structural Postgres error to clean generic copy (no raw leak)", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'relation "export_documents" does not exist', code: "42P01" },
    });
    const result = await issueExportDocAction({
      shipmentId: 1,
      docKind: "packing_list",
      idempotencyKey: "k3",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Could not complete that. Check the details and try again.");
      expect(result.error).not.toMatch(/relation|export_documents/);
    }
  });
});
