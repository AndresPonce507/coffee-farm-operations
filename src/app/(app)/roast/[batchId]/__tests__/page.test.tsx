import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RoastBatchDetail } from "@/app/(app)/roast/data";

// The batch detail is a Server Component: it renders the roast curve overlaid on the
// golden target, the phase markers, the .alog import receipt, and the linked SKUs,
// with the ONE interactive island (import / finalize / link) stubbed. Stub the per-
// batch port + the client island so this test pins the server page's job: render the
// batch lineage and 404 on an unknown batch (never a fabricated batch).
const { getRoastBatchDetailMock } = vi.hoisted(() => ({
  getRoastBatchDetailMock: vi.fn(),
}));
vi.mock("@/app/(app)/roast/data", () => ({
  getRoastBatchDetail: getRoastBatchDetailMock,
}));
vi.mock("@/app/(app)/roast/[batchId]/roast-finalize.client", () => ({
  RoastFinalize: () => <div data-testid="roast-finalize-stub" />,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import RoastBatchPage from "@/app/(app)/roast/[batchId]/page";

const FINALIZED: RoastBatchDetail = {
  batch: {
    roastBatchId: 9,
    greenLotCode: "JC-701",
    roastedLotCode: "JC-880",
    greenInKg: 10,
    roastedKgOut: 8.4,
    shrinkagePct: 0.16,
    status: "finalized",
    profileName: "Geisha Filter",
    profileVersion: 2,
    roastLevel: "medium-light",
    profileStatus: "approved",
    cuppingScore: 92,
    scaGrade: "Presidential",
    scaPrep: "European Prep",
  },
  profileTargets: {
    chargeTempC: 200,
    dropTempC: 205,
    totalTimeS: 600,
    dtrPct: 22,
  },
  curvePoints: [
    { tSeconds: 0, beanTempC: 200, envTempC: 210, rorCPerMin: 0 },
    { tSeconds: 300, beanTempC: 180, envTempC: 200, rorCPerMin: 12 },
    { tSeconds: 600, beanTempC: 205, envTempC: 215, rorCPerMin: 8 },
  ],
  events: [
    { marker: "charge", tSeconds: 0, tempC: 200 },
    { marker: "first_crack", tSeconds: 480, tempC: 196 },
    { marker: "drop", tSeconds: 600, tempC: 205 },
  ],
  imports: [
    {
      sourceFilename: "geisha.alog",
      maxDeviationC: 4.2,
      pointCount: 3,
      createdAt: "2026-06-24T10:00:00Z",
    },
  ],
  skus: [
    {
      id: 5,
      skuCode: "JC-GEISHA-250",
      bagSizeG: 250,
      priceUsdCents: 2800,
      gtin: "0123456789012",
      isActive: true,
    },
  ],
};

const renderBatch = (batchId: string) =>
  RoastBatchPage({ params: Promise.resolve({ batchId }) });

afterEach(cleanup);

describe("/roast/[batchId] batch detail (smoke)", () => {
  it("renders the batch header with its green lot and minted roasted lot", async () => {
    getRoastBatchDetailMock.mockResolvedValue(FINALIZED);
    render(await renderBatch("9"));

    expect(
      screen.getByRole("heading", { level: 1, name: /Batch #9/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/from JC-701/)).toBeInTheDocument();
    expect(screen.getByText(/JC-880/)).toBeInTheDocument();
  });

  it("renders the roast-curve-vs-golden story and the phase markers", async () => {
    getRoastBatchDetailMock.mockResolvedValue(FINALIZED);
    render(await renderBatch("9"));

    expect(
      screen.getByText("Roast curve vs golden target"),
    ).toBeInTheDocument();
    const markers = screen.getByTestId("roast-events");
    expect(within(markers).getByText("first_crack")).toBeInTheDocument();
  });

  it("mounts the finalize/import/link client island", async () => {
    getRoastBatchDetailMock.mockResolvedValue(FINALIZED);
    render(await renderBatch("9"));
    expect(screen.getByTestId("roast-finalize-stub")).toBeInTheDocument();
  });

  it("shows the realized shrinkage and the linked SKU on a finalized batch", async () => {
    getRoastBatchDetailMock.mockResolvedValue(FINALIZED);
    render(await renderBatch("9"));

    expect(screen.getByText(/16%/)).toBeInTheDocument();
    const skus = screen.getByTestId("roast-skus");
    expect(within(skus).getByText("JC-GEISHA-250")).toBeInTheDocument();
  });

  it("404s when the batch does not exist (never a fabricated batch)", async () => {
    getRoastBatchDetailMock.mockResolvedValue(null);
    await expect(renderBatch("404")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
