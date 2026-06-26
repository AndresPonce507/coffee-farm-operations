import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ShipmentDetail } from "@/app/(app)/sales/shipments/data";

// The detail page is the HEADLINE Server Component. Stub the read port + the
// line-loader island so this test pins the page's one job: render the five-tile
// traffic-light document grid, surface a blocked doc's EXACT unmet prerequisites,
// and chain-lock the bill of lading. The doc-pack island itself is NOT stubbed —
// the tiles ARE the headline — so we mock next/navigation (useRouter for the island,
// notFound for the page) and the write actions (no network).
const { getShipmentMock } = vi.hoisted(() => ({ getShipmentMock: vi.fn() }));
vi.mock("@/app/(app)/sales/shipments/data", async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return { ...actual, getShipment: getShipmentMock };
});
vi.mock("@/app/(app)/sales/shipments/[no]/line-loader.client", () => ({
  LineLoader: () => <div data-testid="line-loader-stub" />,
}));
vi.mock("@/app/(app)/sales/shipments/actions", () => ({
  issueExportDocAction: vi.fn(),
  addShipmentLineAction: vi.fn(),
  buildExportShipmentAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import ShipmentDetailPage from "@/app/(app)/sales/shipments/[no]/page";

const DETAIL: ShipmentDetail = {
  shipment: {
    id: 1,
    shipmentNo: "JC-S-0001",
    contractId: 7,
    contractNo: "JC-K-0007",
    buyerName: "Tokyo Roasters",
    countryCode: "JP",
    incoterm: "FOB",
    portOfLoading: "Balboa, PA",
    bagWeightKg: 30,
    status: "building",
    totalBags: 8,
    totalNetKg: 240,
    lineCount: 1,
    issuedCount: 1,
    departedAt: null,
    createdAt: "2026-06-20T00:00:00Z",
  },
  readiness: [
    // invoice — issued (green)
    { docKind: "commercial_invoice", issued: true, liveDocId: 11, unmetPrereqs: [] },
    // certificate of origin — BLOCKED on EUDR (red, the headline invariant)
    {
      docKind: "certificate_of_origin",
      issued: false,
      liveDocId: null,
      unmetPrereqs: ["all loaded lots EUDR-compliant"],
    },
    // phytosanitary — blocked on packing list
    {
      docKind: "phytosanitary",
      issued: false,
      liveDocId: null,
      unmetPrereqs: ["packing list issued"],
    },
    // packing list — ready (amber)
    { docKind: "packing_list", issued: false, liveDocId: null, unmetPrereqs: [] },
    // bill of lading — chain-locked on the other four
    {
      docKind: "bill_of_lading",
      issued: false,
      liveDocId: null,
      unmetPrereqs: [
        "commercial invoice issued",
        "certificate of origin issued",
        "phytosanitary certificate issued",
        "packing list issued",
      ],
    },
  ],
  lines: [
    { id: 1, contractLineId: 21, greenLotCode: "JC-204", bags: 8, netKg: 240 },
  ],
  issuedDocs: [
    {
      docId: 11,
      docKind: "commercial_invoice",
      docNo: "JC-XD-0001",
      issuedAt: "2026-06-21T00:00:00Z",
      payload: { shipment_no: "JC-S-0001" },
    },
  ],
  loadableLines: [],
};

beforeEach(() => getShipmentMock.mockResolvedValue(DETAIL));
afterEach(cleanup);

const renderPage = async () =>
  render(await ShipmentDetailPage({ params: Promise.resolve({ no: "JC-S-0001" }) }));

describe("/sales/shipments/[no] export-doc-pack (headline smoke)", () => {
  it("renders the consignment heading with its shipment number", async () => {
    await renderPage();
    expect(
      screen.getByRole("heading", { level: 1, name: /JC-S-0001/ }),
    ).toBeInTheDocument();
  });

  it("renders all five document tiles", async () => {
    await renderPage();
    for (const kind of [
      "commercial_invoice",
      "certificate_of_origin",
      "phytosanitary",
      "packing_list",
      "bill_of_lading",
    ]) {
      expect(screen.getByTestId(`doc-tile-${kind}`)).toBeInTheDocument();
    }
  });

  it("THE HEADLINE INVARIANT: a blocked Certificate of Origin shows its EXACT unmet prerequisite (never a blank doc)", async () => {
    await renderPage();
    const tile = screen.getByTestId("doc-tile-certificate_of_origin");
    expect(within(tile).getByText(/all loaded lots EUDR-compliant/)).toBeInTheDocument();
  });

  it("an issued document shows its doc number, not an Issue button", async () => {
    await renderPage();
    const tile = screen.getByTestId("doc-tile-commercial_invoice");
    expect(within(tile).getByText(/JC-XD-0001/)).toBeInTheDocument();
    expect(within(tile).queryByRole("button", { name: "Issue" })).not.toBeInTheDocument();
  });

  it("the bill of lading is chain-locked until the other four issue (lists its four blockers)", async () => {
    await renderPage();
    const tile = screen.getByTestId("doc-tile-bill_of_lading");
    expect(within(tile).getByText(/commercial invoice issued/)).toBeInTheDocument();
    expect(within(tile).getByText(/certificate of origin issued/)).toBeInTheDocument();
  });

  it("404s when the shipment number does not resolve", async () => {
    getShipmentMock.mockResolvedValue(null);
    await expect(
      ShipmentDetailPage({ params: Promise.resolve({ no: "JC-S-9999" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
