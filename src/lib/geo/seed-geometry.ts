// PLACEHOLDER seed geometry — the single source of truth for the map's geometry.
//
// Both the seed (scripts/gen-seed.ts -> supabase/seed.sql) and the geometry
// migration's data fix-up derive from THESE functions, so the polygons can never
// drift from the canonical plot list (src/lib/data/plots.ts).
//
// !!! HUMAN/FAMILY GATE !!! these are APPROXIMATE squares sized by area_ha and
// scattered on a grid around Volcán — NOT the real traced farm boundaries. Swap
// for the family's surveyed boundaries when available.

import { plots as PLOTS } from "@/lib/data/plots";
import { BRAND } from "@/lib/brand";
import {
  centroidOf,
  polygonAreaHa,
  squarePolygon,
} from "@/lib/geo/placeholder";
import type { Point, Polygon } from "geojson";

/** Volcán, Chiriquí — approximate town-center anchor for the placeholder grid. */
export const VOLCAN_ANCHOR = { lng: -82.6308, lat: 8.781 } as const;

const M_PER_DEG_LAT = 110_574;
const mPerDegLng = (lat: number) =>
  111_320 * Math.cos((lat * Math.PI) / 180);

const SPACING_M = 700; // grid pitch between plot centers
const COLS = 4;
const round = (n: number, dp = 6) => Number(n.toFixed(dp));

const roundPolygon = (poly: Polygon): Polygon => ({
  type: "Polygon",
  coordinates: poly.coordinates.map((ring) =>
    ring.map(([x, y]) => [round(x), round(y)]),
  ),
});
const roundPoint = (pt: Point): Point => ({
  type: "Point",
  coordinates: [round(pt.coordinates[0]), round(pt.coordinates[1])],
});

export interface PlotGeometry {
  id: string;
  geom: Polygon;
  centroid: Point;
}

/** Placeholder geometry for every canonical plot, in plot order. */
export function plotGeometries(): PlotGeometry[] {
  return PLOTS.map((p, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const dxM = (col - (COLS - 1) / 2) * SPACING_M;
    const dyM = (row - 0.5) * SPACING_M;
    const lng = VOLCAN_ANCHOR.lng + dxM / mPerDegLng(VOLCAN_ANCHOR.lat);
    const lat = VOLCAN_ANCHOR.lat + dyM / M_PER_DEG_LAT;
    const geom = roundPolygon(squarePolygon(lng, lat, p.areaHa));
    return { id: p.id, geom, centroid: roundPoint(centroidOf(geom)) };
  });
}

export interface ReserveZoneSeed {
  id: string;
  name: string;
  kind: string;
  geom: Polygon;
  areaHa: number;
  notes: string;
}

/** The ~200-ha quetzal cloud-forest reserve (placeholder outline). */
export function reserveZone(): ReserveZoneSeed {
  const lng = VOLCAN_ANCHOR.lng - 0.045;
  const lat = VOLCAN_ANCHOR.lat + 0.055;
  const geom = roundPolygon(squarePolygon(lng, lat, BRAND.reserveHectares));
  return {
    id: "rz-quetzal",
    name: "Quetzal Cloud-Forest Reserve",
    kind: "reserve",
    geom,
    areaHa: round(polygonAreaHa(geom), 1),
    notes:
      "PLACEHOLDER outline pending the real traced reserve boundary (human/family gate).",
  };
}
