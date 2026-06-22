import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FeatureCollection, Polygon } from "geojson";

import type {
  PlotFeatureProps,
  ReserveFeatureProps,
} from "@/lib/db/geo";
import type { PlotPhiStatus, PlotVegetation } from "@/lib/types";

const getPlotVegetation = vi.fn();
const getPlotPhiStatus = vi.fn();
vi.mock("@/lib/db/remote-sensing", () => ({
  getPlotVegetation: () => getPlotVegetation(),
  getPlotPhiStatus: () => getPlotPhiStatus(),
}));

const getPlotsGeoJSON = vi.fn();
const getReserveGeoJSON = vi.fn();
vi.mock("@/lib/db/geo", () => ({
  getPlotsGeoJSON: () => getPlotsGeoJSON(),
  getReserveGeoJSON: () => getReserveGeoJSON(),
}));

// The map island lazy-loads maplibre (no WebGL in jsdom); stand in for it so the
// board's mount of the spatial surface is observable without a GL context.
vi.mock("@/components/islands/MapCanvas.client", () => ({
  MapCanvas: (props: {
    plots: FeatureCollection<Polygon, PlotFeatureProps>;
    reserve: FeatureCollection<Polygon, ReserveFeatureProps>;
  }) => (
    <div
      data-testid="sat-map"
      data-plot-count={props.plots.features.length}
      data-reserve-count={props.reserve.features.length}
    />
  ),
}));

import { SatelliteBoard } from "@/components/sections/satellite/satellite-board";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const rows: PlotVegetation[] = [
  {
    plotId: "p-cuesta-piedra",
    plotName: "Cuesta de Piedra",
    variety: "Catuaí",
    altitudeMasl: 1360,
    value: 0.78,
    indexKind: "ndvi",
    confidence: "high",
    basis: "optical",
    cloudPct: 5,
    observedAt: "2026-06-20T12:00:00Z",
  },
  {
    plotId: "p-las-lagunas",
    plotName: "Las Lagunas",
    variety: "Geisha",
    altitudeMasl: 1700,
    value: null,
    indexKind: null,
    confidence: "low",
    basis: "optical",
    cloudPct: null,
    observedAt: null,
  },
];

const plotsGeo: FeatureCollection<Polygon, PlotFeatureProps> = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-82.64, 8.77],
            [-82.63, 8.77],
            [-82.63, 8.78],
            [-82.64, 8.78],
            [-82.64, 8.77],
          ],
        ],
      },
      properties: {
        id: "p-cuesta-piedra",
        name: "Cuesta de Piedra",
        block: "Block A",
        variety: "Catuaí",
        status: "healthy",
        altitudeMasl: 1360,
      },
    },
  ],
};

const reserveGeo: FeatureCollection<Polygon, ReserveFeatureProps> = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-82.68, 8.82],
            [-82.66, 8.82],
            [-82.66, 8.84],
            [-82.68, 8.84],
            [-82.68, 8.82],
          ],
        ],
      },
      properties: {
        id: "rz-quetzal",
        name: "Quetzal Cloud-Forest Reserve",
        kind: "reserve",
        areaHa: 200.9,
      },
    },
  ],
};

const phiRows: PlotPhiStatus[] = [
  {
    plotId: "p-cuesta-piedra",
    plotName: "Cuesta de Piedra",
    product: "Cobre fijo",
    activeIngredient: "copper hydroxide",
    appliedAt: "2026-06-18T08:00:00Z",
    phiClearsOn: "2026-06-25",
    reiClearsAt: "2026-06-19T08:00:00Z",
    phiActive: true,
    reiActive: false,
  },
];

function primeAll() {
  getPlotVegetation.mockResolvedValue(rows);
  getPlotPhiStatus.mockResolvedValue(phiRows);
  getPlotsGeoJSON.mockResolvedValue(plotsGeo);
  getReserveGeoJSON.mockResolvedValue(reserveGeo);
}

describe("SatelliteBoard (async Server Component render)", () => {
  it("renders the vegetation grid with a headline confidence summary", async () => {
    primeAll();
    render(await SatelliteBoard());
    // the per-plot vegetation card for this plot renders in the grid
    expect(screen.getByTestId("veg-p-cuesta-piedra")).toBeInTheDocument();
    // a headline strip surfaces how many plots we can see clearly vs honestly cannot
    expect(screen.getByTestId("sat-high-count")).toBeInTheDocument();
  });

  it("renders the empty state honestly when there are no reads", async () => {
    getPlotVegetation.mockResolvedValue([]);
    getPlotPhiStatus.mockResolvedValue([]);
    getPlotsGeoJSON.mockResolvedValue({ type: "FeatureCollection", features: [] });
    getReserveGeoJSON.mockResolvedValue({ type: "FeatureCollection", features: [] });
    render(await SatelliteBoard());
    expect(screen.getByTestId("vegetation-empty")).toBeInTheDocument();
  });

  it("mounts the spatial farm map as the primary surface with the fetched plot geometry", async () => {
    primeAll();
    render(await SatelliteBoard());
    const map = screen.getByTestId("sat-map");
    expect(map).toBeInTheDocument();
    // the map carries the server-fetched plot + reserve GeoJSON
    expect(map).toHaveAttribute("data-plot-count", "1");
    expect(map).toHaveAttribute("data-reserve-count", "1");
  });

  it("renders a prominent confidence legend/badge over the map", async () => {
    primeAll();
    render(await SatelliteBoard());
    expect(screen.getByTestId("sat-confidence-legend")).toBeInTheDocument();
  });

  it("renders the PHI/REI countdown chips on /satellite, not only /scouting", async () => {
    primeAll();
    render(await SatelliteBoard());
    // the active PHI window for Cuesta de Piedra surfaces as a countdown chip
    expect(screen.getByTestId("phi-p-cuesta-piedra")).toBeInTheDocument();
  });
});
