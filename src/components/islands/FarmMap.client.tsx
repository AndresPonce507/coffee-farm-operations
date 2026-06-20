"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection, Polygon } from "geojson";

import type { PlotFeatureProps, ReserveFeatureProps } from "@/lib/db/geo";
import { PALETTE } from "@/lib/brand";

/**
 * FarmMap — vanilla MapLibre island (no react-map-gl, per UA-7).
 *
 * Renders plot polygons tinted by status over free OpenFreeMap tiles (no API key),
 * with the quetzal reserve as a distinct protected overlay. Hover runs on the GPU
 * via feature-state (no React re-render).
 *
 * AD-2 (glass-over-canvas): a `.glass-scrim` veil sits above the canvas so floating
 * chrome never samples a live, moving GL surface. We add `.is-interacting` on the
 * UNION of interaction-start events and remove it on the debounced `idle` event
 * (not `moveend`), so blur work is paused for the whole gesture, not just per-frame.
 */

// Free, no-key basemap. Positron reads cleanly under a forest-tinted glass veil.
const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

const STATUS_COLOR: Record<string, string> = {
  healthy: PALETTE.forest500,
  watch: PALETTE.honey,
  "at-risk": PALETTE.cherry,
};

// MapLibre paint expression: pick the fill color off each feature's `status` prop.
const STATUS_FILL_EXPR = [
  "match",
  ["get", "status"],
  "healthy",
  STATUS_COLOR.healthy,
  "watch",
  STATUS_COLOR.watch,
  "at-risk",
  STATUS_COLOR["at-risk"],
  PALETTE.forest500, // fallback
] as const;

export interface FarmMapProps {
  plots: FeatureCollection<Polygon, PlotFeatureProps>;
  reserve: FeatureCollection<Polygon, ReserveFeatureProps>;
}

/** Bounding box [w, s, e, n] over all polygon rings; null if empty. */
function bboxOf(
  ...collections: FeatureCollection<Polygon>[]
): [number, number, number, number] | null {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  let seen = false;
  for (const fc of collections) {
    for (const f of fc.features) {
      for (const ring of f.geometry.coordinates) {
        for (const [x, y] of ring) {
          seen = true;
          if (x < w) w = x;
          if (x > e) e = x;
          if (y < s) s = y;
          if (y > n) n = y;
        }
      }
    }
  }
  return seen ? [w, s, e, n] : null;
}

export function FarmMap({ plots, reserve }: FarmMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      center: [-82.6308, 8.781], // Volcán
      zoom: 12,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    // AD-2 blur-kill: pause chrome blur for the whole gesture.
    const scrim = scrimRef.current;
    const startInteract = () => scrim?.classList.add("is-interacting");
    const endInteract = () => scrim?.classList.remove("is-interacting");
    for (const ev of [
      "movestart",
      "zoomstart",
      "pitchstart",
      "rotatestart",
      "dragstart",
    ] as const) {
      map.on(ev, startInteract);
    }
    // `idle` is the debounced settle event (fires once after motion + tiles done) —
    // strictly later than `moveend`, so the scrim re-enables blur only when truly still.
    map.on("idle", endInteract);

    let hovered: string | number | undefined;

    map.on("load", () => {
      map.addSource("plots", { type: "geojson", data: plots, promoteId: "id" });
      map.addSource("reserve", { type: "geojson", data: reserve, promoteId: "id" });

      // Reserve overlay — a distinct protected pattern (forest fill + dashed line).
      map.addLayer({
        id: "reserve-fill",
        type: "fill",
        source: "reserve",
        paint: { "fill-color": PALETTE.forest, "fill-opacity": 0.14 },
      });
      map.addLayer({
        id: "reserve-outline",
        type: "line",
        source: "reserve",
        paint: {
          "line-color": PALETTE.forest600,
          "line-width": 1.5,
          "line-dasharray": [3, 2],
        },
      });

      // Plot fills — tinted by status, brighter on hover (GPU feature-state).
      map.addLayer({
        id: "plots-fill",
        type: "fill",
        source: "plots",
        paint: {
          "fill-color": STATUS_FILL_EXPR as unknown as string,
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            0.78,
            0.5,
          ],
        },
      });
      map.addLayer({
        id: "plots-outline",
        type: "line",
        source: "plots",
        paint: {
          "line-color": STATUS_FILL_EXPR as unknown as string,
          "line-width": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            2.5,
            1.25,
          ],
        },
      });

      // GPU hover via feature-state — no React re-render.
      map.on("mousemove", "plots-fill", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        map.getCanvas().style.cursor = "pointer";
        if (hovered !== undefined) {
          map.setFeatureState({ source: "plots", id: hovered }, { hover: false });
        }
        hovered = f.id;
        if (hovered !== undefined) {
          map.setFeatureState({ source: "plots", id: hovered }, { hover: true });
        }
      });
      map.on("mouseleave", "plots-fill", () => {
        map.getCanvas().style.cursor = "";
        if (hovered !== undefined) {
          map.setFeatureState({ source: "plots", id: hovered }, { hover: false });
        }
        hovered = undefined;
      });

      // Frame the farm.
      const bbox = bboxOf(plots, reserve);
      if (bbox) {
        map.fitBounds(bbox, { padding: 56, duration: 0 });
      }
    });

    return () => map.remove();
    // plots/reserve are fetched once server-side and passed as a stable prop set;
    // re-running on identity change is the intended (and only) reset path.
  }, [plots, reserve]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl">
      {/* GL canvas mounts here */}
      <div ref={containerRef} className="absolute inset-0" />
      {/* AD-2 veil — opaque enough (≥0.6) that chrome never samples live canvas. */}
      <div
        ref={scrimRef}
        aria-hidden
        className="glass-scrim pointer-events-none absolute inset-0"
      />
    </div>
  );
}

/**
 * SkeletonMap — glass placeholder sized to the final map box so the island
 * lazy-load causes CLS ≈ 0. Honors prefers-reduced-motion (shimmer is CSS-gated).
 */
export function SkeletonMap() {
  return (
    <div
      role="status"
      aria-label="Loading map"
      aria-busy="true"
      className="glass-card relative h-full w-full overflow-hidden rounded-2xl"
    >
      <div className="skeleton-shimmer absolute inset-0" />
      <span className="sr-only">Loading map…</span>
    </div>
  );
}
