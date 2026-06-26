import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Provenance } from "@/app/p/[slug]/data";

// The microsite is a PUBLIC Server Component that reads the curated, published-only
// `resolve_provenance` projection (the ONE anon door in all of Phase 3). Stub the
// port so the async page resolves without a Supabase client, and so this test pins
// the page's job: tell the bag's story from ONLY the whitelisted facts, and 404 a
// slug the resolver returns NULL for (unpublished / unknown — never a leak).
const { getProvenanceMock } = vi.hoisted(() => ({ getProvenanceMock: vi.fn() }));
vi.mock("@/app/p/[slug]/data", () => ({ getProvenance: getProvenanceMock }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import ProvenancePage from "@/app/p/[slug]/page";

const PUBLISHED: Provenance = {
  slug: "janson-geisha-jc901",
  gtin: "0840012345678",
  curatedStory:
    "Grown on Quetzal Ridge at 1,650m, hand-picked at peak ripeness.",
  greenLotCode: "JC-901",
  packFormat: "whole-bean",
  bagSize: "250g",
  productName: "Janson Geisha",
  variety: "Geisha",
  process: "Washed",
  cuppingScore: 92,
  scaGrade: "Presidential",
  isSingleOrigin: true,
  eudrStatus: "compliant",
  originPlots: [
    {
      plotName: "Quetzal Ridge",
      establishedYear: 2018,
      centroid: { type: "Point", coordinates: [-82.5, 8.8] },
      geolocated: true,
      deforestationFree: true,
    },
  ],
  crewLabels: ["Crew Quetzal"],
  processingTimeline: [
    { kind: "cherry_intake", occurredAt: "2026-01-10T00:00:00Z" },
    { kind: "milled", occurredAt: "2026-02-01T00:00:00Z" },
  ],
};

const renderSlug = (slug: string) =>
  ProvenancePage({ params: Promise.resolve({ slug }) });

beforeEach(() => getProvenanceMock.mockReset());
afterEach(cleanup);

describe("/p/[slug] public provenance microsite (smoke)", () => {
  it("renders the product as the marquee heading", async () => {
    getProvenanceMock.mockResolvedValue(PUBLISHED);
    render(await renderSlug("janson-geisha-jc901"));
    expect(
      screen.getByRole("heading", { level: 1, name: /Janson Geisha/ }),
    ).toBeInTheDocument();
  });

  it("surfaces the two permitted quality facts: cup score and SCA grade", async () => {
    getProvenanceMock.mockResolvedValue(PUBLISHED);
    render(await renderSlug("janson-geisha-jc901"));
    expect(screen.getByText("Cup score")).toBeInTheDocument();
    expect(screen.getByText("92")).toBeInTheDocument();
    expect(screen.getByText("Presidential")).toBeInTheDocument();
  });

  it("shows the EUDR green-tick, the origin plot, and the anonymized crew label", async () => {
    getProvenanceMock.mockResolvedValue(PUBLISHED);
    render(await renderSlug("janson-geisha-jc901"));
    expect(screen.getByText("EUDR compliant")).toBeInTheDocument();
    expect(screen.getByText("Quetzal Ridge")).toBeInTheDocument();
    // The picker is reduced to the crew LABEL — never a name, phone, or wage.
    expect(screen.getByText("Crew Quetzal")).toBeInTheDocument();
  });

  it("renders the processing timeline from leak-safe event kinds", async () => {
    getProvenanceMock.mockResolvedValue(PUBLISHED);
    render(await renderSlug("janson-geisha-jc901"));
    const timeline = screen.getByTestId("provenance-timeline");
    expect(within(timeline).getByText("Cherries received")).toBeInTheDocument();
    expect(within(timeline).getByText("Milled to green")).toBeInTheDocument();
  });

  it("offers the 'buy this exact lot' CTA", async () => {
    getProvenanceMock.mockResolvedValue(PUBLISHED);
    render(await renderSlug("janson-geisha-jc901"));
    expect(screen.getByRole("link", { name: "Shop this coffee" })).toBeInTheDocument();
  });

  it("404s when the resolver returns NULL (unpublished / unknown slug — never a leak)", async () => {
    getProvenanceMock.mockResolvedValue(null);
    await expect(renderSlug("no-such-slug")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders an incomplete-origin lot without crashing (graceful degradation)", async () => {
    getProvenanceMock.mockResolvedValue({
      ...PUBLISHED,
      cuppingScore: null,
      scaGrade: null,
      eudrStatus: "no-origin",
      originPlots: [],
      crewLabels: [],
      processingTimeline: [],
    });
    render(await renderSlug("janson-geisha-jc901"));
    expect(
      screen.getByRole("heading", { level: 1, name: /Janson Geisha/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Origin pending")).toBeInTheDocument();
  });
});
