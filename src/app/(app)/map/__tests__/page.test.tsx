import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FeatureCollection, Polygon } from "geojson";

/**
 * /map page smoke test. The page is an async Server Component that fetches the two
 * GeoJSON collections, then renders the MapCanvas client wrapper (which lazy-loads
 * the real MapLibre island ssr:false). We mock:
 *   - the geo getters (no Supabase),
 *   - MapCanvas so the island renders a harmless stub (no MapLibre in jsdom),
 * then assert the floating glass chrome (title + legend) renders.
 */

const emptyFc: FeatureCollection<Polygon> = {
  type: "FeatureCollection",
  features: [],
};

vi.mock("@/lib/db/geo", () => ({
  getPlotsGeoJSON: vi.fn(async () => emptyFc),
  getReserveGeoJSON: vi.fn(async () => emptyFc),
}));

// MapCanvas → identifiable stub so the page tree mounts without the GL island.
vi.mock("@/components/islands/MapCanvas.client", () => ({
  MapCanvas: () => <div data-testid="farm-map-island" />,
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("/map page", () => {
  it("renders the page chrome (title + legend) and the map island", async () => {
    const { default: MapPage } = await import("@/app/(app)/map/page");
    // Server Component returns a Promise<JSX> — await it, then render.
    const ui = await MapPage();
    render(ui);

    // Title chrome.
    expect(
      screen.getByRole("heading", { name: /mapa de la finca/i }),
    ).toBeInTheDocument();

    // Status legend entries (exact labels, so the title's "quetzal reserve"
    // copy doesn't collide with the legend's "Reserve" chip).
    expect(screen.getByText("Healthy")).toBeInTheDocument();
    expect(screen.getByText("Watch")).toBeInTheDocument();
    expect(screen.getByText("At risk")).toBeInTheDocument();
    expect(screen.getByText("Reserve")).toBeInTheDocument();

    // The dynamic island mounted.
    expect(screen.getByTestId("farm-map-island")).toBeInTheDocument();
  });
});
