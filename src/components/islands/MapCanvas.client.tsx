"use client";

import dynamic from "next/dynamic";
import type { FeatureCollection, Polygon } from "geojson";

import type { PlotFeatureProps, ReserveFeatureProps } from "@/lib/db/geo";
import { SkeletonMap } from "@/components/islands/FarmMap.client";

/**
 * Client wrapper that owns the `next/dynamic(..., { ssr: false })` import of the
 * MapLibre island. Next 15 forbids `ssr: false` dynamic imports inside Server
 * Components, so the server /map page renders THIS (a Client Component) and passes
 * the server-fetched GeoJSON straight through. The glass SkeletonMap is the
 * sized loader (CLS≈0) shown while the GL chunk hydrates.
 */

const FarmMap = dynamic(
  () => import("@/components/islands/FarmMap.client").then((m) => m.FarmMap),
  { ssr: false, loading: () => <SkeletonMap /> },
);

export interface MapCanvasProps {
  plots: FeatureCollection<Polygon, PlotFeatureProps>;
  reserve: FeatureCollection<Polygon, ReserveFeatureProps>;
}

export function MapCanvas({ plots, reserve }: MapCanvasProps) {
  return <FarmMap plots={plots} reserve={reserve} />;
}
