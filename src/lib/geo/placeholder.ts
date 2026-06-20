// PLACEHOLDER plot geometry helpers.
//
// The real farm boundaries haven't been traced yet (that's a human/family gate —
// see the migration's PLACEHOLDER note), so until then the map renders APPROXIMATE
// square polygons sized by each plot's area_ha and scattered around Volcán.
//
// These are pure functions: the migration seed embeds their *output* coordinates
// as literal GeoJSON (keeping the DB PostGIS-free + replayable in PGlite), while
// the math is unit-tested here. No `geometry` type, no PostGIS — GeoJSON in jsonb.

import area from "@turf/area";
import centroid from "@turf/centroid";
import type { Feature, Point, Polygon } from "geojson";

/** Mean meters-per-degree of latitude (≈ constant). */
const M_PER_DEG_LAT = 110_574;
/** Meters per degree of longitude at latitude φ. */
function mPerDegLng(latDeg: number): number {
  return 111_320 * Math.cos((latDeg * Math.PI) / 180);
}

/**
 * An axis-aligned square Polygon of ~`areaHa` hectares centered on (lng, lat).
 * The ring is closed (first vertex repeated as last), as GeoJSON requires.
 */
export function squarePolygon(
  lng: number,
  lat: number,
  areaHa: number,
): Polygon {
  const areaM2 = Math.max(areaHa, 0) * 10_000;
  const sideM = Math.sqrt(areaM2); // side of an equal-area square, in meters
  const halfLat = sideM / 2 / M_PER_DEG_LAT;
  const halfLng = sideM / 2 / mPerDegLng(lat);

  const w = lng - halfLng;
  const e = lng + halfLng;
  const s = lat - halfLat;
  const n = lat + halfLat;

  return {
    type: "Polygon",
    // ring order: SW → SE → NE → NW → SW (closed)
    coordinates: [
      [
        [w, s],
        [e, s],
        [e, n],
        [w, n],
        [w, s],
      ],
    ],
  };
}

/** GeoJSON Point at the polygon centroid (via turf). */
export function centroidOf(poly: Polygon): Point {
  const f: Feature<Polygon> = { type: "Feature", geometry: poly, properties: {} };
  return centroid(f).geometry;
}

/** True (curved-earth) area of a polygon, in hectares (via turf). */
export function polygonAreaHa(poly: Polygon): number {
  const f: Feature<Polygon> = { type: "Feature", geometry: poly, properties: {} };
  return area(f) / 10_000;
}
