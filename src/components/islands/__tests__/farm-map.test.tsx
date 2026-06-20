import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureCollection, Polygon } from "geojson";

import type {
  PlotFeatureProps,
  ReserveFeatureProps,
} from "@/lib/db/geo";

/**
 * jsdom has no WebGL, so we mock maplibre-gl entirely. The mock records every
 * source/layer added and every event handler registered, letting us assert that
 * FarmMap wires the plots + reserve data and the AD-2 blur-kill handlers without
 * ever touching a real GL context.
 */

interface MapStub {
  on: ReturnType<typeof vi.fn>;
  addSource: ReturnType<typeof vi.fn>;
  addLayer: ReturnType<typeof vi.fn>;
  getSource: ReturnType<typeof vi.fn>;
  setFeatureState: ReturnType<typeof vi.fn>;
  removeFeatureState: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  fitBounds: ReturnType<typeof vi.fn>;
  addControl: ReturnType<typeof vi.fn>;
  getCanvas: ReturnType<typeof vi.fn>;
}

const maps: MapStub[] = [];
const loadCallbacks: Array<() => void> = [];

function makeMapStub(): MapStub {
  const stub: MapStub = {
    on: vi.fn((event: string, ...rest: unknown[]) => {
      // capture the bare `on('load', cb)` so the test can fire it
      if (event === "load" && typeof rest[0] === "function") {
        loadCallbacks.push(rest[0] as () => void);
      }
    }),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    getSource: vi.fn(() => ({ setData: vi.fn() })),
    setFeatureState: vi.fn(),
    removeFeatureState: vi.fn(),
    remove: vi.fn(),
    fitBounds: vi.fn(),
    addControl: vi.fn(),
    getCanvas: vi.fn(() => ({ style: {} })),
  };
  return stub;
}

vi.mock("maplibre-gl", () => {
  class Map {
    constructor() {
      const stub = makeMapStub();
      maps.push(stub);
      return stub as unknown as Map;
    }
  }
  class NavigationControl {}
  return { default: { Map, NavigationControl }, Map, NavigationControl };
});

const plots: FeatureCollection<Polygon, PlotFeatureProps> = {
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
        id: "p1",
        name: "Tizingal Alto",
        block: "Block A",
        variety: "Geisha",
        status: "healthy",
        altitudeMasl: 1690,
      },
    },
  ],
};

const reserve: FeatureCollection<Polygon, ReserveFeatureProps> = {
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

beforeEach(() => {
  maps.length = 0;
  loadCallbacks.length = 0;
});
afterEach(() => {
  vi.clearAllMocks();
});

async function renderFarmMap() {
  const { FarmMap } = await import("@/components/islands/FarmMap.client");
  render(<FarmMap plots={plots} reserve={reserve} />);
  // The map registers a 'load' handler; fire it to run source/layer wiring.
  for (const cb of loadCallbacks) cb();
  return maps[0];
}

describe("FarmMap island", () => {
  it("renders an opaque glass scrim veil over the canvas (AD-2)", async () => {
    await renderFarmMap();
    const scrim = document.querySelector(".glass-scrim");
    expect(scrim).not.toBeNull();
  });

  it("adds the plots and reserve geojson sources on load", async () => {
    const map = await renderFarmMap();
    const sourceIds = map.addSource.mock.calls.map((c) => c[0]);
    expect(sourceIds).toContain("plots");
    expect(sourceIds).toContain("reserve");
  });

  it("adds plot fill + outline layers and a reserve overlay layer", async () => {
    const map = await renderFarmMap();
    const layerIds = map.addLayer.mock.calls.map(
      (c) => (c[0] as { id: string }).id,
    );
    expect(layerIds).toContain("plots-fill");
    expect(layerIds).toContain("plots-outline");
    expect(layerIds.some((id) => id.startsWith("reserve"))).toBe(true);
  });

  it("registers the AD-2 blur-kill handlers (interaction starts + idle)", async () => {
    const map = await renderFarmMap();
    const events = map.on.mock.calls.map((c) => c[0] as string);
    for (const e of [
      "movestart",
      "zoomstart",
      "pitchstart",
      "rotatestart",
      "dragstart",
      "idle",
    ]) {
      expect(events).toContain(e);
    }
  });

  it("wires GPU hover via feature-state (mousemove + mouseleave on plots-fill)", async () => {
    const map = await renderFarmMap();
    const layerScopedEvents = map.on.mock.calls
      .filter((c) => c[1] === "plots-fill")
      .map((c) => c[0] as string);
    expect(layerScopedEvents).toContain("mousemove");
    expect(layerScopedEvents).toContain("mouseleave");
  });
});

describe("SkeletonMap", () => {
  it("renders a glass skeleton placeholder", async () => {
    const { SkeletonMap } = await import("@/components/islands/FarmMap.client");
    render(<SkeletonMap />);
    expect(screen.getByLabelText(/loading map/i)).toBeInTheDocument();
  });
});
