import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SkuCurationRow } from "@/app/(app)/provenance/data";

// The owner curation board is a Server Component reading the co-located catalog port.
// Stub the port + the interactive client island so this test pins the page's job:
// render every lot-linked SKU as a curation card and tally published vs not.
const { getCatalogMock } = vi.hoisted(() => ({ getCatalogMock: vi.fn() }));
vi.mock("@/app/(app)/provenance/data", () => ({
  getProvenanceCatalog: getCatalogMock,
}));
vi.mock("@/app/(app)/provenance/curation-card.client", () => ({
  CurationCard: ({ row }: { row: SkuCurationRow }) => (
    <div data-testid={`curation-card-${row.skuId}`}>{row.greenLotCode}</div>
  ),
}));

import ProvenanceAdminPage from "@/app/(app)/provenance/page";

const PUBLISHED: SkuCurationRow = {
  skuId: 1,
  greenLotCode: "JC-901",
  gtin: "0840012345678",
  packFormat: "whole-bean",
  bagSize: "250g",
  productName: "Janson Geisha",
  variety: "Geisha",
  process: "Washed",
  slug: "janson-geisha-jc901",
  isPublished: true,
  curatedStory: "Grown on Quetzal Ridge.",
};

const DRAFT: SkuCurationRow = {
  skuId: 2,
  greenLotCode: "JC-902",
  gtin: null,
  packFormat: "ground",
  bagSize: "340g",
  productName: "Janson Caturra",
  variety: "Caturra",
  process: "Natural",
  slug: null,
  isPublished: false,
  curatedStory: null,
};

beforeEach(() => getCatalogMock.mockResolvedValue([PUBLISHED, DRAFT]));
afterEach(cleanup);

describe("/(app)/provenance owner curation board (smoke)", () => {
  it("renders the page heading", async () => {
    render(await ProvenanceAdminPage());
    expect(
      screen.getByRole("heading", { level: 1, name: "Provenance" }),
    ).toBeInTheDocument();
  });

  it("renders a curation card for every lot-linked SKU", async () => {
    render(await ProvenanceAdminPage());
    expect(screen.getByTestId("curation-card-1")).toBeInTheDocument();
    expect(screen.getByTestId("curation-card-2")).toBeInTheDocument();
  });

  it("surfaces the published vs not-published summary labels", async () => {
    render(await ProvenanceAdminPage());
    expect(screen.getByText("Published")).toBeInTheDocument();
    expect(screen.getByText("Not published")).toBeInTheDocument();
  });

  it("shows an empty state when no SKUs are lot-linked yet", async () => {
    getCatalogMock.mockResolvedValue([]);
    render(await ProvenanceAdminPage());
    expect(screen.getByText("No lot-linked bags yet")).toBeInTheDocument();
  });
});
