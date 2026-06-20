import { describe, expect, it } from "vitest";

import {
  centroidOf,
  polygonAreaHa,
  squarePolygon,
} from "@/lib/geo/placeholder";

/**
 * The placeholder-geometry helpers turn a plot's `area_ha` + an anchor point into
 * a valid GeoJSON Polygon, and derive area / centroid back out with turf. These
 * are PURE functions — the migration's seed SQL embeds their *output* (so the DB
 * stays Docker-free), but the math itself is unit-pinned here.
 */

describe("squarePolygon", () => {
  it("produces a closed GeoJSON Polygon ring (first point == last point)", () => {
    const poly = squarePolygon(-82.63, 8.78, 4.2);
    expect(poly.type).toBe("Polygon");
    const ring = poly.coordinates[0];
    // a closed ring has 5 vertices (4 corners + repeated first)
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
  });

  it("centers the square on the anchor point", () => {
    const lng = -82.63;
    const lat = 8.78;
    const poly = squarePolygon(lng, lat, 4.2);
    const c = centroidOf(poly);
    expect(c.coordinates[0]).toBeCloseTo(lng, 5);
    expect(c.coordinates[1]).toBeCloseTo(lat, 5);
  });

  it("scales: a bigger area_ha yields a measurably bigger polygon", () => {
    const small = polygonAreaHa(squarePolygon(-82.63, 8.78, 2));
    const big = polygonAreaHa(squarePolygon(-82.63, 8.78, 8));
    expect(big).toBeGreaterThan(small);
  });

  it("approximates the requested area in hectares within tolerance", () => {
    // 4.2 ha square — turf area is computed on the true (curved) earth, so we
    // accept a loose tolerance; this proves the sizing is in the right ballpark,
    // not exact survey-grade geometry (these are PLACEHOLDERS).
    const area = polygonAreaHa(squarePolygon(-82.63, 8.78, 4.2));
    expect(area).toBeGreaterThan(4.2 * 0.85);
    expect(area).toBeLessThan(4.2 * 1.15);
  });
});

describe("centroidOf", () => {
  it("returns a GeoJSON Point", () => {
    const c = centroidOf(squarePolygon(-82.63, 8.78, 3));
    expect(c.type).toBe("Point");
    expect(c.coordinates).toHaveLength(2);
  });
});
